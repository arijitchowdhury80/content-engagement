import importlib.util
import sys
from pathlib import Path

import pytest


DEPLOY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY_DIR))
SPEC = importlib.util.spec_from_file_location("deploy_jahia_chat_stability", DEPLOY_DIR / "deploy_jahia_chat_stability.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


PUBLIC = MODULE.PUBLIC_FILES
CURRENT = f'{PUBLIC}/algolia-chat-judge-v2-aaaaaaaaaaaa.js'
BLOCK = (
    f'<script src="{PUBLIC}/algolia-judge-core-judge-v2-bbbbbbbbbbbb.js"></script>'
    f'<script src="{CURRENT}"></script>'
    f'<script src="{PUBLIC}/algolia-chat-compare-cccccccccccc.js"></script>'
    '<div class="algolia-chat-embed" data-other="preserve"></div>'
)


def test_update_changes_only_primary_chat_and_release_marker():
    asset = MODULE.chat_asset("new chat")
    updated = MODULE.update_block_html(BLOCK, asset)
    assert asset["url"] in updated
    assert CURRENT not in updated
    assert "algolia-judge-core-judge-v2-bbbbbbbbbbbb.js" in updated
    assert "algolia-chat-compare-cccccccccccc.js" in updated
    assert 'data-other="preserve"' in updated
    assert f'data-chat-stability-release="{asset["sha256"][:12]}"' in updated


def test_update_rejects_zero_or_multiple_primary_chat_scripts():
    asset = MODULE.chat_asset("new chat")
    with pytest.raises(RuntimeError, match="found 0"):
        MODULE.update_block_html('<div class="algolia-chat-embed"></div>', asset)
    with pytest.raises(RuntimeError, match="found 2"):
        MODULE.update_block_html(BLOCK.replace('<div class=', f'<script src="{CURRENT}"></script><div class='), asset)


def test_asset_name_is_content_addressed_and_immutable():
    first = MODULE.chat_asset("one")
    second = MODULE.chat_asset("two")
    assert first["filename"].startswith("algolia-chat-stability-")
    assert first["sha256"][:12] in first["filename"]
    assert first["path"] != second["path"]


def test_validation_requires_edit_live_and_public_exactness(monkeypatch):
    asset = MODULE.chat_asset("new chat")
    snapshot = {
        "edit": {"blockHtml": "expected", "asset": {"sha256": asset["sha256"]}},
        "live": {"blockHtml": "expected", "asset": {"sha256": asset["sha256"]}},
    }
    monkeypatch.setattr(MODULE, "public_readback", lambda _asset: {
        "pageReferencesAsset": True,
        "assetMatches": True,
        "assetSha256": asset["sha256"],
    })
    assert MODULE.validate(snapshot, "expected", asset, include_public=True)["pass"]
    snapshot["live"]["blockHtml"] = "stale"
    assert not MODULE.validate(snapshot, "expected", asset, include_public=True)["pass"]


def test_recovery_refuses_edit_outside_exact_reviewed_deployed_hash(tmp_path, monkeypatch):
    asset = MODULE.chat_asset(MODULE.CHAT_SOURCE.read_text(encoding="utf-8"))
    before_html = BLOCK
    expected_html = MODULE.update_block_html(before_html, asset)
    before = {
        "edit": {"blockHtml": before_html},
        "live": {"blockHtml": before_html},
    }
    plan = {
        "asset": {key: value for key, value in asset.items() if key != "content"},
        "before": {"editBlockSha256": MODULE.sha256(before_html), "liveBlockSha256": MODULE.sha256(before_html)},
        "expectedBlockSha256": MODULE.sha256(expected_html),
    }
    (tmp_path / "before-snapshot.json").write_text(__import__("json").dumps(before))
    (tmp_path / "deployment-plan.json").write_text(__import__("json").dumps(plan))
    drifted = {
        "edit": {"blockHtml": "concurrent edit", "asset": {"sha256": asset["sha256"]}},
        "live": {"blockHtml": before_html, "asset": {"sha256": asset["sha256"]}},
    }
    monkeypatch.setattr(MODULE, "capture", lambda _path: drifted)

    with pytest.raises(RuntimeError, match="EDIT to match"):
        MODULE.recover_publication(tmp_path)


def test_apply_contains_bounded_republish_for_exact_edit_and_stale_live():
    source = (DEPLOY_DIR / "deploy_jahia_chat_stability.py").read_text(encoding="utf-8")
    assert 'republishDriftSubtreeAfterStaleLiveReadback' in source
    assert 'republishBlockAfterStaleLiveReadback' in source
    assert '--recover-publication' in source
    assert 'restore_reviewed_block(evidence_dir, asset)' in source
    assert 'automatic-rollback-result.json' in source
