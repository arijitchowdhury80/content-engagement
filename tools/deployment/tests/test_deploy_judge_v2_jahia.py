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


def test_block_cutover_uses_stable_assets_and_removes_chief():
    current = '''<div class="algolia-chat-embed" data-judge-runtime-release="old">
<algolia-chat-confidence mode="algolia" agent-id="chief">
<algolia-agent role="skeptic" agent-id="old-s"></algolia-agent>
<algolia-agent role="referee" agent-id="old-r"></algolia-agent>
<algolia-agent role="advocate" agent-id="old-a"></algolia-agent>
</algolia-chat-confidence></div>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-confidence-badge.js?old=1"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat.js?old=1"></script>'''
    assets = {
        "core": {"url": f"{module.PUBLIC}/algolia-judge-core-judge-v2.js?v=111111111111"},
        "badge": {"url": f"{module.PUBLIC}/algolia-confidence-badge-judge-v2.js?v=222222222222"},
        "chat": {"url": f"{module.PUBLIC}/algolia-chat-judge-v2.js?v=333333333333"},
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
    assert updated.count('<algolia-chat-confidence>') == 1
    assert ' mode=' not in updated


def test_block_cutover_removes_mode_without_removing_judges():
    current = '''<div class="algolia-chat-embed"><algolia-chat-confidence data-x="preserved" mode="algolia">
<algolia-agent role="skeptic" agent-id="old-s"></algolia-agent>
<algolia-agent role="referee" agent-id="old-r"></algolia-agent>
<algolia-agent role="advocate" agent-id="old-a"></algolia-agent></algolia-chat-confidence></div>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-confidence-badge.js"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat.js"></script>'''
    assets = {
        "core": {"url": f"{module.PUBLIC}/algolia-judge-core-judge-v2.js?v=111111111111"},
        "badge": {"url": f"{module.PUBLIC}/algolia-confidence-badge-judge-v2.js?v=222222222222"},
        "chat": {"url": f"{module.PUBLIC}/algolia-chat-judge-v2.js?v=333333333333"},
    }
    ids = {
        "skeptic": "11111111-1111-4111-8111-111111111111",
        "referee": "22222222-2222-4222-8222-222222222222",
        "advocate": "33333333-3333-4333-8333-333333333333",
    }

    updated = module.update_block_html(current, assets, ids)

    assert '<algolia-chat-confidence data-x="preserved">' in updated
    assert all(f'role="{role}" agent-id="{agent_id}"' in updated for role, agent_id in ids.items())


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
    assets = {
        "core": {"url": f"{module.PUBLIC}/algolia-judge-core-judge-v2.js?v=111111111111"},
        "badge": {"url": f"{module.PUBLIC}/algolia-confidence-badge-judge-v2.js?v=222222222222"},
        "chat": {"url": f"{module.PUBLIC}/algolia-chat-judge-v2.js?v=333333333333"},
    }
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
    assert checks["confidenceModeAttributeAbsent"] is False
    assert checks["pass"] is False


def test_private_state_is_permission_restricted(tmp_path):
    path = tmp_path / "private" / "rollback.json"
    module.write_private(path, {"search-api-key": "secret"})
    assert json.loads(path.read_text())["search-api-key"] == "secret"
    assert os.stat(path).st_mode & 0o777 == 0o600


def test_stable_asset_create_waits_for_exact_edit_readback(monkeypatch):
    asset = {"path": "/sites/www/files/new.js", "content": "const ready = true;", "sha256": "hash"}
    states = iter([None, None, {"path": asset["path"]}])
    monkeypatch.setattr(module, "safe_node", lambda _path, _workspace: next(states))
    monkeypatch.setattr(module.jahia, "upsert_file", lambda path, content: {"path": path, "content": content})
    monkeypatch.setattr(module.jahia, "file_content", lambda _node: asset["content"])
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    result = module.upsert_stable_asset(asset)

    assert result == {"path": asset["path"], "operation": "create", "sha256": "hash"}


def test_stable_asset_update_waits_for_exact_edit_readback(monkeypatch):
    asset = {"path": "/sites/www/files/existing.js", "content": "const ready = true;", "sha256": "hash"}
    node = {"path": asset["path"]}
    reads = iter(["old bytes", asset["content"]])
    monkeypatch.setattr(module, "safe_node", lambda _path, _workspace: node)
    monkeypatch.setattr(module.jahia, "upsert_file", lambda path, content: {"path": path, "content": content})
    monkeypatch.setattr(module.jahia, "file_content", lambda _node: next(reads))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    result = module.upsert_stable_asset(asset)

    assert result == {"path": asset["path"], "operation": "update", "sha256": "hash"}


def test_stable_asset_filenames_do_not_include_content_hashes():
    assets = module.stable_assets()
    assert assets["core"]["filename"] == "algolia-judge-core-judge-v2.js"
    assert assets["badge"]["filename"] == "algolia-confidence-badge-judge-v2.js"
    assert assets["chat"]["filename"] == "algolia-chat-judge-v2.js"
    assert assets["chat"]["sha256"][:12] not in assets["chat"]["filename"]
    assert f'?v={assets["chat"]["sha256"][:12]}' in assets["chat"]["url"]


def test_live_companion_overrides_preserve_exact_badge_and_chat_bytes(monkeypatch):
    badge_url = f"{module.PUBLIC}/algolia-confidence-badge-judge-v2-aaaaaaaaaaaa.js"
    chat_url = f"{module.PUBLIC}/algolia-chat-judge-v2.js?v=bbbbbbbbbbbb"
    monkeypatch.setattr(module.jahia, "block_html", lambda workspace: (
        f'<script src="{badge_url}"></script>\n<script src="{chat_url}"></script>'
    ))
    chat_bytes = (ROOT / "frontend/chat-widget/algolia-chat.js").read_bytes()
    payloads = {badge_url: b"badge live bytes", chat_url: chat_bytes}
    monkeypatch.setattr(module, "fetch_bytes", lambda url: payloads[url])

    overrides = module.live_companion_overrides()
    assets = module.stable_assets(overrides)

    assert assets["badge"]["content"] == "badge live bytes"
    assert assets["chat"]["content"] == chat_bytes.decode("utf-8")
    assert assets["badge"]["source"] == f"live:{badge_url}"
    assert assets["chat"]["source"] == f"live:{chat_url}"


def test_post_publish_validation_failure_has_automatic_block_rollback():
    source = (ROOT / "tools/deployment/deploy_judge_v2_jahia.py").read_text(encoding="utf-8")
    assert source.count('rollback = restore(rollback_path)') >= 3
    assert 'failed-validation-rollback.json' in source
    assert 'publishDriftSubtree' in source
    assert 'republishDriftSubtreeAfterStaleLiveReadback' in source
    assert 'jahia.publish(BLOCK, subtree=True)' in source
    assert 'interrupted_cutover_recovery' in source
    assert 'outside the exact interrupted judge cutover' in source
    assert source.count('except Exception as rollback_error:') == 3
    assert source.count('rollback = {"pass": False, "error": str(rollback_error)}') == 3
    assert 'failed-mutation-rollback.json' in source
    assert 'skipped": not block_mutated' not in source
    assert '"operation": "attempted"' in source
    assert 'mutations[f"asset_{key}"] = upsert_stable_asset(asset)' in source
    assert 'newHashedAssetsCreated": False' in source
    assert 'stableAssetsBefore' in source


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


def test_rollback_restores_prior_stable_asset_bytes(tmp_path, monkeypatch):
    before = "before"
    deployed = "deployed"
    path = "/sites/www/files/algolia-chat-judge-v2.js"
    manifest = tmp_path / "rollback.json"
    manifest.write_text(json.dumps({
        "beforeEditHtml": before,
        "beforeEditSha256": module.jahia.sha256(before),
        "expectedDeployedSha256": module.jahia.sha256(deployed),
        "stableAssetsBefore": {
            "chat": {
                "path": path,
                "existed": True,
                "content": "old stable bytes",
                "sha256": module.jahia.sha256("old stable bytes"),
            }
        },
    }))
    state = {"EDIT": deployed, "LIVE": deployed, "content": "new stable bytes", "blockPublishes": 0}
    published = []

    monkeypatch.setattr(module.jahia, "block_html", lambda workspace: state[workspace])
    monkeypatch.setattr(module.jahia, "set_block_html", lambda value: state.__setitem__("EDIT", value))
    monkeypatch.setattr(module.jahia, "version_block", lambda: None)
    monkeypatch.setattr(module.jahia, "upsert_file", lambda _path, content: state.__setitem__("content", content))
    monkeypatch.setattr(module, "safe_node", lambda _path, _workspace: {"path": _path})
    monkeypatch.setattr(module.jahia, "file_content", lambda _node: state["content"])
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    def publish(published_path, subtree=False):
        published.append(published_path)
        if published_path == module.BLOCK:
            state["blockPublishes"] += 1
            if state["blockPublishes"] >= 2:
                state["LIVE"] = state["EDIT"]
        return {"path": published_path, "subtree": subtree}

    monkeypatch.setattr(module.jahia, "publish", publish)

    result = module.restore(manifest)

    assert result["pass"] is True
    assert result["assetsRestored"] == [path]
    assert state["content"] == "old stable bytes"
    assert f"{path}/jcr:content" in published
    assert path in published
