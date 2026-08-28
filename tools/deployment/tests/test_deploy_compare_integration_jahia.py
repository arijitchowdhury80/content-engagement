import importlib.util
from email.message import Message
import json
import os
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/deployment"))
spec = importlib.util.spec_from_file_location(
    "deploy_compare_integration_jahia",
    ROOT / "tools/deployment/deploy_compare_integration_jahia.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


CONFIG = {
    "PROD_ASKAI_API_KEY": "sentinel-secret-key",
}

LIVE_COMPARE_CONFIG = (
    '<script>window.ACS_COMPARE={"prod":{"appId":"live-app",'
    '"apiKey":"live-secret-key","agentId":"live-agent"}};</script>'
)
OLD_CONTEXT = "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-context-compiler.js?context=old"
OLD_HANDOFF = "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/handoff-to-orchestrator.js?handoff=old"
OLD_COMPARE = "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-compare.js?compare=old"
OLD_TELEMETRY = "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/token-telemetry.js?telemetry=old"


def block_fixture() -> str:
    return f"""<div data-protected="unchanged">
<script src="{OLD_CONTEXT}"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-proactive-controller.js?proactive=old"></script>
<script src="{OLD_HANDOFF}"></script>
{LIVE_COMPARE_CONFIG}
<script src="{OLD_COMPARE}"></script>
<script src="{OLD_TELEMETRY}"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-engage.js?engage=old"></script>
</div>"""


def test_assets_use_content_addressed_filenames_and_hash_validated_content():
    assets = module.immutable_assets()
    assert set(assets) == {"handoff", "compare"}
    for key, asset in assets.items():
        digest = module.sha256(asset["content"])
        assert asset["sha256"] == digest
        assert asset["filename"].endswith(f"{digest[:12]}.js")
        assert asset["path"].endswith(f"/{asset['filename']}")
        assert asset["url"].endswith(f"/{asset['filename']}")
    assert assets["handoff"]["filename"].startswith("handoff-to-orchestrator-compare-")
    assert assets["compare"]["filename"].startswith("algolia-chat-compare-")


def test_block_transform_is_narrow_ordered_and_idempotent():
    assets = module.immutable_assets()
    once = module.update_block_html(block_fixture(), assets, CONFIG)
    twice = module.update_block_html(once, assets, CONFIG)
    assert once == twice
    assert 'data-protected="unchanged"' in once
    assert OLD_CONTEXT in once
    assert OLD_TELEMETRY in once
    assert once.index(OLD_CONTEXT) < once.index(assets["handoff"]["url"])
    assert once.index(assets["handoff"]["url"]) < once.index(assets["compare"]["url"])
    assert once.index(assets["compare"]["url"]) < once.index(OLD_TELEMETRY)
    assert once.index("window.ACS_COMPARE=") < once.index(assets["compare"]["url"])
    assert once.count("window.ACS_COMPARE=") == 1
    assert once.count("live-secret-key") == 1
    assert once.count("sentinel-secret-key") == 0
    assert "live-app" in once
    assert "live-agent" in once
    assert once.count(OLD_COMPARE) == 0
    assert once.count(OLD_HANDOFF) == 0
    assert once.count(OLD_TELEMETRY) == 1


def test_block_transform_can_generate_compare_config_only_when_absent():
    assets = module.immutable_assets()
    current = block_fixture().replace(f"{LIVE_COMPARE_CONFIG}\n", "")
    updated = module.update_block_html(current, assets, CONFIG)
    assert updated.count("window.ACS_COMPARE=") == 1
    assert updated.count("sentinel-secret-key") == 1
    assert module.PROD_APP_ID in updated
    assert module.PROD_AGENT_ID in updated


def test_block_transform_requires_key_only_when_compare_config_is_absent(monkeypatch):
    assets = module.immutable_assets()
    current = block_fixture().replace(f"{LIVE_COMPARE_CONFIG}\n", "")
    monkeypatch.delenv("PROD_ASKAI_API_KEY", raising=False)
    monkeypatch.delenv("PROD_ASKAI_SEARCH_KEY", raising=False)
    with pytest.raises(RuntimeError, match="Missing Compare API configuration"):
        module.update_block_html(current, assets)


def test_block_transform_can_add_missing_handoff_at_the_existing_controller_boundary():
    assets = module.immutable_assets()
    current = block_fixture().replace(
        f'<script src="{OLD_HANDOFF}"></script>\n',
        "",
    )
    updated = module.update_block_html(current, assets, CONFIG)
    assert updated.count(assets["handoff"]["url"]) == 1
    assert updated.index("algolia-proactive-controller.js") < updated.index(assets["handoff"]["url"])


def test_transform_refuses_ambiguous_context_or_handoff_targets():
    assets = module.immutable_assets()
    duplicate = block_fixture().replace(
        "</div>",
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-context-compiler.js"></script>\n</div>',
    )
    with pytest.raises(RuntimeError, match="exactly one context compiler"):
        module.update_block_html(duplicate, assets, CONFIG)


def test_displaced_dependency_snapshot_binds_edit_live_and_public_bytes(monkeypatch):
    urls = module.referenced_dependency_urls(block_fixture())
    assert urls["context"].endswith("algolia-context-compiler.js?context=old")
    assert urls["handoff"].endswith("handoff-to-orchestrator.js?handoff=old")
    assert urls["compare"].endswith("algolia-chat-compare.js?compare=old")
    assert urls["telemetry"].endswith("token-telemetry.js?telemetry=old")

    monkeypatch.setattr(
        module,
        "compact_node",
        lambda path, workspace: {
            "path": path,
            "sha256": module.sha256(f"{path}:bytes"),
            "length": len(f"{path}:bytes"),
        },
    )
    monkeypatch.setattr(
        module,
        "fetch_bytes",
        lambda url: f"{module.FILES}/{url.removeprefix(module.PUBLIC + '/').split('?', 1)[0]}:bytes".encode(),
    )
    observed = module.capture_referenced_dependencies(block_fixture())
    assert set(observed) == {"context", "handoff", "compare", "telemetry"}
    assert all(item["sha256"] for item in observed.values())


def test_live_validation_treats_public_readback_failure_as_retryable(monkeypatch):
    assets = {
        "handoff": {
            "path": "/sites/www/files/handoff-to-orchestrator-compare-abc123.js",
            "url": "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/handoff-to-orchestrator-compare-abc123.js",
            "sha256": module.sha256("handoff"),
        },
        "compare": {
            "path": "/sites/www/files/algolia-chat-compare-def456.js",
            "url": "https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-compare-def456.js",
            "sha256": module.sha256("compare"),
        },
    }
    expected = module.update_block_html(block_fixture(), assets, CONFIG)
    monkeypatch.setattr(module.jahia, "block_html", lambda _workspace: expected)
    monkeypatch.setattr(
        module,
        "compact_node",
        lambda path, _workspace: {
            "path": path,
            "sha256": assets["handoff" if "handoff" in path else "compare"]["sha256"],
            "length": 10,
        },
    )
    monkeypatch.setattr(
        module,
        "fetch_bytes",
        lambda _url: (_ for _ in ()).throw(module.urllib.error.HTTPError(_url, 404, "Not ready", {}, None)),
    )

    checks = module.validate_live(assets, expected)

    assert checks["pass"] is False
    assert checks["public_handoff_hash"] is False
    assert checks["public_compare_hash"] is False
    assert "HTTPError" in checks["public_handoff_error"]
    assert checks["renderedExactReferences"] is False


def test_live_validation_wait_retries_until_transient_public_readback_succeeds(monkeypatch):
    observations = iter([
        {"pass": False, "public_handoff_hash": False},
        {"pass": False, "public_handoff_hash": True, "renderedExactReferences": False},
        {"pass": True, "public_handoff_hash": True, "renderedExactReferences": True},
    ])
    sleeps = []
    monkeypatch.setattr(module, "validate_live", lambda _assets, _expected: next(observations))
    monkeypatch.setattr(module.time, "monotonic", lambda: len(sleeps))
    monkeypatch.setattr(module.time, "sleep", lambda seconds: sleeps.append(seconds))

    checks = module.wait_for_live_validation({}, "expected")

    assert checks["pass"] is True
    assert sleeps == [module.READBACK_POLL_INTERVAL_SECONDS, module.READBACK_POLL_INTERVAL_SECONDS]


def test_live_validation_wait_fails_closed_at_deadline(monkeypatch):
    monkeypatch.setattr(module, "validate_live", lambda _assets, _expected: {"pass": False})
    monotonic_values = iter([0, module.LIVE_VALIDATION_DEADLINE_SECONDS + 1])
    monkeypatch.setattr(module.time, "monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    checks = module.wait_for_live_validation({}, "expected")

    assert checks["pass"] is False
    assert checks["deadlineExceeded"] == module.LIVE_VALIDATION_DEADLINE_SECONDS


def test_final_dependency_cas_rejects_drift_before_cutover(monkeypatch):
    planned = {
        "context": {"sha256": "a"},
        "handoff": {"sha256": "b"},
        "compare": {"sha256": "c"},
        "telemetry": {"sha256": "d"},
    }
    observations = iter([
        planned,
        {**planned, "compare": {"sha256": "changed"}},
    ])
    monkeypatch.setattr(module, "capture_referenced_dependencies", lambda _html: next(observations))
    plan = {"displacedDependencies": planned}
    module.assert_displaced_dependencies_unchanged(plan, "approved")
    with pytest.raises(RuntimeError, match="drifted after plan approval"):
        module.assert_displaced_dependencies_unchanged(plan, "changed during asset creation")

    source = (ROOT / "tools/deployment/deploy_compare_integration_jahia.py").read_text(encoding="utf-8")
    asset_creation = source.index('mutations[f"asset_{key}"] = create_immutable(asset)')
    final_cas = source.index("assert_displaced_dependencies_unchanged", asset_creation)
    cutover = source.index('mutations["setBlockHtml"]', final_cas)
    assert asset_creation < final_cas < cutover


def test_private_plan_permissions_and_public_capture_never_include_html_or_key(tmp_path):
    private = tmp_path / "private" / "plan.json"
    module.write_private(private, {"expectedBlockHtml": f"apiKey={CONFIG['PROD_ASKAI_API_KEY']}"})
    assert os.stat(private).st_mode & 0o777 == 0o600
    snapshot = {
        "capturedAt": "now",
        "edit": {"blockHtml": f"apiKey={CONFIG['PROD_ASKAI_API_KEY']}", "assets": {}},
        "live": {"blockHtml": f"apiKey={CONFIG['PROD_ASKAI_API_KEY']}", "assets": {}},
    }
    public = module.public_capture(snapshot)
    serialized = json.dumps(public)
    assert "blockHtml" not in serialized
    assert CONFIG["PROD_ASKAI_API_KEY"] not in serialized


def test_rollback_refuses_concurrent_block_change(tmp_path, monkeypatch):
    before = "before"
    deployed = "deployed"
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({
        "beforeBlockHtml": before,
        "beforeBlockSha256": module.sha256(before),
        "expectedBlockSha256": module.sha256(deployed),
    }))
    monkeypatch.setattr(module.jahia, "block_html", lambda _workspace: "someone else's edit")
    with pytest.raises(RuntimeError, match="concurrent change"):
        module.restore(plan)


def test_rollback_stale_retry_rechecks_cas_and_never_overwrites_concurrent_edit(monkeypatch):
    before = "before"
    deployed = "deployed"
    concurrent = "someone else's edit"
    reads = iter([deployed, before, concurrent, before])
    writes = []

    monkeypatch.setattr(module.jahia, "block_html", lambda _workspace: next(reads))
    monkeypatch.setattr(
        module.jahia,
        "set_block_html",
        lambda html: writes.append(html) or (_ for _ in ()).throw(
            RuntimeError("javax.jcr.InvalidItemStateException")
        ),
    )
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="concurrent change"):
        module.restore_block_with_cas(
            before,
            {module.sha256(before), module.sha256(deployed)},
        )
    assert writes == [before], "a changed block must prevent the second mutation attempt"


def test_rollback_confirmation_waits_for_transient_live_readback(tmp_path, monkeypatch):
    before = "before"
    deployed = "deployed"
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({
        "beforeBlockHtml": before,
        "beforeBlockSha256": module.sha256(before),
        "expectedBlockSha256": module.sha256(deployed),
    }))
    confirmation_reads = iter([
        deployed, deployed,
        before, deployed,
        before, before,
    ])
    current_reads_remaining = 2

    def block_html(_workspace):
        nonlocal current_reads_remaining
        if current_reads_remaining:
            current_reads_remaining -= 1
            return deployed
        return next(confirmation_reads)

    publishes = []
    monkeypatch.setattr(module.jahia, "block_html", block_html)
    monkeypatch.setattr(module.jahia, "set_block_html", lambda _html: {"pass": True})
    monkeypatch.setattr(module.jahia, "version_block", lambda: {"pass": True})
    monkeypatch.setattr(module.jahia, "publish", lambda *_args, **_kwargs: publishes.append(True) or {"pass": True})
    monotonic_values = iter([0, 1, 2])
    monkeypatch.setattr(module.time, "monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)

    result = module.restore(plan)

    assert result["pass"] is True
    assert len(publishes) == 2


def test_deployer_has_no_broad_publish_or_stable_asset_overwrite():
    source = (ROOT / "tools/deployment/deploy_compare_integration_jahia.py").read_text(encoding="utf-8")
    assert 'publish("/sites/www/files"' not in source
    assert 'publish("/sites/www/home/drift"' not in source
    assert "publish(BLOCK, subtree=True)" in source
    assert "release_filename" in source
    assert "upsert_stable_asset" not in source
    assert "create_immutable" in source
    assert "--apply-plan" in source
    assert "Jahia block drifted after plan approval; no mutation made" in source
    assert "Referenced runtime asset drifted after plan approval; no mutation made" in source
    assert "displacedDependencies" in source
    assert '"oldAssetsRemainUntouched": True' in source
    assert "content-addressed create/reuse for handoff and compare only" in source
    assert "PROD_ASKAI_API_KEY" in source
    assert "LEGACY_COMPARE_API_KEY_ENV" in source
    assert "PROD_ASKAI_APP_ID" not in module.COMPARE_ENV_KEYS
    assert "PROD_ASKAI_AGENT_ID" not in module.COMPARE_ENV_KEYS
    assert "sentinel-secret-key" not in source


def test_backend_preflight_requires_live_token_only_contract(monkeypatch):
    class Response:
        status = 200
        headers = Message()

        def __init__(self):
            self.headers["Content-Type"] = "application/json"

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return b'{"inputTokens":10,"outputTokens":5,"totalTokens":15}'

    monkeypatch.setattr(module.urllib.request, "urlopen", lambda *_args, **_kwargs: Response())
    checks = module.validate_token_telemetry_backend("alg_cnv_smoke_1")
    assert checks["pass"] is True


def test_backend_preflight_rejects_bad_id_and_frontend_apply_is_gated_first():
    with pytest.raises(RuntimeError, match=module.TOKEN_TELEMETRY_SMOKE_ID_ENV):
        module.validate_token_telemetry_backend("bad/path")

    source = (ROOT / "tools/deployment/deploy_compare_integration_jahia.py").read_text(encoding="utf-8")
    preflight = source.index("validate_token_telemetry_backend(smoke_conversation_id)")
    asset_creation = source.index('mutations[f"asset_{key}"] = create_immutable(asset)')
    cutover = source.index('mutations["setBlockHtml"]')
    assert preflight < asset_creation < cutover


def test_apply_skips_telemetry_smoke_when_no_smoke_conversation_id_is_set():
    source = (ROOT / "tools/deployment/deploy_compare_integration_jahia.py").read_text(encoding="utf-8")
    assert '"skipped": True' in source
    assert "not set" in source
