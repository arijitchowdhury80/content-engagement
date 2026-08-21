import importlib.util
import json
import os
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/deployment"))
spec = importlib.util.spec_from_file_location("deploy_judge_v2_jahia", ROOT / "tools/deployment/deploy_judge_v2_jahia.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_block_cutover_uses_immutable_assets_and_removes_chief():
    current = '''<div class="algolia-chat-embed" data-judge-runtime-release="old">
<algolia-chat-confidence mode="algolia" agent-id="chief">
<algolia-agent role="skeptic" agent-id="old-s"></algolia-agent>
<algolia-agent role="referee" agent-id="old-r"></algolia-agent>
<algolia-agent role="advocate" agent-id="old-a"></algolia-agent>
</algolia-chat-confidence></div>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-confidence-badge.js?old=1"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat.js?old=1"></script>'''
    assets = {
        key: {"url": f"{module.PUBLIC}/{key}-judge-v2-123456789abc.js"}
        for key in ["core", "badge", "chat"]
    }
    ids = {
        "skeptic": "11111111-1111-4111-8111-111111111111",
        "referee": "22222222-2222-4222-8222-222222222222",
        "advocate": "33333333-3333-4333-8333-333333333333",
    }
    updated = module.update_block_html(current, assets, ids)
    assert 'agent-id="chief"' not in updated
    assert all(updated.count(agent_id) == 1 for agent_id in ids.values())
    assert updated.index(assets["core"]["url"]) < updated.index(assets["chat"]["url"])
    assert "algolia-confidence-badge.js?old=1" not in updated
    assert 'data-judge-runtime-release="judge-v2"' in updated


def test_rejects_non_uuid_and_attribute_injection():
    ids = {
        "skeptic": '" onmouseover="alert(1)',
        "referee": "22222222-2222-4222-8222-222222222222",
        "advocate": "33333333-3333-4333-8333-333333333333",
    }
    with pytest.raises(RuntimeError, match="canonical UUIDs"):
        module.validate_agent_ids(ids)


def test_block_cutover_rejects_duplicate_script_targets():
    current = '''<div class="algolia-chat-embed"><algolia-chat-confidence mode="algolia">
<algolia-agent role="skeptic" agent-id="old-s"></algolia-agent>
<algolia-agent role="referee" agent-id="old-r"></algolia-agent>
<algolia-agent role="advocate" agent-id="old-a"></algolia-agent></algolia-chat-confidence></div>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-confidence-badge.js"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat.js"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat.js"></script>'''
    assets = {key: {"url": f"{module.PUBLIC}/{key}-judge-v2-123456789abc.js"} for key in ["core", "badge", "chat"]}
    ids = {
        "skeptic": "11111111-1111-4111-8111-111111111111",
        "referee": "22222222-2222-4222-8222-222222222222",
        "advocate": "33333333-3333-4333-8333-333333333333",
    }
    with pytest.raises(RuntimeError, match="exactly one chat script; found 2"):
        module.update_block_html(current, assets, ids)


def test_chief_detection_is_attribute_order_independent():
    assets = {
        "core": {"url": "core.js", "sha256": "core"},
        "badge": {"url": "badge.js", "sha256": "badge"},
        "chat": {"url": "chat.js", "sha256": "chat"},
    }
    html_value = '<algolia-chat-confidence data-x="1" agent-id="chief" mode="algolia">core.js chat.js'
    compact = {key: {"sha256": asset["sha256"]} for key, asset in assets.items()}
    after = {
        "edit": {"blockHtml": html_value, "assets": compact},
        "live": {"blockHtml": html_value, "assets": compact},
    }
    checks = module.validate(after, assets, html_value, {})
    assert checks["chiefAttributeAbsent"] is False
    assert checks["pass"] is False


def test_private_state_is_permission_restricted(tmp_path):
    path = tmp_path / "private" / "rollback.json"
    module.write_private(path, {"search-api-key": "secret"})
    assert json.loads(path.read_text())["search-api-key"] == "secret"
    assert os.stat(path).st_mode & 0o777 == 0o600


def test_post_publish_validation_failure_has_automatic_block_rollback():
    source = (ROOT / "tools/deployment/deploy_judge_v2_jahia.py").read_text(encoding="utf-8")
    assert source.count('rollback = restore(rollback_path)') >= 2
    assert 'failed-validation-rollback.json' in source
    assert 'publishDriftSubtree' in source
    assert 'republishDriftSubtreeAfterStaleLiveReadback' in source
    assert 'jahia.publish(BLOCK, subtree=True)' in source
    assert 'interrupted_cutover_recovery' in source
    assert 'outside the exact interrupted judge cutover' in source
    assert source.count('except Exception as rollback_error:') == 2
    assert source.count('rollback = {"pass": False, "error": str(rollback_error)}') == 2


def test_rollback_refuses_to_overwrite_a_concurrent_block_change(tmp_path, monkeypatch):
    before = "before"
    deployed = "deployed"
    manifest = tmp_path / "rollback.json"
    manifest.write_text(json.dumps({
        "beforeEditHtml": before,
        "beforeEditSha256": module.jahia.sha256(before),
        "expectedDeployedSha256": module.jahia.sha256(deployed),
    }))
    monkeypatch.setattr(module.jahia, "block_html", lambda _workspace: "someone else's edit")
    with pytest.raises(RuntimeError, match="changed concurrently"):
        module.restore(manifest)


def test_rollback_republishes_and_polls_until_live_catches_up(tmp_path, monkeypatch):
    before = "before"
    deployed = "deployed"
    manifest = tmp_path / "rollback.json"
    manifest.write_text(json.dumps({
        "beforeEditHtml": before,
        "beforeEditSha256": module.jahia.sha256(before),
        "expectedDeployedSha256": module.jahia.sha256(deployed),
    }))
    state = {"EDIT": deployed, "LIVE": deployed, "blockPublishes": 0}

    monkeypatch.setattr(module.jahia, "block_html", lambda workspace: state[workspace])
    monkeypatch.setattr(module.jahia, "set_block_html", lambda value: state.__setitem__("EDIT", value))
    monkeypatch.setattr(module.jahia, "version_block", lambda: None)
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    def publish(path, subtree=False):
        if path == module.BLOCK:
            state["blockPublishes"] += 1
            if state["blockPublishes"] >= 2:
                state["LIVE"] = state["EDIT"]
        return {"path": path, "subtree": subtree}

    monkeypatch.setattr(module.jahia, "publish", publish)
    result = module.restore(manifest)
    assert result["pass"] is True
    assert state["EDIT"] == before
    assert state["LIVE"] == before
    assert state["blockPublishes"] == 2
