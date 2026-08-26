#!/usr/bin/env python3
"""Default-dry-run cutover for inline confidence judging on the Jahia dev surface."""

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
DRIFT_PATH = "/sites/www/home/drift"
REQUIRED_MODE = "off"
CONFIDENCE_TAG = re.compile(r"<algolia-chat-confidence(?=[\s>])[^>]*>", re.I)
MODE_ATTRIBUTE = re.compile(r"\bmode\s*=\s*([\"'])(.*?)\1", re.I)


def active_mode_span(html: str) -> tuple[str, int, int]:
    tags = list(CONFIDENCE_TAG.finditer(html))
    if len(tags) != 1:
        raise RuntimeError(f"Expected exactly one algolia-chat-confidence element; found {len(tags)}")
    attributes = list(MODE_ATTRIBUTE.finditer(tags[0].group(0)))
    if len(attributes) != 1:
        raise RuntimeError(f"Expected exactly one confidence mode attribute; found {len(attributes)}")
    attribute = attributes[0]
    start = tags[0].start() + attribute.start(2)
    end = tags[0].start() + attribute.end(2)
    return attribute.group(2), start, end


def replace_confidence_mode(html: str, required_mode: str = REQUIRED_MODE) -> tuple[str, dict]:
    if required_mode != REQUIRED_MODE:
        raise RuntimeError(f"The only permitted runtime confidence mode is {REQUIRED_MODE}")
    observed, start, end = active_mode_span(html)
    updated = f"{html[:start]}{required_mode}{html[end:]}"
    if updated[:start] != html[:start] or updated[start + len(required_mode):] != html[end:]:
        raise RuntimeError("Confidence update did not produce a one-span byte diff")
    return updated, {
        "from": observed,
        "to": required_mode,
        "valueStart": start,
        "valueEnd": end,
        "beforeSha256": sha256(html),
        "afterSha256": sha256(updated),
        "beforeLength": len(html),
        "afterLength": len(updated),
    }


def capture_authenticated_snapshot() -> dict:
    edit = jahia.block_html("EDIT")
    live = jahia.block_html("LIVE")
    edit_mode, _, _ = active_mode_span(edit)
    live_mode, _, _ = active_mode_span(live)
    return {
        "schema": "JahiaConfidenceModeSnapshot.v1",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "target": {"origin": TARGET_ORIGIN, "path": BLOCK_PATH},
        "edit": {"html": edit, "sha256": sha256(edit), "mode": edit_mode},
        "live": {"html": live, "sha256": sha256(live), "mode": live_mode},
    }


def build_mutation_plan(snapshot: dict) -> dict:
    edit = snapshot["edit"]
    live = snapshot["live"]
    if edit["html"] != live["html"] or edit["sha256"] != live["sha256"]:
        raise RuntimeError("EDIT and LIVE block HTML must be identical before confidence cutover")
    updated, diff = replace_confidence_mode(edit["html"])
    operation = "noop" if edit["mode"].lower() == REQUIRED_MODE else "replace-one-confidence-mode-attribute"
    return {
        "schema": "JahiaConfidenceModeMutationPlan.v1",
        "operation": operation,
        "target": snapshot["target"],
        "requiredMode": REQUIRED_MODE,
        "before": {"editSha256": edit["sha256"], "liveSha256": live["sha256"], "mode": edit["mode"]},
        "after": {"expectedSha256": sha256(updated), "mode": REQUIRED_MODE},
        "diff": diff,
        "mutationAllowlist": [
            {"operation": "setBlockHtml", "path": BLOCK_PATH},
            {"operation": "version", "path": BLOCK_PATH},
            {"operation": "publish", "path": DRIFT_PATH, "subtree": True},
            {"operation": "publish", "path": BLOCK_PATH, "subtree": True},
        ],
        "rollback": {"snapshot": "before-snapshot.json", "requiredCurrentHashes": [sha256(updated)]},
    }


def public_identity() -> dict:
    query = urlencode({"stability_confidence_readback": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")})
    url = f"{TARGET_ORIGIN}/?{query}"
    html = jahia.fetch_public_bytes(url, user_agent="algolia-stability-confidence-readback/1").decode("utf-8", errors="replace")
    mode, _, _ = active_mode_span(html)
    return {"url": url.split("?", 1)[0], "htmlSha256": sha256(html), "mode": mode}


def validate_after(snapshot: dict, expected_html: str) -> dict:
    public = public_identity()
    checks = {
        "editExact": snapshot["edit"]["html"] == expected_html,
        "liveExact": snapshot["live"]["html"] == expected_html,
        "editModeOff": snapshot["edit"]["mode"].lower() == REQUIRED_MODE,
        "liveModeOff": snapshot["live"]["mode"].lower() == REQUIRED_MODE,
        "publicModeOff": public["mode"].lower() == REQUIRED_MODE,
        "activeModeAlgoliaAbsent": 'mode="algolia"' not in expected_html and "mode='algolia'" not in expected_html,
    }
    return {"pass": all(checks.values()), "checks": checks, "public": public}


def wait_for_exact_edit(expected_html: str, attempts: int = 20, delay: float = 0.5) -> dict:
    for attempt in range(attempts):
        snapshot = capture_authenticated_snapshot()
        if snapshot["edit"]["html"] == expected_html:
            return snapshot
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise RuntimeError("Exact confidence-mode EDIT readback did not appear; publish was not attempted")


def wait_for_publication(expected_html: str, attempts: int = 60, delay: float = 1.0) -> tuple[dict, dict]:
    latest_snapshot = None
    latest_validation = None
    for attempt in range(attempts):
        latest_snapshot = capture_authenticated_snapshot()
        latest_validation = validate_after(latest_snapshot, expected_html)
        if latest_validation["pass"]:
            return latest_snapshot, latest_validation
        if attempt + 1 < attempts:
            time.sleep(delay)
    assert latest_snapshot is not None and latest_validation is not None
    return latest_snapshot, latest_validation


def dry_run(evidence_dir: Path) -> dict:
    snapshot = capture_authenticated_snapshot()
    plan = build_mutation_plan(snapshot)
    write_private(evidence_dir / "before-snapshot.json", snapshot)
    write_private(evidence_dir / "mutation-plan.json", plan)
    return {
        "mode": "dry-run",
        "pass": True,
        "operation": plan["operation"],
        "activeMode": snapshot["edit"]["mode"],
        "requiredMode": REQUIRED_MODE,
        "beforeSha256": snapshot["edit"]["sha256"],
        "expectedAfterSha256": plan["after"]["expectedSha256"],
        "evidenceDir": str(evidence_dir),
        "mutationApplied": False,
    }


def restore_before(evidence_dir: Path, *, result_name: str = "rollback-result.json") -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "mutation-plan.json")
    current = capture_authenticated_snapshot()
    allowed = {plan["before"]["editSha256"], plan["after"]["expectedSha256"]}
    if current["edit"]["sha256"] not in allowed or current["live"]["sha256"] not in allowed:
        raise RuntimeError("Current EDIT or LIVE drifted outside reviewed before/after hashes; refusing rollback")
    prior_html = before["edit"]["html"]
    mutations = {"setBlockHtml": jahia.set_block_html(prior_html)}
    wait_for_exact_edit(prior_html)
    mutations["createVersion"] = jahia.version_block()
    mutations["publishDriftSubtree"] = jahia.publish(DRIFT_PATH, subtree=True)
    mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=True)
    for attempt in range(60):
        after = capture_authenticated_snapshot()
        if after["edit"]["html"] == prior_html and after["live"]["html"] == prior_html:
            break
        if attempt + 1 < 60:
            time.sleep(1)
    checks = {
        "editRestored": after["edit"]["sha256"] == before["edit"]["sha256"],
        "liveRestored": after["live"]["sha256"] == before["live"]["sha256"],
        "modeRestored": after["edit"]["mode"] == before["edit"]["mode"],
    }
    result = {"mode": "rollback", "pass": all(checks.values()), "checks": checks, "mutations": mutations}
    write_private(evidence_dir / result_name, result, replace=(evidence_dir / result_name).exists())
    if not result["pass"]:
        raise RuntimeError("Confidence-mode rollback readback failed")
    return result


def apply(evidence_dir: Path) -> dict:
    before = read_private(evidence_dir / "before-snapshot.json")
    plan = read_private(evidence_dir / "mutation-plan.json")
    current = capture_authenticated_snapshot()
    if current["edit"]["sha256"] != plan["before"]["editSha256"] or current["live"]["sha256"] != plan["before"]["liveSha256"]:
        raise RuntimeError("EDIT or LIVE drifted after dry-run; refusing confidence cutover")
    expected_html, diff = replace_confidence_mode(before["edit"]["html"])
    if sha256(expected_html) != plan["after"]["expectedSha256"] or diff != plan["diff"]:
        raise RuntimeError("Reviewed confidence-mode plan does not match the current implementation")
    if plan["operation"] == "noop":
        validation = validate_after(current, expected_html)
        result = {"mode": "apply", "operation": "noop", "mutationApplied": False, "validation": validation}
        write_private(evidence_dir / "mutation-result.json", result)
        return result

    mutations = {}
    try:
        mutations["setBlockHtml"] = jahia.set_block_html(expected_html)
        wait_for_exact_edit(expected_html)
        mutations["createVersion"] = jahia.version_block()
        mutations["publishDriftSubtree"] = jahia.publish(DRIFT_PATH, subtree=True)
        mutations["publishBlock"] = jahia.publish(BLOCK_PATH, subtree=True)
        initial_readback = capture_authenticated_snapshot()
        if initial_readback["edit"]["html"] == expected_html and initial_readback["live"]["html"] != expected_html:
            mutations["republishDriftSubtreeAfterStaleLiveReadback"] = jahia.publish(DRIFT_PATH, subtree=True)
            mutations["republishBlockAfterStaleLiveReadback"] = jahia.publish(BLOCK_PATH, subtree=True)
        write_private(evidence_dir / "mutation-progress.json", {"stage": "published", "mutations": mutations})
        after, validation = wait_for_publication(expected_html)
        write_private(evidence_dir / "after-snapshot.json", {**after, "validation": validation})
        result = {
            "mode": "apply",
            "operation": plan["operation"],
            "mutationApplied": True,
            "mutations": mutations,
            "afterSha256": after["edit"]["sha256"],
            "validation": validation,
        }
        write_private(evidence_dir / "mutation-result.json", result)
        if not validation["pass"]:
            raise RuntimeError("Confidence-mode mutation readback failed")
        return result
    except Exception as error:
        try:
            rollback = restore_before(evidence_dir, result_name="failed-apply-rollback.json")
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
    if args.rollback:
        result = restore_before(evidence_dir)
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
