import importlib.util
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/deployment"))
spec = importlib.util.spec_from_file_location("deploy_jahia_discovery_mode", ROOT / "tools/deployment/deploy_jahia_discovery_mode.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

HTML = '<main><algolia-chat data-x="preserved" discovery-enabled="true"></algolia-chat></main>'


def snapshot(html=HTML):
    mode, _, _ = module.active_mode_span(html)
    return {
        "target": {"origin": module.TARGET_ORIGIN, "path": module.BLOCK_PATH},
        "edit": {"html": html, "sha256": module.sha256(html), "mode": mode},
        "live": {"html": html, "sha256": module.sha256(html), "mode": mode},
    }


def test_removes_only_discovery_enabled_attribute():
    updated, diff = module.replace_discovery_mode(HTML)
    assert updated == '<main><algolia-chat data-x="preserved"></algolia-chat></main>'
    assert diff["from"] == "true"
    assert diff["to"] == "absent"


def test_rejects_missing_or_duplicate_chat_elements():
    with pytest.raises(RuntimeError, match="found 0"):
        module.replace_discovery_mode("<main></main>")
    with pytest.raises(RuntimeError, match="found 2"):
        module.replace_discovery_mode(f"{HTML}{HTML}")


def test_plan_is_narrow_reversible_and_dev_only():
    plan = module.build_plan(snapshot())
    assert plan["operation"] == "remove-one-discovery-enabled-attribute"
    assert plan["requiredMode"] == "absent"
    assert plan["target"]["origin"] == "https://tmp-content-eng-algolia.cloud.jahia.com"
    assert plan["rollback"]["snapshot"] == "before-snapshot.json"
    assert plan["mutationAllowlist"] == [
        {"operation": "setBlockHtml", "path": module.BLOCK_PATH},
        {"operation": "version", "path": module.BLOCK_PATH},
        {"operation": "publish", "path": module.BLOCK_PATH, "subtree": True},
    ]
    assert all(item["path"] == module.BLOCK_PATH for item in plan["mutationAllowlist"])


def test_plan_is_noop_when_already_disabled():
    plan = module.build_plan(snapshot('<main><algolia-chat data-x="preserved"></algolia-chat></main>'))
    assert plan["operation"] == "noop"


def test_plan_rejects_edit_live_drift():
    value = snapshot()
    value["live"]["html"] += "<!-- drift -->"
    value["live"]["sha256"] = module.sha256(value["live"]["html"])
    with pytest.raises(RuntimeError, match="EDIT and LIVE"):
        module.build_plan(value)
