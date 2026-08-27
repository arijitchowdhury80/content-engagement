#!/usr/bin/env python3
"""Deploy immutable judge-v2 assets and atomically switch the Drift block."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import deploy_jahia_engagement_tracker as jahia
import judge_release_guard


ROOT = Path(__file__).resolve().parents[2]
BLOCK = jahia.BLOCK_PATH
FILES = "/sites/www/files"
PUBLIC = "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files"
RENDERED_PAGE = "https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html"
PRIVATE_ROOT = ROOT / ".local/deployment-state/judge-v2-jahia"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SOURCES = {
    "core": ROOT / "frontend/chat-widget/algolia-judge-core.js",
    "badge": ROOT / "frontend/chat-widget/algolia-confidence-badge.js",
    "chat": ROOT / "frontend/chat-widget/algolia-chat.js",
}


def immutable_assets(content_overrides: dict[str, dict[str, str]] | None = None) -> dict[str, dict[str, str]]:
    content_overrides = content_overrides or {}
    assets = {}
    for key, source in SOURCES.items():
        override = content_overrides.get(key)
        content = override["content"] if override else source.read_text(encoding="utf-8")
        if key == "chat":
            judge_release_guard.validate_chat_runtime(content)
        elif key == "compare":
            judge_release_guard.validate_compare_runtime(content)
        digest = jahia.sha256(content)
        stem = {"core": "algolia-judge-core", "badge": "algolia-confidence-badge", "chat": "algolia-chat"}[key]
        filename = f"{stem}-judge-v2-{digest[:12]}.js"
        assets[key] = {
            "source": override["source"] if override else str(source.relative_to(ROOT)),
            "content": content,
            "sha256": digest,
            "filename": filename,
            "path": f"{FILES}/{filename}",
            "url": f"{PUBLIC}/{filename}",
        }
    return assets


def validate_agent_ids(agent_ids: dict[str, str]) -> None:
    if set(agent_ids) != {"skeptic", "referee", "advocate"}:
        raise RuntimeError("Exactly skeptic, referee, and advocate IDs are required")
    if len(set(agent_ids.values())) != 3:
        raise RuntimeError("Judge v2 agent IDs must be distinct")
    invalid = [role for role, value in agent_ids.items() if not UUID.fullmatch(value)]
    if invalid:
        raise RuntimeError(f"Judge v2 agent IDs must be canonical UUIDs: {', '.join(invalid)}")


def replace_one(pattern: str, replacement: str, value: str, label: str, flags: int = 0) -> str:
    count = len(re.findall(pattern, value, flags=flags))
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label}; found {count}")
    return re.sub(pattern, replacement, value, count=1, flags=flags)


def update_block_html(current: str, assets: dict, agent_ids: dict[str, str]) -> str:
    validate_agent_ids(agent_ids)
    next_html = re.sub(
        rf'\n?<script src="{re.escape(PUBLIC)}/algolia-judge-core(?:-judge-v2-[a-f0-9]{{12}})?\.js(?:\?[^"\n]*)?"></script>',
        "",
        current,
    )
    next_html = replace_one(
        rf'<script src="{re.escape(PUBLIC)}/algolia-confidence-badge(?:-judge-v2-[a-f0-9]{{12}})?\.js(?:\?[^"\n]*)?"></script>',
        f'<script src="{assets["badge"]["url"]}"></script>', next_html, "confidence badge script",
    )
    next_html = replace_one(
        rf'<script src="{re.escape(PUBLIC)}/algolia-chat(?:-judge-v2-[a-f0-9]{{12}})?\.js(?:\?[^"\n]*)?"></script>',
        f'<script src="{assets["core"]["url"]}"></script>\n<script src="{assets["chat"]["url"]}"></script>',
        next_html, "chat script",
    )
    confidence_pattern = r'<algolia-chat-confidence\b([^>]*)>'
    matches = re.findall(confidence_pattern, next_html)
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one algolia-chat-confidence element; found {len(matches)}")
    attrs = re.sub(r'\sagent-id="[^"]*"', "", matches[0])
    attrs = re.sub(r'\smode="[^"]*"', "", attrs).rstrip()
    next_html = re.sub(confidence_pattern, f'<algolia-chat-confidence{attrs}>', next_html, count=1)
    for role, agent_id in agent_ids.items():
        pattern = rf'(<algolia-agent\b(?=[^>]*\brole="{role}")[^>]*\bagent-id=")[^"]*(")'
        escaped_id = html.escape(agent_id, quote=True)
        next_html = replace_one(pattern, rf'\g<1>{escaped_id}\g<2>', next_html, f"{role} judge agent")
    embed_pattern = r'<div\b[^>]*\bclass="[^"]*\balgolia-chat-embed\b[^"]*"[^>]*>'
    embeds = re.findall(embed_pattern, next_html)
    if len(embeds) != 1:
        raise RuntimeError(f"Expected exactly one algolia-chat-embed element; found {len(embeds)}")
    embed = embeds[0]
    marker = 'data-judge-runtime-release="judge-v2"'
    updated = re.sub(r'\sdata-judge-runtime-release="[^"]*"', f" {marker}", embed, count=1) if re.search(
        r'\sdata-judge-runtime-release="[^"]*"', embed
    ) else embed[:-1] + f" {marker}>"
    return next_html.replace(embed, updated, 1)


def safe_node(path: str, workspace: str) -> dict | None:
    return jahia.node(path, workspace)


def compact_file(node: dict | None) -> dict | None:
    if node is None:
        return None
    content = jahia.file_content(node)
    return {"path": node.get("path"), "sha256": jahia.sha256(content or ""), "length": len(content or "")}


def private_snapshot(assets: dict) -> dict:
    return {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "edit": {"blockHtml": jahia.block_html("EDIT"), "assets": {key: compact_file(safe_node(asset["path"], "EDIT")) for key, asset in assets.items()}},
        "live": {"blockHtml": jahia.block_html("LIVE"), "assets": {key: compact_file(safe_node(asset["path"], "LIVE")) for key, asset in assets.items()}},
    }


def public_snapshot(snapshot: dict) -> dict:
    return {
        "capturedAt": snapshot["capturedAt"],
        "edit": {"blockSha256": jahia.sha256(snapshot["edit"]["blockHtml"]), "blockLength": len(snapshot["edit"]["blockHtml"]), "assets": snapshot["edit"]["assets"]},
        "live": {"blockSha256": jahia.sha256(snapshot["live"]["blockHtml"]), "blockLength": len(snapshot["live"]["blockHtml"]), "assets": snapshot["live"]["assets"]},
    }


def write_private(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def create_immutable(asset: dict) -> dict:
    existing = safe_node(asset["path"], "EDIT")
    if existing:
        actual = jahia.file_content(existing) or ""
        if actual != asset["content"]:
            raise RuntimeError(f"Immutable asset collision at {asset['path']}")
        return {"path": asset["path"], "operation": "reuse", "sha256": asset["sha256"]}
    jahia.upsert_file(asset["path"], asset["content"])
    for attempt in range(8):
        created = safe_node(asset["path"], "EDIT")
        if created is not None and (jahia.file_content(created) or "") == asset["content"]:
            break
        if attempt < 7:
            time.sleep(0.5)
    else:
        raise RuntimeError(f"Immutable asset was not readable with its exact content after creation: {asset['path']}")
    return {"path": asset["path"], "operation": "create", "sha256": asset["sha256"]}


def fetch_bytes(url: str) -> bytes:
    return jahia.fetch_public_bytes(url, user_agent="algolia-judge-v2-readback/1")


def live_companion_overrides() -> dict[str, dict[str, str]]:
    live_html = jahia.block_html("LIVE")
    overrides = {}
    for key, stem in {"badge": "algolia-confidence-badge", "chat": "algolia-chat"}.items():
        urls = re.findall(
            rf'<script src="({re.escape(PUBLIC)}/{stem}(?:-judge-v2-[a-f0-9]{{12}})?\.js(?:\?[^"\n]*)?)"></script>',
            live_html,
        )
        if len(urls) != 1:
            raise RuntimeError(f"Expected exactly one live {key} companion script; found {len(urls)}")
        overrides[key] = {"source": f"live:{urls[0]}", "content": fetch_bytes(urls[0]).decode("utf-8")}
    return overrides


def validate(after: dict, assets: dict, expected_html: str, agent_ids: dict, public_checks: dict | None = None) -> dict:
    live_html = after["live"]["blockHtml"]
    checks = {
        "editBlockMatches": after["edit"]["blockHtml"] == expected_html,
        "liveBlockMatches": live_html == expected_html,
        "chiefAttributeAbsent": re.search(r'<algolia-chat-confidence\b[^>]*\bagent-id=', live_html) is None,
        "confidenceModeAttributeAbsent": re.search(r'<algolia-chat-confidence\b[^>]*\bmode=', live_html) is None,
        "coreLoadsBeforeChat": 0 <= live_html.find(assets["core"]["url"]) < live_html.find(assets["chat"]["url"]),
        "threeRoleIdsPresent": all(live_html.count(agent_id) == 1 for agent_id in agent_ids.values()),
    }
    for workspace in ["edit", "live"]:
        for key, asset in assets.items():
            observed = after[workspace]["assets"][key]
            checks[f"{workspace}_{key}_hash"] = observed is not None and observed["sha256"] == asset["sha256"]
    if public_checks:
        checks.update(public_checks)
    checks["pass"] = all(checks.values())
    return checks


def public_readback(assets: dict, agent_ids: dict) -> dict:
    checks = {}
    for key, asset in assets.items():
        content = fetch_bytes(asset["url"])
        checks[f"public_{key}_hash"] = hashlib.sha256(content).hexdigest() == asset["sha256"]
    page = fetch_bytes(RENDERED_PAGE).decode("utf-8", errors="replace")
    checks["renderedPageExactAssets"] = all(page.count(asset["url"]) == 1 for asset in assets.values())
    observed_judge_assets = re.findall(
        rf'<script src="({re.escape(PUBLIC)}/(?:algolia-judge-core|algolia-confidence-badge|algolia-chat)(?:-judge-v2-[a-f0-9]{{12}})?\.js(?:\?[^"\n]*)?)"></script>',
        page,
    )
    checks["renderedPageExactJudgeAssetSet"] = sorted(observed_judge_assets) == sorted(asset["url"] for asset in assets.values())
    checks["renderedPageLoadOrder"] = 0 <= page.find(assets["core"]["url"]) < page.find(assets["chat"]["url"])
    checks["renderedPageJudgeIds"] = all(page.count(agent_id) == 1 for agent_id in agent_ids.values())
    return checks


def restore(manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    prior = manifest.get("beforeEditHtml")
    expected_hash = manifest.get("beforeEditSha256")
    deployed_hash = manifest.get("expectedDeployedSha256")
    if not isinstance(prior, str) or jahia.sha256(prior) != expected_hash or not isinstance(deployed_hash, str):
        raise RuntimeError("Invalid or corrupted Jahia rollback manifest")
    current = {workspace: jahia.block_html(workspace) for workspace in ["EDIT", "LIVE"]}
    current_hashes = {workspace: jahia.sha256(value) for workspace, value in current.items()}
    allowed_hashes = {expected_hash, deployed_hash}
    unexpected = [workspace for workspace, value in current_hashes.items() if value not in allowed_hashes]
    if unexpected:
        raise RuntimeError(f"Rollback refused because the block changed concurrently in: {', '.join(unexpected)}")
    if all(value == expected_hash for value in current_hashes.values()):
        return {"editRestored": True, "liveRestored": True, "sha256": expected_hash, "alreadyRestored": True, "pass": True}
    jahia.set_block_html(prior)
    jahia.version_block()
    jahia.publish("/sites/www/home/drift", subtree=True)
    jahia.publish(BLOCK, subtree=True)
    edit = jahia.block_html("EDIT")
    live = jahia.block_html("LIVE")
    for _ in range(8):
        if edit == prior and live == prior:
            break
        time.sleep(2)
        jahia.publish("/sites/www/home/drift", subtree=True)
        jahia.publish(BLOCK, subtree=True)
        edit = jahia.block_html("EDIT")
        live = jahia.block_html("LIVE")
    result = {"editRestored": edit == prior, "liveRestored": live == prior, "sha256": expected_hash}
    result["pass"] = result["editRestored"] and result["liveRestored"]
    if not result["pass"]:
        raise RuntimeError("Jahia rollback readback failed")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", type=Path)
    parser.add_argument("--skeptic")
    parser.add_argument("--referee")
    parser.add_argument("--advocate")
    parser.add_argument("--preserve-live-companions", action="store_true")
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    evidence_dir = args.evidence_dir or ROOT / "docs/evidence/deployments" / f"judge-v2-{run_id}"
    if not evidence_dir.is_absolute():
        evidence_dir = ROOT / evidence_dir
    if args.rollback:
        result = restore(args.rollback.resolve())
        jahia.write_json(evidence_dir / "rollback-readback.json", result)
        print(json.dumps(result, indent=2))
        return 0
    if not all([args.skeptic, args.referee, args.advocate]):
        parser.error("--skeptic, --referee, and --advocate are required unless --rollback is used")
    agent_ids = {"skeptic": args.skeptic, "referee": args.referee, "advocate": args.advocate}
    validate_agent_ids(agent_ids)
    assets = immutable_assets(live_companion_overrides() if args.preserve_live_companions else None)
    before = private_snapshot(assets)
    expected_html = update_block_html(before["edit"]["blockHtml"], assets, agent_ids)
    interrupted_cutover_recovery = False
    if args.apply and before["edit"]["blockHtml"] != before["live"]["blockHtml"]:
        expected_from_live = update_block_html(before["live"]["blockHtml"], assets, agent_ids)
        if before["live"]["blockHtml"] == expected_html:
            interrupted_cutover_recovery = True
        elif before["edit"]["blockHtml"] == expected_from_live:
            expected_html = before["edit"]["blockHtml"]
            interrupted_cutover_recovery = True
        else:
            raise RuntimeError("EDIT and LIVE blocks differ outside the exact interrupted judge cutover; refusing recovery")
    private_dir = PRIVATE_ROOT / run_id
    private_snapshot_path = private_dir / "before-snapshot.json"
    rollback_path = private_dir / "rollback-manifest.json"
    write_private(private_snapshot_path, before)
    write_private(rollback_path, {
        "target": BLOCK,
        "beforeEditHtml": before["edit"]["blockHtml"],
        "beforeEditSha256": jahia.sha256(before["edit"]["blockHtml"]),
        "beforeLiveSha256": jahia.sha256(before["live"]["blockHtml"]),
        "expectedDeployedSha256": jahia.sha256(expected_html),
    })
    plan = {
        "apply": args.apply,
        "scope": "local judge core with preserved live companions plus one exact Drift block" if args.preserve_live_companions else "three immutable assets plus one exact Drift block",
        "assets": {key: {field: value for field, value in asset.items() if field != "content"} for key, asset in assets.items()},
        "agentIds": agent_ids,
        "expectedBlockSha256": jahia.sha256(expected_html),
        "before": public_snapshot(before),
        "privateSnapshotSha256": jahia.sha256(private_snapshot_path.read_text(encoding="utf-8")),
        "rollbackCommand": f"python3 tools/deployment/deploy_judge_v2_jahia.py --rollback {rollback_path}",
        "oldAssetsRemainUntouched": True,
        "interruptedCutoverRecovery": interrupted_cutover_recovery,
    }
    jahia.write_json(evidence_dir / "deployment-plan.json", plan)
    if not args.apply:
        print(json.dumps({"pass": True, "dryRun": True, "evidenceDir": str(evidence_dir), "privateStateDir": str(private_dir), "plan": plan}, indent=2))
        return 0

    mutations = {}
    try:
        for key, asset in assets.items():
            mutations[f"asset_{key}"] = {
                "path": asset["path"],
                "operation": "attempted",
                "sha256": asset["sha256"],
            }
            mutations[f"asset_{key}"] = create_immutable(asset)
        if jahia.sha256(jahia.block_html("EDIT")) != jahia.sha256(before["edit"]["blockHtml"]):
            raise RuntimeError("Drift block changed after snapshot; aborting concurrent overwrite")
        mutations["setBlockHtml"] = jahia.set_block_html(expected_html)
        for key, asset in assets.items():
            mutations[f"publish_{key}_content"] = jahia.publish(f"{asset['path']}/jcr:content", subtree=False)
            mutations[f"publish_{key}"] = jahia.publish(asset["path"], subtree=False)
        mutations["versionBlock"] = jahia.version_block()
        mutations["publishDriftSubtree"] = jahia.publish("/sites/www/home/drift", subtree=True)
        mutations["publishBlock"] = jahia.publish(BLOCK, subtree=True)
    except Exception as error:
        try:
            rollback = restore(rollback_path)
        except Exception as rollback_error:
            rollback = {"pass": False, "error": str(rollback_error)}
        jahia.write_json(evidence_dir / "failed-mutation-rollback.json", {
            "pass": False,
            "error": str(error),
            "rollback": rollback,
            "mutations": mutations,
        })
        raise
    jahia.write_json(evidence_dir / "mutation-results.json", mutations)
    try:
        after = private_snapshot(assets)
        checks = validate(after, assets, expected_html, agent_ids)
        if not checks["pass"] and checks["editBlockMatches"]:
            mutations["republishDriftSubtreeAfterStaleLiveReadback"] = jahia.publish("/sites/www/home/drift", subtree=True)
            mutations["republishBlockAfterStaleLiveReadback"] = jahia.publish(BLOCK, subtree=True)
            jahia.write_json(evidence_dir / "mutation-results.json", mutations)
        for _ in range(8):
            if checks["pass"]:
                break
            time.sleep(2)
            after = private_snapshot(assets)
            checks = validate(after, assets, expected_html, agent_ids)
        if checks["pass"]:
            checks = validate(after, assets, expected_html, agent_ids, public_readback(assets, agent_ids))
    except Exception as error:
        try:
            rollback = restore(rollback_path)
        except Exception as rollback_error:
            rollback = {"pass": False, "error": str(rollback_error)}
        jahia.write_json(evidence_dir / "failed-validation-rollback.json", {
            "pass": False, "error": str(error), "rollback": rollback,
        })
        raise
    jahia.write_json(evidence_dir / "after-readback.json", public_snapshot(after))
    jahia.write_json(evidence_dir / "deployment-validation.json", checks)
    if not checks["pass"]:
        try:
            rollback = restore(rollback_path)
        except Exception as rollback_error:
            rollback = {"pass": False, "error": str(rollback_error)}
        jahia.write_json(evidence_dir / "failed-validation-rollback.json", {
            "pass": False, "checks": checks, "rollback": rollback,
        })
    print(json.dumps(checks, indent=2))
    return 0 if checks["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
