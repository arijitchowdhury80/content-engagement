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
    "PROD_ASKAI_SEARCH_KEY": "sentinel-secret-key",
}


def block_fixture() -> str:
    return """<div data-protected="unchanged">
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-context-compiler.js?context=old"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-proactive-controller.js?proactive=old"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/handoff-to-orchestrator.js?handoff=old"></script>
<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-engage.js?engage=old"></script>
</div>"""


def test_assets_are_content_addressed_and_independent():
    assets = module.immutable_assets()
    assert set(assets) == {"context", "handoff", "compare", "telemetry"}
    for key, asset in assets.items():
        expected = (
            f"{module.STEMS[key]}-{asset['sha256'][:12]}.js"
            if key in {"compare", "telemetry"}
            else f"{module.STEMS[key]}-compare-{asset['sha256'][:12]}.js"
        )
        assert asset["filename"] == expected
        assert module.sha256(asset["content"]) == asset["sha256"]


def test_block_transform_is_narrow_ordered_and_idempotent():
    assets = module.immutable_assets()
    once = module.update_block_html(block_fixture(), assets, CONFIG)
    twice = module.update_block_html(once, assets, CONFIG)
    assert once == twice
    assert 'data-protected="unchanged"' in once
    assert once.index(assets["context"]["url"]) < once.index(assets["handoff"]["url"])
    assert once.index(assets["handoff"]["url"]) < once.index(assets["compare"]["url"])
    assert once.index(assets["compare"]["url"]) < once.index(assets["telemetry"]["url"])
    assert once.index("window.ACS_COMPARE=") < once.index(assets["compare"]["url"])
    assert once.count("window.ACS_COMPARE=") == 1
    assert once.count("sentinel-secret-key") == 1
    assert module.PROD_APP_ID in once
    assert module.PROD_AGENT_ID in once
    assert once.count(assets["telemetry"]["url"]) == 1


def test_block_transform_can_add_missing_handoff_at_the_existing_controller_boundary():
    assets = module.immutable_assets()
    current = block_fixture().replace(
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/handoff-to-orchestrator.js?handoff=old"></script>\n',
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
    assert set(observed) == {"context", "handoff"}
    assert all(item["sha256"] for item in observed.values())


def test_final_dependency_cas_rejects_drift_before_cutover(monkeypatch):
    planned = {"context": {"sha256": "a"}, "handoff": {"sha256": "b"}}
    observations = iter([planned, {"context": {"sha256": "changed"}, "handoff": {"sha256": "b"}}])
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
    module.write_private(private, {"expectedBlockHtml": f"apiKey={CONFIG['PROD_ASKAI_SEARCH_KEY']}"})
    assert os.stat(private).st_mode & 0o777 == 0o600
    snapshot = {
        "capturedAt": "now",
        "edit": {"blockHtml": f"apiKey={CONFIG['PROD_ASKAI_SEARCH_KEY']}", "assets": {}},
        "live": {"blockHtml": f"apiKey={CONFIG['PROD_ASKAI_SEARCH_KEY']}", "assets": {}},
    }
    public = module.public_capture(snapshot)
    serialized = json.dumps(public)
    assert "blockHtml" not in serialized
    assert CONFIG["PROD_ASKAI_SEARCH_KEY"] not in serialized


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


def test_deployer_has_no_broad_publish_or_stable_asset_overwrite():
    source = (ROOT / "tools/deployment/deploy_compare_integration_jahia.py").read_text(encoding="utf-8")
    assert 'publish("/sites/www/files"' not in source
    assert 'publish("/sites/www/home/drift"' not in source
    assert "publish(BLOCK, subtree=True)" in source
    assert 'f"{STEMS[key]}-compare-{digest[:12]}.js"' in source
    assert "--apply-plan" in source
    assert "Jahia block drifted after plan approval; no mutation made" in source
    assert "Referenced context or handoff asset drifted after plan approval; no mutation made" in source
    assert "displacedDependencies" in source
    assert "PROD_ASKAI_SEARCH_KEY" in source
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
    preflight = source.index("backend_checks = validate_token_telemetry_backend")
    asset_creation = source.index('mutations[f"asset_{key}"] = create_immutable(asset)')
    cutover = source.index('mutations["setBlockHtml"]')
    assert preflight < asset_creation < cutover
