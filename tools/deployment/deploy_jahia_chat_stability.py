#!/usr/bin/env python3
"""Deploy one immutable stability-hardened chat asset to the Jahia development surface."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import deploy_jahia_engagement_tracker as jahia
from deploy_jahia_index_contract import read_private, safe_evidence_dir, write_private


ROOT = Path(__file__).resolve().parents[2]
TARGET_ORIGIN = "https://tmp-content-eng-algolia.cloud.jahia.com"
PUBLIC_FILES = f"{TARGET_ORIGIN}/files/live/sites/www/files"
FILES_PATH = "/sites/www/files"
BLOCK_PATH = "/sites/www/home/drift/custom-code-block"
DRIFT_PATH = "/sites/www/home/drift"
CHAT_SOURCE = ROOT / "frontend/chat-widget/algolia-chat.js"
CHAT_SCRIPT = re.compile(
    rf'<script src="({re.escape(PUBLIC_FILES)}/algolia-chat(?:-judge-v2-[a-f0-9]{{12}}|-stability-[a-f0-9]{{12}})?\.js(?:\?[^"\n]*)?)"></script>'
)
EMBED = re.compile(r'<div\b[^>]*\bclass="[^"]*\balgolia-chat-embed\b[^"]*"[^>]*>')


def sha256(value: str | bytes) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def compact_node(node: dict | None) -> dict | None:
    if node is None:
        return None
    content = jahia.file_content(node) or ""
    return {"path": node.get("path"), "sha256": sha256(content), "length": len(content)}


def chat_asset(content: str) -> dict:
    digest = sha256(content)
    filename = f"algolia-chat-stability-{digest[:12]}.js"
    return {
        "filename": filename,
        "path": f"{FILES_PATH}/{filename}",
        "contentPath": f"{FILES_PATH}/{filename}/jcr:content",
        "url": f"{PUBLIC_FILES}/{filename}",
        "sha256": digest,
        "content": content,
    }


def update_block_html(current: str, asset: dict) -> str:
    matches = CHAT_SCRIPT.findall(current)
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one primary chat script; found {len(matches)}")
    updated = CHAT_SCRIPT.sub(f'<script src="{asset["url"]}"></script>', current, count=1)
    embeds = EMBED.findall(updated)
    if len(embeds) != 1:
        raise RuntimeError(f"Expected exactly one algolia-chat-embed element; found {len(embeds)}")
    embed = embeds[0]
    marker = f'data-chat-stability-release="{asset["sha256"][:12]}"'
    if re.search(r'\sdata-chat-stability-release="[^"]*"', embed):
        next_embed = re.sub(r'\sdata-chat-stability-release="[^"]*"', f" {marker}", embed, count=1)
    else:
        next_embed = embed[:-1] + f" {marker}>"
    return updated.replace(embed, next_embed, 1)


def capture(asset_path: str) -> dict:
    return {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "edit": {
            "blockHtml": jahia.block_html("EDIT"),
            "asset": compact_node(jahia.node(asset_path, "EDIT")),
        },
        "live": {
            "blockHtml": jahia.block_html("LIVE"),
            "asset": compact_node(jahia.node(asset_path, "LIVE")),
        },
    }


def public_readback(asset: dict) -> dict:
    query = urlencode({"stability_chat_readback": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")})
    page = jahia.fetch_public_bytes(f"{TARGET_ORIGIN}/?{query}", user_agent="algolia-stability-chat-readback/1")
    asset_bytes = jahia.fetch_public_bytes(asset["url"], user_agent="algolia-stability-chat-readback/1")
    return {
        "pageReferencesAsset": asset["url"].encode("utf-8") in page,
        "assetSha256": sha256(asset_bytes),
        "assetMatches": sha256(asset_bytes) == asset["sha256"],
    }


def validate(snapshot: dict, expected_html: str, asset: dict, *, include_public: bool) -> dict:
    checks = {
        "editBlockExact": snapshot["edit"]["blockHtml"] == expected_html,
        "liveBlockExact": snapshot["live"]["blockHtml"] == expected_html,
        "editAssetExact": snapshot["edit"]["asset"] is not None and snapshot["edit"]["asset"]["sha256"] == asset["sha256"],
        "liveAssetExact": snapshot["live"]["asset"] is not None and snapshot["live"]["asset"]["sha256"] == asset["sha256"],
    }
    public = public_readback(asset) if include_public else None
    if public:
        checks["publicReferencesAsset"] = public["pageReferencesAsset"]
        checks["publicAssetExact"] = public["assetMatches"]
    return {"pass": all(checks.values()), "checks": checks, "public": public}


def dry_run(evidence_dir: Path) -> dict:
    content = CHAT_SOURCE.read_text(encoding="utf-8")
    asset = chat_asset(content)
    before = capture(asset["path"])
    if before["edit"]["blockHtml"] != before["live"]["blockHtml"]:
        raise RuntimeError("EDIT and LIVE block HTML must match before chat cutover")
    expected_html = update_block_html(before["edit"]["blockHtml"], asset)
    plan = {
        "schema": "JahiaImmutableChatPlan.v1",
        "target": {"origin": TARGET_ORIGIN, "block": BLOCK_PATH},
        "asset": {key: value for key, value in asset.items() if key != "content"},
        "before": {
            "editBlockSha256": sha256(before["edit"]["blockHtml"]),
            "liveBlockSha256": sha256(before["live"]["blockHtml"]),
        },
        "expectedBlockSha256": sha256(expected_html),
        "mutationAllowlist": [
            {"operation": "create-or-reuse-immutable", "path": asset["path"]},
            {"operation": "setBlockHtml", "path": BLOCK_PATH},
            {"operation": "publish", "path": asset["contentPath"], "subtree": False},
            {"operation": "publish", "path": asset["path"], "subtree": False},
            {"operation": "publish", "path": DRIFT_PATH, "subtree": True},
            {"operation": "publish", "path": BLOCK_PATH, "subtree": True},
        ],
        "preservesAllNonChatReferences": True,
    }
    write_private(evidence_dir / "before-snapshot.json", before)
    write_private(evidence_dir / "deployment-plan.json", plan)
    return {"pass": True, "dryRun": True, "plan": plan, "evidenceDir": str(evidence_dir)}


def wait_for(predicate, description: str, attempts: int = 60, delay: float = 1.0):
    latest = None
    for attempt in range(attempts):
        latest = predicate()
        if latest:
            return latest
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise RuntimeError(f"Timed out waiting for {description}")


def restore_reviewed_block(evidence_dir: Path, asset: dict) -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "deployment-plan.json")
    prior_html = before["edit"]["blockHtml"]
    current = capture(asset["path"])
    allowed_hashes = {plan["before"]["editBlockSha256"], plan["expectedBlockSha256"]}
    for workspace in ["edit", "live"]:
        if sha256(current[workspace]["blockHtml"]) not in allowed_hashes:
            raise RuntimeError(f"{workspace.upper()} drifted outside reviewed before/after hashes; refusing rollback")
    mutations = {"setBlockHtml": jahia.set_block_html(prior_html)}
    wait_for(lambda: jahia.block_html("EDIT") == prior_html, "exact rollback EDIT readback")
    mutations["createVersion"] = jahia.version_block()
    mutations["publishDriftSubtree"] = jahia.publish(DRIFT_PATH, subtree=True)
    mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=True)
    restored = wait_for(
        lambda: ({"edit": edit, "live": live} if (edit := jahia.block_html("EDIT")) == prior_html and (live := jahia.block_html("LIVE")) == prior_html else None),
        "exact rollback EDIT and LIVE readback",
    )
    result = {"pass": True, "sha256": sha256(prior_html), "mutations": mutations, "readback": {key: sha256(value) for key, value in restored.items()}}
    write_private(evidence_dir / "automatic-rollback-result.json", result, replace=(evidence_dir / "automatic-rollback-result.json").exists())
    return result


def apply(evidence_dir: Path) -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "deployment-plan.json")
    content = CHAT_SOURCE.read_text(encoding="utf-8")
    asset = chat_asset(content)
    if {key: value for key, value in asset.items() if key != "content"} != plan["asset"]:
        raise RuntimeError("Local chat asset drifted after reviewed dry-run")
    expected_html = update_block_html(before["edit"]["blockHtml"], asset)
    if sha256(expected_html) != plan["expectedBlockSha256"]:
        raise RuntimeError("Expected block payload drifted after reviewed dry-run")
    current = capture(asset["path"])
    if sha256(current["edit"]["blockHtml"]) != plan["before"]["editBlockSha256"] or sha256(current["live"]["blockHtml"]) != plan["before"]["liveBlockSha256"]:
        raise RuntimeError("EDIT or LIVE drifted after dry-run; refusing chat cutover")

    mutations = {}
    existing = current["edit"]["asset"]
    if existing is None:
        mutations["createAsset"] = jahia.upsert_file(asset["path"], content)
    elif existing["sha256"] != asset["sha256"]:
        raise RuntimeError(f"Immutable asset collision at {asset['path']}")
    else:
        mutations["createAsset"] = {"operation": "reuse", "path": asset["path"]}
    wait_for(
        lambda: (node if (node := compact_node(jahia.node(asset["path"], "EDIT"))) and node["sha256"] == asset["sha256"] else None),
        "exact immutable asset EDIT readback",
    )
    mutations["setBlockHtml"] = jahia.set_block_html(expected_html)
    wait_for(lambda: jahia.block_html("EDIT") == expected_html, "exact block EDIT readback")
    mutations["publishAssetContent"] = jahia.publish(asset["contentPath"], subtree=False)
    mutations["publishAsset"] = jahia.publish(asset["path"], subtree=False)
    mutations["createVersion"] = jahia.version_block()
    mutations["publishDriftSubtree"] = jahia.publish(DRIFT_PATH, subtree=True)
    mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=True)
    write_private(evidence_dir / "mutation-results.json", mutations, replace=True)

    latest = None
    for attempt in range(60):
        latest = capture(asset["path"])
        validation = validate(latest, expected_html, asset, include_public=False)
        if attempt == 0 and validation["checks"]["editBlockExact"] and not validation["checks"]["liveBlockExact"]:
            mutations["republishDriftSubtreeAfterStaleLiveReadback"] = jahia.publish(DRIFT_PATH, subtree=True)
            mutations["republishBlockAfterStaleLiveReadback"] = jahia.publish(BLOCK_PATH, subtree=True)
            write_private(evidence_dir / "mutation-results.json", mutations, replace=True)
        if validation["pass"]:
            validation = validate(latest, expected_html, asset, include_public=True)
            if validation["pass"]:
                break
        if attempt < 59:
            time.sleep(1)
    result = {
        "mode": "apply",
        "asset": plan["asset"],
        "mutations": mutations,
        "validation": validation,
    }
    write_private(evidence_dir / "deployment-result.json", result, replace=True)
    if not validation["pass"]:
        try:
            rollback = restore_reviewed_block(evidence_dir, asset)
        except Exception as rollback_error:
            rollback = {"pass": False, "error": str(rollback_error)}
        write_private(evidence_dir / "failed-validation.json", {"validation": validation, "rollback": rollback})
        raise RuntimeError("Immutable chat cutover validation failed")
    return result


def recover_publication(evidence_dir: Path) -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "deployment-plan.json")
    content = CHAT_SOURCE.read_text(encoding="utf-8")
    asset = chat_asset(content)
    if {key: value for key, value in asset.items() if key != "content"} != plan["asset"]:
        raise RuntimeError("Local chat asset drifted from the interrupted reviewed cutover")
    expected_html = update_block_html(before["edit"]["blockHtml"], asset)
    if sha256(expected_html) != plan["expectedBlockSha256"]:
        raise RuntimeError("Recovery payload does not match the reviewed cutover")
    current = capture(asset["path"])
    allowed_block_hashes = {plan["before"]["editBlockSha256"], plan["expectedBlockSha256"]}
    current_hashes = {workspace: sha256(current[workspace]["blockHtml"]) for workspace in ["edit", "live"]}
    if current_hashes["edit"] != plan["expectedBlockSha256"]:
        raise RuntimeError("Recovery requires EDIT to match the reviewed deployed block exactly")
    if current_hashes["live"] not in allowed_block_hashes:
        raise RuntimeError("LIVE drifted outside the reviewed before/after hashes; refusing recovery")
    for workspace in ["edit", "live"]:
        observed = current[workspace]["asset"]
        if observed is None or observed["sha256"] != asset["sha256"]:
            raise RuntimeError(f"Recovery requires the exact immutable asset in {workspace.upper()}")

    mutations = {
        "republishDriftSubtree": jahia.publish(DRIFT_PATH, subtree=True),
        "republishBlock": jahia.publish(BLOCK_PATH, subtree=True),
    }
    latest = None
    validation = None
    for attempt in range(60):
        latest = capture(asset["path"])
        validation = validate(latest, expected_html, asset, include_public=False)
        if validation["pass"]:
            validation = validate(latest, expected_html, asset, include_public=True)
            if validation["pass"]:
                break
        if attempt < 59:
            time.sleep(1)
    result = {
        "mode": "recover-publication",
        "mutationApplied": True,
        "asset": plan["asset"],
        "mutations": mutations,
        "validation": validation,
    }
    write_private(evidence_dir / "publication-recovery-result.json", result, replace=(evidence_dir / "publication-recovery-result.json").exists())
    if not validation or not validation["pass"]:
        raise RuntimeError("Interrupted immutable chat publication recovery failed")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--recover-publication", action="store_true")
    args = parser.parse_args()
    evidence_dir = safe_evidence_dir(args.evidence_dir)
    if args.recover_publication:
        result = recover_publication(evidence_dir)
    elif args.apply:
        result = apply(evidence_dir)
    else:
        result = dry_run(evidence_dir)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"pass": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
