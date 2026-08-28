#!/usr/bin/env python3
"""Plan, apply, validate, and roll back the chat observer integration on Jahia."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import deploy_jahia_engagement_tracker as jahia
import judge_release_guard


ROOT = Path(__file__).resolve().parents[2]
BLOCK = jahia.BLOCK_PATH
FILES = "/sites/www/files"
PUBLIC = "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files"
RENDERED_PAGE = "https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html"
PRIVATE_ROOT = ROOT / ".local/deployment-state/compare-integration-jahia"
COMPARE_ENV = ROOT / ".env.compare.local"
PROD_APP_ID = "1QDAWL72TQ"
PROD_AGENT_ID = "ebff018c-66e1-44df-b33a-2a58a0188840"
TOKEN_TELEMETRY_URL = (
    "https://tmp-content-eng-algolia.cloud.jahia.com/"
    "sites/algolia-assets/home.algoliaTokenTelemetry.do"
)
TOKEN_TELEMETRY_ORIGIN = "https://tmp-content-eng-algolia.cloud.jahia.com"
TOKEN_TELEMETRY_SMOKE_ID_ENV = "TOKEN_TELEMETRY_SMOKE_CONVERSATION_ID"
COMPARE_API_KEY_ENV = "PROD_ASKAI_API_KEY"
LEGACY_COMPARE_API_KEY_ENV = "PROD_ASKAI_SEARCH_KEY"
COMPARE_ENV_KEYS = frozenset({COMPARE_API_KEY_ENV, LEGACY_COMPARE_API_KEY_ENV})
COMPARE_CONFIG_RE = r"<script>window\.ACS_COMPARE=.*?</script>"
SOURCES = {
    "context": ROOT / "frontend/chat-widget/algolia-context-compiler.js",
    "handoff": ROOT / "frontend/chat-widget/handoff-to-orchestrator.js",
    "compare": ROOT / "frontend/chat-widget/algolia-chat-compare.js",
    "telemetry": ROOT / "frontend/chat-widget/token-telemetry.js",
}
RELEASE_ASSET_KEYS = ("handoff", "compare")
STEMS = {
    "context": "algolia-context-compiler",
    "handoff": "handoff-to-orchestrator",
    "compare": "algolia-chat-compare",
    "telemetry": "token-telemetry",
}


def sha256(value: str | bytes) -> str:
    raw = value if isinstance(value, bytes) else value.encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def git_output(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def assert_clean_commit(expected: str | None = None) -> str:
    commit = git_output("rev-parse", "HEAD")
    if expected and commit != expected:
        raise RuntimeError(f"Source commit changed: expected {expected}, found {commit}")
    dirty = git_output("status", "--porcelain", "--untracked-files=no")
    if dirty:
        raise RuntimeError("Tracked worktree changes exist; deploy only from a clean reviewed commit")
    return commit


def load_compare_env(required: bool = False) -> dict[str, str]:
    values: dict[str, str] = {}
    if COMPARE_ENV.exists():
        for raw in COMPARE_ENV.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key in COMPARE_ENV_KEYS:
                values[key] = value.strip().strip('"').strip("'")
    for key in COMPARE_ENV_KEYS:
        if os.environ.get(key):
            values[key] = os.environ[key]
    api_key = values.get(COMPARE_API_KEY_ENV) or values.get(LEGACY_COMPARE_API_KEY_ENV) or ""
    if required and not api_key:
        raise RuntimeError(
            f"Missing Compare API configuration: {COMPARE_API_KEY_ENV} "
            f"(legacy alias {LEGACY_COMPARE_API_KEY_ENV})"
        )
    return {COMPARE_API_KEY_ENV: api_key}


def config_fingerprint(config: dict[str, str]) -> str:
    return sha256("\0".join([PROD_APP_ID, PROD_AGENT_ID, config[COMPARE_API_KEY_ENV]]))


def existing_compare_config_tag(block_html: str) -> str | None:
    matches = re.findall(COMPARE_CONFIG_RE, block_html, flags=re.I | re.S)
    if len(matches) > 1:
        raise RuntimeError(f"Expected zero or one Compare config tag; found {len(matches)}")
    return matches[0] if matches else None


def compare_config_fingerprint_from_html(block_html: str) -> str:
    tag = existing_compare_config_tag(block_html)
    if not tag:
        raise RuntimeError("Compare config tag is absent")
    return sha256(tag)


def validate_token_telemetry_backend(conversation_id: str) -> dict[str, bool]:
    """Prove the live action, runtime secret, and upstream lookup before JS cutover."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", conversation_id or ""):
        raise RuntimeError(f"Invalid {TOKEN_TELEMETRY_SMOKE_ID_ENV}")
    request = urllib.request.Request(
        TOKEN_TELEMETRY_URL,
        data=urllib.parse.urlencode({"conversationId": conversation_id}).encode("ascii"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": TOKEN_TELEMETRY_ORIGIN,
            "User-Agent": "algolia-token-telemetry-deployment-gate/1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20, context=jahia.ssl_context()) as response:
            content_type = response.headers.get_content_type()
            raw_body = response.read(65_537)
            if len(raw_body) > 65_536:
                raise ValueError("Telemetry response exceeded deployment-gate limit")
            body = json.loads(raw_body.decode("utf-8"))
            status = response.status
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as error:
        raise RuntimeError("Live token telemetry backend preflight failed") from error
    if not isinstance(body, dict):
        raise RuntimeError("Live token telemetry backend returned an invalid contract")
    totals = [body.get(key) for key in ("inputTokens", "outputTokens", "totalTokens")]
    checks = {
        "httpOk": status == 200,
        "jsonResponse": content_type == "application/json",
        "tokenTotalsOnly": set(body) == {"inputTokens", "outputTokens", "totalTokens"},
        "nonNegativeIntegerTotals": all(isinstance(value, int) and value >= 0 for value in totals),
    }
    checks["pass"] = all(checks.values())
    if not checks["pass"]:
        raise RuntimeError("Live token telemetry backend returned an invalid contract")
    return checks


def release_filename(key: str, digest: str) -> str:
    if key == "handoff":
        return f"{STEMS[key]}-compare-{digest[:12]}.js"
    if key == "compare":
        return f"{STEMS[key]}-{digest[:12]}.js"
    raise KeyError(f"Unsupported immutable release asset: {key}")


def immutable_assets() -> dict[str, dict[str, str]]:
    assets = {}
    for key in RELEASE_ASSET_KEYS:
        source = SOURCES[key]
        content = source.read_text(encoding="utf-8")
        if key == "compare":
            judge_release_guard.validate_compare_runtime(content)
        digest = sha256(content)
        filename = release_filename(key, digest)
        assets[key] = {
            "source": str(source.relative_to(ROOT)),
            "content": content,
            "sha256": digest,
            "filename": filename,
            "path": f"{FILES}/{filename}",
            "url": f"{PUBLIC}/{filename}",
        }
    return assets


def replace_one(pattern: str, replacement: str, value: str, label: str) -> str:
    matches = re.findall(pattern, value, flags=re.I)
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one {label}; found {len(matches)}")
    return re.sub(pattern, replacement, value, count=1, flags=re.I)


def script_pattern(key: str) -> str:
    stem = STEMS[key]
    version = (
        r"(?:-[a-f0-9]{12})?"
        if key in {"compare", "telemetry"}
        else r"(?:-compare-[a-f0-9]{12})?"
    )
    return (
        rf'<script src="{re.escape(PUBLIC)}/{re.escape(stem)}'
        rf'{version}\.js(?:\?[^"\n]*)?"></script>'
    )


def compare_config_tag(config: dict[str, str]) -> str:
    payload = {
        "prod": {
            "appId": PROD_APP_ID,
            "apiKey": config[COMPARE_API_KEY_ENV],
            "agentId": PROD_AGENT_ID,
        }
    }
    encoded = json.dumps(payload, separators=(",", ":")).replace("<", "\\u003c")
    return f"<script>window.ACS_COMPARE={encoded};</script>"


def update_block_html(current: str, assets: dict, config: dict[str, str] | None = None) -> str:
    compare_config = existing_compare_config_tag(current)
    if compare_config is None:
        compare_config = compare_config_tag(config or load_compare_env(required=True))

    context_count = len(re.findall(script_pattern("context"), current, flags=re.I))
    if context_count != 1:
        raise RuntimeError(f"Expected exactly one context compiler script; found {context_count}")
    next_html = current

    handoff_pattern = script_pattern("handoff")
    handoff_count = len(re.findall(handoff_pattern, next_html, flags=re.I))
    handoff_tag = f'<script src="{assets["handoff"]["url"]}"></script>'
    if handoff_count == 1:
        next_html = re.sub(handoff_pattern, handoff_tag, next_html, count=1, flags=re.I)
    elif handoff_count == 0:
        proactive = re.findall(
            rf'<script src="{re.escape(PUBLIC)}/algolia-proactive-controller\.js(?:\?[^"\n]*)?"></script>',
            next_html,
            flags=re.I,
        )
        if len(proactive) != 1:
            raise RuntimeError("Handoff is absent and no unique proactive-controller insertion point exists")
        next_html = next_html.replace(proactive[0], proactive[0] + "\n" + handoff_tag, 1)
    else:
        raise RuntimeError(f"Expected zero or one handoff script; found {handoff_count}")

    next_html = re.sub(rf"\n?{COMPARE_CONFIG_RE}", "", next_html, flags=re.I | re.S)
    compare_pattern = script_pattern("compare")
    compare_count = len(re.findall(compare_pattern, next_html, flags=re.I))
    if compare_count > 1:
        raise RuntimeError(f"Expected zero or one Compare script; found {compare_count}")
    next_html = re.sub(rf"\n?{compare_pattern}", "", next_html, count=1, flags=re.I)
    compare_block = (
        compare_config
        + "\n"
        + f'<script src="{assets["compare"]["url"]}"></script>'
    )
    telemetry_count = len(re.findall(script_pattern("telemetry"), next_html, flags=re.I))
    if telemetry_count > 1:
        raise RuntimeError(f"Expected zero or one telemetry script; found {telemetry_count}")
    return next_html.replace(handoff_tag, handoff_tag + "\n" + compare_block, 1)


def compact_node(path: str, workspace: str) -> dict | None:
    observed = jahia.node(path, workspace)
    if observed is None:
        return None
    content = jahia.file_content(observed) or ""
    return {"path": path, "sha256": sha256(content), "length": len(content)}


def capture(assets: dict) -> dict:
    return {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "edit": {
            "blockHtml": jahia.block_html("EDIT"),
            "assets": {key: compact_node(asset["path"], "EDIT") for key, asset in assets.items()},
        },
        "live": {
            "blockHtml": jahia.block_html("LIVE"),
            "assets": {key: compact_node(asset["path"], "LIVE") for key, asset in assets.items()},
        },
    }


def public_capture(snapshot: dict) -> dict:
    return {
        "capturedAt": snapshot["capturedAt"],
        "edit": {
            "blockSha256": sha256(snapshot["edit"]["blockHtml"]),
            "blockLength": len(snapshot["edit"]["blockHtml"]),
            "assets": snapshot["edit"]["assets"],
        },
        "live": {
            "blockSha256": sha256(snapshot["live"]["blockHtml"]),
            "blockLength": len(snapshot["live"]["blockHtml"]),
            "assets": snapshot["live"]["assets"],
        },
    }


def referenced_dependency_urls(block_html: str) -> dict[str, str]:
    urls: dict[str, str] = {}
    for key in SOURCES:
        matches = re.findall(script_pattern(key), block_html, flags=re.I)
        if len(matches) != 1:
            raise RuntimeError(f"Expected exactly one referenced {key} dependency; found {len(matches)}")
        urls[key] = re.search(r'src="([^"]+)"', matches[0], flags=re.I).group(1)
    return urls


def capture_referenced_dependencies(block_html: str) -> dict[str, dict]:
    observed: dict[str, dict] = {}
    for key, url in referenced_dependency_urls(block_html).items():
        if not url.startswith(PUBLIC + "/"):
            raise RuntimeError(f"Unexpected {key} dependency origin: {url}")
        path = FILES + "/" + url.removeprefix(PUBLIC + "/").split("?", 1)[0]
        edit = compact_node(path, "EDIT")
        live = compact_node(path, "LIVE")
        public_hash = sha256(fetch_bytes(url))
        if not edit or not live or edit["sha256"] != live["sha256"] or live["sha256"] != public_hash:
            raise RuntimeError(f"Referenced {key} dependency is not identical in EDIT, LIVE, and public readback")
        observed[key] = {
            "url": url,
            "path": path,
            "sha256": public_hash,
            "length": edit["length"],
        }
    return observed


def assert_displaced_dependencies_unchanged(plan: dict, block_html: str) -> None:
    if capture_referenced_dependencies(block_html) != plan["displacedDependencies"]:
        raise RuntimeError("Referenced runtime asset drifted after plan approval; no mutation made")


def write_private(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def create_immutable(asset: dict) -> dict:
    existing = jahia.node(asset["path"], "EDIT")
    if existing is not None:
        if (jahia.file_content(existing) or "") == asset["content"]:
            return {"operation": "reuse", "path": asset["path"], "sha256": asset["sha256"]}
        raise RuntimeError(f"Immutable asset path exists with different content: {asset['path']}")
    else:
        jahia.upsert_file(asset["path"], asset["content"])
        operation = "create"
    for attempt in range(8):
        observed = jahia.node(asset["path"], "EDIT")
        if observed is not None and (jahia.file_content(observed) or "") == asset["content"]:
            return {"operation": operation, "path": asset["path"], "sha256": asset["sha256"]}
        if attempt < 7:
            time.sleep(0.5)
    raise RuntimeError(f"Immutable asset readback failed: {asset['path']}")


def restore_block_with_cas(before: str, allowed_hashes: set[str], attempts: int = 5) -> dict:
    """Restore EDIT while refusing to cross a concurrent block change."""
    for attempt in range(attempts):
        current = {workspace: jahia.block_html(workspace) for workspace in ["EDIT", "LIVE"]}
        unexpected = [
            workspace for workspace, html in current.items() if sha256(html) not in allowed_hashes
        ]
        if unexpected:
            raise RuntimeError(f"Rollback refused after concurrent change in: {', '.join(unexpected)}")
        try:
            return jahia.set_block_html(before)
        except RuntimeError as error:
            if "InvalidItemStateException" not in str(error) or attempt + 1 >= attempts:
                raise
            time.sleep(0.5 * (attempt + 1))
    raise AssertionError("unreachable")


def restore(plan_path: Path) -> dict:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    before = plan["beforeBlockHtml"]
    before_hash = plan["beforeBlockSha256"]
    deployed_hash = plan["expectedBlockSha256"]
    if sha256(before) != before_hash:
        raise RuntimeError("Rollback plan is corrupted")
    current = {workspace: jahia.block_html(workspace) for workspace in ["EDIT", "LIVE"]}
    allowed_hashes = {before_hash, deployed_hash}
    unexpected = [name for name, html in current.items() if sha256(html) not in allowed_hashes]
    if unexpected:
        raise RuntimeError(f"Rollback refused after concurrent change in: {', '.join(unexpected)}")
    if all(sha256(value) == before_hash for value in current.values()):
        return {"pass": True, "alreadyRestored": True, "sha256": before_hash}
    restore_block_with_cas(before, allowed_hashes)
    jahia.version_block()
    jahia.publish(BLOCK, subtree=True)
    for _ in range(8):
        edit, live = jahia.block_html("EDIT"), jahia.block_html("LIVE")
        if edit == before and live == before:
            return {"pass": True, "sha256": before_hash}
        time.sleep(2)
        jahia.publish(BLOCK, subtree=True)
    raise RuntimeError("Rollback readback failed")


def fetch_bytes(url: str) -> bytes:
    return jahia.fetch_public_bytes(
        url,
        user_agent="algolia-compare-integration-readback/1",
    )


def validate_live(assets: dict, expected_html: str) -> dict:
    edit, live = jahia.block_html("EDIT"), jahia.block_html("LIVE")
    context_matches = re.findall(script_pattern("context"), live, flags=re.I)
    telemetry_matches = re.findall(script_pattern("telemetry"), live, flags=re.I)
    checks = {
        "editBlockMatches": edit == expected_html,
        "liveBlockMatches": live == expected_html,
        "contextReferencePreserved": len(context_matches) == 1,
        "telemetryReferencePreserved": len(telemetry_matches) == 1,
        "loadOrder": (
            len(context_matches) == 1
            and len(telemetry_matches) == 1
            and 0 <= live.find(context_matches[0])
            < live.find(assets["handoff"]["url"])
            < live.find(assets["compare"]["url"])
            < live.find(telemetry_matches[0])
        ),
    }
    for workspace in ["EDIT", "LIVE"]:
        for key, asset in assets.items():
            observed = compact_node(asset["path"], workspace)
            checks[f"{workspace.lower()}_{key}_hash"] = observed is not None and observed["sha256"] == asset["sha256"]
    for key, asset in assets.items():
        checks[f"public_{key}_hash"] = sha256(fetch_bytes(asset["url"])) == asset["sha256"]
    rendered = fetch_bytes(RENDERED_PAGE).decode("utf-8", errors="replace")
    checks["renderedExactReferences"] = all(rendered.count(asset["url"]) == 1 for asset in assets.values())
    checks["pass"] = all(checks.values())
    return checks


def create_plan(evidence_dir: Path) -> Path:
    commit = assert_clean_commit()
    assets = immutable_assets()
    before = capture(assets)
    if before["edit"]["blockHtml"] != before["live"]["blockHtml"]:
        raise RuntimeError("EDIT and LIVE blocks differ; reconcile before Compare deployment")
    displaced_dependencies = capture_referenced_dependencies(before["edit"]["blockHtml"])
    expected = update_block_html(before["edit"]["blockHtml"], assets)
    compare_config_fingerprint = compare_config_fingerprint_from_html(expected)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    private_path = PRIVATE_ROOT / run_id / "apply-plan.json"
    private_plan = {
        "schema": "CompareIntegrationApplyPlan.v1",
        "sourceCommit": commit,
        "configFingerprint": compare_config_fingerprint,
        "compareConfigMode": "preserve-existing",
        "assets": assets,
        "displacedDependencies": displaced_dependencies,
        "beforeBlockHtml": before["edit"]["blockHtml"],
        "beforeBlockSha256": sha256(before["edit"]["blockHtml"]),
        "expectedBlockHtml": expected,
        "expectedBlockSha256": sha256(expected),
    }
    write_private(private_path, private_plan)
    public_plan = {
        "schema": "CompareIntegrationDeploymentPlan.v1",
        "sourceCommit": commit,
        "scope": "two immutable chat integration assets plus one exact custom block",
        "activationPrerequisite": (
            "The deployer preserves the existing live window.ACS_COMPARE config by default. "
            f"If {TOKEN_TELEMETRY_SMOKE_ID_ENV} is set, the token telemetry backend must pass "
            "a live read-only conversation lookup before browser assets are mutated."
        ),
        "assets": {
            key: {field: value for field, value in asset.items() if field != "content"}
            for key, asset in assets.items()
        },
        "before": public_capture(before),
        "displacedDependencies": displaced_dependencies,
        "expectedBlockSha256": sha256(expected),
        "configFingerprint": compare_config_fingerprint,
        "compareConfigMode": "preserve-existing",
        "privatePlanSha256": sha256(private_path.read_bytes()),
        "mutationAllowlist": [asset["path"] for asset in assets.values()] + [BLOCK],
        "oldAssetsRemainUntouched": True,
        "assetUpdateMode": "content-addressed create/reuse for handoff and compare only",
        "applyCommand": f"python3 tools/deployment/deploy_compare_integration_jahia.py --apply-plan {private_path}",
        "rollbackCommand": f"python3 tools/deployment/deploy_compare_integration_jahia.py --rollback {private_path}",
    }
    jahia.write_json(evidence_dir / "deployment-plan.json", public_plan)
    print(json.dumps({"pass": True, "dryRun": True, "privatePlan": str(private_path), "plan": public_plan}, indent=2))
    return private_path


def apply_plan(plan_path: Path, evidence_dir: Path) -> int:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("schema") != "CompareIntegrationApplyPlan.v1":
        raise RuntimeError("Unsupported Compare apply plan")
    assert_clean_commit(plan["sourceCommit"])
    smoke_conversation_id = os.environ.get(TOKEN_TELEMETRY_SMOKE_ID_ENV, "")
    backend_checks = (
        validate_token_telemetry_backend(smoke_conversation_id)
        if smoke_conversation_id
        else {"pass": True, "skipped": True, "reason": f"{TOKEN_TELEMETRY_SMOKE_ID_ENV} not set"}
    )
    assets = immutable_assets()
    for key, asset in assets.items():
        planned = plan["assets"][key]
        if asset["sha256"] != planned["sha256"] or asset["path"] != planned["path"]:
            raise RuntimeError(f"Source asset changed after plan approval: {key}")
    expected = update_block_html(plan["beforeBlockHtml"], assets)
    if compare_config_fingerprint_from_html(expected) != plan["configFingerprint"]:
        raise RuntimeError("Compare configuration changed after plan approval")
    if sha256(expected) != plan["expectedBlockSha256"] or expected != plan["expectedBlockHtml"]:
        raise RuntimeError("Expected block changed after plan approval")
    current = {workspace: jahia.block_html(workspace) for workspace in ["EDIT", "LIVE"]}
    if any(sha256(value) != plan["beforeBlockSha256"] for value in current.values()):
        raise RuntimeError("Jahia block drifted after plan approval; no mutation made")
    assert_displaced_dependencies_unchanged(plan, current["EDIT"])

    mutations = {}
    try:
        for key, asset in assets.items():
            mutations[f"asset_{key}"] = create_immutable(asset)
        assert_displaced_dependencies_unchanged(plan, jahia.block_html("EDIT"))
        if sha256(jahia.block_html("EDIT")) != plan["beforeBlockSha256"]:
            raise RuntimeError("Jahia block changed immediately before cutover")
        mutations["setBlockHtml"] = jahia.set_block_html(expected)
        for key, asset in assets.items():
            mutations[f"publish_{key}_content"] = jahia.publish(f"{asset['path']}/jcr:content", subtree=False)
            mutations[f"publish_{key}"] = jahia.publish(asset["path"], subtree=False)
        mutations["versionBlock"] = jahia.version_block()
        mutations["publishBlock"] = jahia.publish(BLOCK, subtree=True)
        checks = None
        for _ in range(8):
            checks = validate_live(assets, expected)
            if checks["pass"]:
                break
            time.sleep(2)
        if not checks or not checks["pass"]:
            raise RuntimeError("Compare deployment readback failed")
    except Exception as error:
        try:
            rollback = restore(plan_path)
        except Exception as rollback_error:
            rollback = {"pass": False, "error": str(rollback_error)}
        jahia.write_json(evidence_dir / "failed-apply-rollback.json", {
            "pass": False, "error": str(error), "mutations": mutations, "rollback": rollback,
        })
        raise
    jahia.write_json(evidence_dir / "mutation-results.json", mutations)
    jahia.write_json(evidence_dir / "backend-preflight.json", backend_checks)
    jahia.write_json(evidence_dir / "deployment-validation.json", checks)
    print(json.dumps(checks, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply-plan", type=Path)
    parser.add_argument("--rollback", type=Path)
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    evidence_dir = args.evidence_dir or ROOT / "docs/evidence/deployments" / f"compare-integration-{run_id}"
    if not evidence_dir.is_absolute():
        evidence_dir = ROOT / evidence_dir
    if args.rollback:
        result = restore(args.rollback.resolve())
        jahia.write_json(evidence_dir / "rollback-readback.json", result)
        print(json.dumps(result, indent=2))
        return 0
    if args.apply_plan:
        return apply_plan(args.apply_plan.resolve(), evidence_dir)
    create_plan(evidence_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
