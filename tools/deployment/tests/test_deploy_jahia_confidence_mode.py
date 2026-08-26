import importlib.util
import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/deployment"))
spec = importlib.util.spec_from_file_location(
    "deploy_jahia_confidence_mode", ROOT / "tools/deployment/deploy_jahia_confidence_mode.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


HTML = '''<main><algolia-chat-confidence data-x="preserved" mode="algolia">
<algolia-agent role="skeptic" agent-id="s"></algolia-agent>
<algolia-agent role="referee" agent-id="r"></algolia-agent>
<algolia-agent role="advocate" agent-id="a"></algolia-agent>
</algolia-chat-confidence></main>'''


def snapshot(html=HTML):
    mode, _, _ = module.active_mode_span(html)
    return {
        "target": {"origin": module.TARGET_ORIGIN, "path": module.BLOCK_PATH},
        "edit": {"html": html, "sha256": module.sha256(html), "mode": mode},
        "live": {"html": html, "sha256": module.sha256(html), "mode": mode},
    }


def test_replaces_only_the_confidence_mode_value():
    updated, diff = module.replace_confidence_mode(HTML)
    assert updated == HTML.replace('mode="algolia"', 'mode="off"')
    assert diff["from"] == "algolia"
    assert diff["to"] == "off"
    assert updated.replace('mode="off"', 'mode="algolia"') == HTML


def test_rejects_missing_or_duplicate_confidence_elements():
    with pytest.raises(RuntimeError, match="found 0"):
        module.replace_confidence_mode("<main></main>")
    with pytest.raises(RuntimeError, match="found 2"):
        module.replace_confidence_mode(f"{HTML}{HTML}")


def test_plan_is_narrow_reversible_and_dev_only():
    plan = module.build_mutation_plan(snapshot())
    assert plan["operation"] == "replace-one-confidence-mode-attribute"
    assert plan["requiredMode"] == "off"
    assert plan["target"]["origin"] == "https://tmp-content-eng-algolia.cloud.jahia.com"
    assert plan["rollback"]["snapshot"] == "before-snapshot.json"
    assert {entry["path"] for entry in plan["mutationAllowlist"]} == {module.BLOCK_PATH, module.DRIFT_PATH}


def test_plan_is_noop_when_already_off():
    plan = module.build_mutation_plan(snapshot(HTML.replace('mode="algolia"', 'mode="off"')))
    assert plan["operation"] == "noop"


def test_plan_rejects_edit_live_drift():
    value = snapshot()
    value["live"]["html"] += "<!-- drift -->"
    value["live"]["sha256"] = module.sha256(value["live"]["html"])
    with pytest.raises(RuntimeError, match="EDIT and LIVE"):
        module.build_mutation_plan(value)


def test_apply_refuses_state_drift_before_mutation(tmp_path, monkeypatch):
    before = snapshot()
    plan = module.build_mutation_plan(before)
    (tmp_path / "before-snapshot.json").write_text(json.dumps(before))
    (tmp_path / "mutation-plan.json").write_text(json.dumps(plan))
    drifted = snapshot(HTML + "<!-- concurrent -->")
    monkeypatch.setattr(module, "capture_authenticated_snapshot", lambda: drifted)
    with pytest.raises(RuntimeError, match="drifted after dry-run"):
        module.apply(tmp_path)


def test_apply_republishes_once_when_edit_is_exact_but_live_is_stale(tmp_path, monkeypatch):
    before = snapshot()
    plan = module.build_mutation_plan(before)
    (tmp_path / "before-snapshot.json").write_text(json.dumps(before))
    (tmp_path / "mutation-plan.json").write_text(json.dumps(plan))
    expected, _ = module.replace_confidence_mode(HTML)
    states = iter([before, snapshot(expected), snapshot(expected)])
    monkeypatch.setattr(module, "capture_authenticated_snapshot", lambda: next(states))
    monkeypatch.setattr(module, "wait_for_exact_edit", lambda _html: snapshot(expected))
    monkeypatch.setattr(module, "wait_for_publication", lambda _html: (snapshot(expected), {"pass": True}))
    monkeypatch.setattr(module.jahia, "set_block_html", lambda _html: {"set": True})
    monkeypatch.setattr(module.jahia, "version_block", lambda: {"version": True})
    publishes = []
    monkeypatch.setattr(module.jahia, "publish", lambda path, subtree=False: publishes.append((path, subtree)) or {"publish": True})

    # The middle state models exact EDIT with stale LIVE.
    stale = snapshot(expected)
    stale["live"] = before["live"]
    states = iter([before, stale])
    monkeypatch.setattr(module, "capture_authenticated_snapshot", lambda: next(states))

    result = module.apply(tmp_path)

    assert result["validation"]["pass"] is True
    assert publishes == [
        (module.DRIFT_PATH, True), (module.BLOCK_PATH, True),
        (module.DRIFT_PATH, True), (module.BLOCK_PATH, True),
    ]
