#!/usr/bin/env python3
"""Default-dry-run removal of the obsolete client discovery switch from Jahia dev."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import deploy_jahia_engagement_tracker as jahia
from deploy_jahia_index_contract import read_private, safe_evidence_dir, sha256, write_private


TARGET_ORIGIN = "https://tmp-content-eng-algolia.cloud.jahia.com"
BLOCK_PATH = "/sites/www/home/drift/custom-code-block"
REQUIRED_MODE = "absent"
CHAT_TAG = re.compile(r"<algolia-chat(?=[\s>])[^>]*>", re.I)
DISCOVERY_ATTRIBUTE = re.compile(r"\s+discovery-enabled\s*=\s*([\"'])(.*?)\1", re.I)


def active_mode_span(html: str) -> tuple[str | None, int | None, int | None]:
    tags = list(CHAT_TAG.finditer(html))
    if len(tags) != 1:
        raise RuntimeError(f"Expected exactly one algolia-chat element; found {len(tags)}")
    attributes = list(DISCOVERY_ATTRIBUTE.finditer(tags[0].group(0)))
    if len(attributes) > 1:
        raise RuntimeError(f"Expected at most one discovery-enabled attribute; found {len(attributes)}")
    if not attributes:
        return None, None, None
    attribute = attributes[0]
    start = tags[0].start() + attribute.start()
    end = tags[0].start() + attribute.end()
    return attribute.group(2), start, end


def replace_discovery_mode(html: str) -> tuple[str, dict]:
    observed, start, end = active_mode_span(html)
    if observed is None or start is None or end is None:
        return html, {
            "from": None,
            "to": REQUIRED_MODE,
            "valueStart": None,
            "valueEnd": None,
            "beforeSha256": sha256(html),
            "afterSha256": sha256(html),
            "beforeLength": len(html),
            "afterLength": len(html),
        }
    updated = f"{html[:start]}{html[end:]}"
    if updated[:start] != html[:start] or updated[start:] != html[end:]:
        raise RuntimeError("Discovery update did not produce a one-span byte diff")
    return updated, {
        "from": observed,
        "to": REQUIRED_MODE,
        "valueStart": start,
        "valueEnd": end,
        "beforeSha256": sha256(html),
        "afterSha256": sha256(updated),
        "beforeLength": len(html),
        "afterLength": len(updated),
    }


def capture_snapshot() -> dict:
    edit = jahia.block_html("EDIT")
    live = jahia.block_html("LIVE")
    edit_mode, _, _ = active_mode_span(edit)
    live_mode, _, _ = active_mode_span(live)
    return {
        "schema": "JahiaDiscoveryModeSnapshot.v1",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "target": {"origin": TARGET_ORIGIN, "path": BLOCK_PATH},
        "edit": {"html": edit, "sha256": sha256(edit), "mode": edit_mode},
        "live": {"html": live, "sha256": sha256(live), "mode": live_mode},
    }


def build_plan(snapshot: dict) -> dict:
    edit, live = snapshot["edit"], snapshot["live"]
    if edit["html"] != live["html"] or edit["sha256"] != live["sha256"]:
        raise RuntimeError("EDIT and LIVE block HTML must be identical before discovery cutover")
    updated, diff = replace_discovery_mode(edit["html"])
    operation = "noop" if edit["mode"] is None else "remove-one-discovery-enabled-attribute"
    return {
        "schema": "JahiaDiscoveryModeMutationPlan.v1",
        "operation": operation,
        "target": snapshot["target"],
        "requiredMode": REQUIRED_MODE,
        "before": {"editSha256": edit["sha256"], "liveSha256": live["sha256"], "mode": edit["mode"]},
        "after": {"expectedSha256": sha256(updated), "mode": None},
        "diff": diff,
        "mutationAllowlist": [
            {"operation": "setBlockHtml", "path": BLOCK_PATH},
            {"operation": "version", "path": BLOCK_PATH},
            {"operation": "publish", "path": BLOCK_PATH, "subtree": True},
        ],
        "rollback": {"snapshot": "before-snapshot.json", "requiredCurrentHashes": [sha256(updated)]},
    }


def public_identity() -> dict:
    query = urlencode({"stability_discovery_readback": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")})
    url = f"{TARGET_ORIGIN}/?{query}"
    html = jahia.fetch_public_bytes(url, user_agent="algolia-discovery-mode-readback/1").decode("utf-8", errors="replace")
    mode, _, _ = active_mode_span(html)
    return {"url": url.split("?", 1)[0], "htmlSha256": sha256(html), "mode": mode}


def validate_after(snapshot: dict, expected_html: str) -> dict:
    public = public_identity()
    checks = {
        "editExact": snapshot["edit"]["html"] == expected_html,
        "liveExact": snapshot["live"]["html"] == expected_html,
        "editAttributeAbsent": snapshot["edit"]["mode"] is None,
        "liveAttributeAbsent": snapshot["live"]["mode"] is None,
        "publicAttributeAbsent": public["mode"] is None,
    }
    return {"pass": all(checks.values()), "checks": checks, "public": public}


def wait_for_edit(expected_html: str, attempts: int = 20) -> dict:
    for attempt in range(attempts):
        snapshot = capture_snapshot()
        if snapshot["edit"]["html"] == expected_html:
            return snapshot
        if attempt + 1 < attempts:
            time.sleep(0.5)
    raise RuntimeError("Exact discovery-mode EDIT readback did not appear; publish was not attempted")


def wait_for_publication(expected_html: str, attempts: int = 60) -> tuple[dict, dict]:
    for attempt in range(attempts):
        snapshot = capture_snapshot()
        validation = validate_after(snapshot, expected_html)
        if validation["pass"]:
            return snapshot, validation
        if attempt + 1 < attempts:
            time.sleep(1)
    return snapshot, validation


def dry_run(evidence_dir: Path) -> dict:
    snapshot = capture_snapshot()
    plan = build_plan(snapshot)
    write_private(evidence_dir / "before-snapshot.json", snapshot)
    write_private(evidence_dir / "mutation-plan.json", plan)
    return {
        "mode": "dry-run", "pass": True, "operation": plan["operation"],
        "activeMode": snapshot["edit"]["mode"], "requiredMode": REQUIRED_MODE,
        "beforeSha256": snapshot["edit"]["sha256"], "expectedAfterSha256": plan["after"]["expectedSha256"],
        "evidenceDir": str(evidence_dir), "mutationApplied": False,
    }


def restore(evidence_dir: Path, result_name: str = "rollback-result.json") -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "mutation-plan.json")
    current = capture_snapshot()
    allowed = {plan["before"]["editSha256"], plan["after"]["expectedSha256"]}
    if current["edit"]["sha256"] not in allowed or current["live"]["sha256"] not in allowed:
        raise RuntimeError("Current EDIT or LIVE drifted outside reviewed hashes; refusing rollback")
    prior_html = before["edit"]["html"]
    mutations = {"setBlockHtml": jahia.set_block_html(prior_html)}
    wait_for_edit(prior_html)
    mutations["createVersion"] = jahia.version_block()
    mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=True)
    after, _ = wait_for_publication(prior_html)
    checks = {
        "editRestored": after["edit"]["sha256"] == before["edit"]["sha256"],
        "liveRestored": after["live"]["sha256"] == before["live"]["sha256"],
        "modeRestored": after["edit"]["mode"] == before["edit"]["mode"],
    }
    result = {"mode": "rollback", "pass": all(checks.values()), "checks": checks, "mutations": mutations}
    write_private(evidence_dir / result_name, result, replace=(evidence_dir / result_name).exists())
    if not result["pass"]:
        raise RuntimeError("Discovery-mode rollback failed")
    return result


def apply(evidence_dir: Path) -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "mutation-plan.json")
    current = capture_snapshot()
    if current["edit"]["sha256"] != plan["before"]["editSha256"] or current["live"]["sha256"] != plan["before"]["liveSha256"]:
        raise RuntimeError("EDIT or LIVE drifted after dry-run; refusing discovery cutover")
    expected_html, diff = replace_discovery_mode(before["edit"]["html"])
    if sha256(expected_html) != plan["after"]["expectedSha256"] or diff != plan["diff"]:
        raise RuntimeError("Reviewed discovery-mode plan no longer matches")
    if plan["operation"] == "noop":
        validation = validate_after(current, expected_html)
        return {"mode": "apply", "operation": "noop", "mutationApplied": False, "validation": validation}
    try:
        mutations = {"setBlockHtml": jahia.set_block_html(expected_html)}
        wait_for_edit(expected_html)
        mutations["createVersion"] = jahia.version_block()
        mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=True)
        after, validation = wait_for_publication(expected_html)
        write_private(evidence_dir / "after-snapshot.json", {**after, "validation": validation})
        result = {"mode": "apply", "operation": plan["operation"], "mutationApplied": True, "mutations": mutations, "validation": validation}
        write_private(evidence_dir / "mutation-result.json", result)
        if not validation["pass"]:
            raise RuntimeError("Discovery-mode readback failed")
        return result
    except Exception as error:
        try:
            rollback = restore(evidence_dir, "failed-apply-rollback.json")
        except Exception as rollback_error:
            rollback = {"pass": False, "error": str(rollback_error)}
        write_private(evidence_dir / "failed-apply.json", {"error": str(error), "rollback": rollback})
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    evidence_dir = safe_evidence_dir(args.evidence_dir)
    result = restore(evidence_dir) if args.rollback else apply(evidence_dir) if args.apply else dry_run(evidence_dir)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"pass": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
