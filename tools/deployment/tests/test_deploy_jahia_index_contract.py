import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


DEPLOY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY_DIR))
SPEC = importlib.util.spec_from_file_location(
    "deploy_jahia_index_contract",
    DEPLOY_DIR / "deploy_jahia_index_contract.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


ENHANCED = '<main><algolia-chat-theme></algolia-chat-theme><algolia-instant-search app-id="0EXRPAXB56" index-name="Algolia_Prod_Copy_Enhanced"><algolia-chat-visitor></algolia-chat-visitor><algolia-chat></algolia-chat></algolia-instant-search></main>'
VANILLA = '<main><algolia-chat-theme></algolia-chat-theme><algolia-instant-search app-id="0EXRPAXB56" index-name="Algolia_Prod_Copy_Vanilla"><algolia-chat-visitor></algolia-chat-visitor><algolia-chat></algolia-chat></algolia-instant-search></main>'


class JahiaIndexContractTest(unittest.TestCase):
    def test_replace_changes_exactly_one_active_attribute_span(self):
        updated, diff = MODULE.replace_active_index(ENHANCED)
        self.assertEqual(updated, VANILLA)
        self.assertEqual(diff["from"], MODULE.EXPECTED_STALE)
        self.assertEqual(diff["to"], MODULE.REQUIRED_INDEX)
        self.assertNotEqual(diff["beforeSha256"], diff["afterSha256"])

    def test_requires_exactly_one_chat_and_index_attribute(self):
        with self.assertRaisesRegex(RuntimeError, "found 0"):
            MODULE.active_index_span("<main><algolia-chat></algolia-chat></main>")
        with self.assertRaisesRegex(RuntimeError, "found 2"):
            MODULE.active_index_span(ENHANCED + ENHANCED)
        with self.assertRaisesRegex(RuntimeError, "attribute; found 2"):
            MODULE.active_index_span('<algolia-instant-search index-name="one"><algolia-chat index-name="two">')

    def test_plan_rejects_workspace_drift_and_unknown_index(self):
        snapshot = {
            "target": {},
            "edit": {"html": ENHANCED, "sha256": MODULE.sha256(ENHANCED), "indexName": MODULE.EXPECTED_STALE},
            "live": {"html": VANILLA, "sha256": MODULE.sha256(VANILLA), "indexName": MODULE.REQUIRED_INDEX},
        }
        with self.assertRaisesRegex(RuntimeError, "must be identical"):
            MODULE.build_mutation_plan(snapshot, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
        other = ENHANCED.replace(MODULE.EXPECTED_STALE, "Unexpected_Index")
        snapshot["edit"] = snapshot["live"] = {
            "html": other, "sha256": MODULE.sha256(other), "indexName": "Unexpected_Index"
        }
        with self.assertRaisesRegex(RuntimeError, "Refusing unexpected"):
            MODULE.build_mutation_plan(snapshot, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)

    def test_already_vanilla_is_zero_mutation_noop_without_rollback(self):
        snapshot = {
            "target": {},
            "edit": {"html": VANILLA, "sha256": MODULE.sha256(VANILLA), "indexName": MODULE.REQUIRED_INDEX},
            "live": {"html": VANILLA, "sha256": MODULE.sha256(VANILLA), "indexName": MODULE.REQUIRED_INDEX},
        }
        plan = MODULE.build_mutation_plan(snapshot, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
        self.assertEqual(plan["operation"], "noop")
        self.assertIsNone(plan["diff"])
        self.assertIsNone(plan["rollback"])

    def test_raw_evidence_rejects_repository_and_dropbox(self):
        with self.assertRaisesRegex(RuntimeError, "inside the repository"):
            MODULE.safe_evidence_dir(str(MODULE.ROOT / ".local" / "unsafe"))
        with self.assertRaisesRegex(RuntimeError, "synchronized storage"):
            MODULE.safe_evidence_dir("/Users/example/Dropbox/raw")

    def test_dry_run_is_private_and_does_not_mutate(self):
        state = {"EDIT": ENHANCED, "LIVE": ENHANCED}
        with tempfile.TemporaryDirectory(prefix="algolia-index-contract-") as parent:
            evidence = Path(parent) / "evidence"
            with mock.patch.object(MODULE.jahia, "block_html", side_effect=lambda workspace: state[workspace]), \
                 mock.patch.object(MODULE.jahia, "set_block_html") as setter:
                result = MODULE.dry_run(MODULE.safe_evidence_dir(str(evidence)), MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
            self.assertTrue(result["pass"])
            self.assertFalse(result["mutationApplied"])
            setter.assert_not_called()
            self.assertEqual(os.stat(evidence).st_mode & 0o777, 0o700)
            self.assertEqual(os.stat(evidence / "before-snapshot.json").st_mode & 0o777, 0o600)
            plan = json.loads((evidence / "mutation-plan.json").read_text())
            self.assertEqual(plan["diff"]["from"], MODULE.EXPECTED_STALE)

    def test_apply_rechecks_both_hashes_and_publishes_only_block(self):
        state = {"EDIT": ENHANCED, "LIVE": ENHANCED}

        def set_html(value):
            state["EDIT"] = value
            return {"path": MODULE.BLOCK_PATH}

        def publish(path, subtree=False):
            self.assertEqual(path, MODULE.BLOCK_PATH)
            self.assertFalse(subtree)
            state["LIVE"] = state["EDIT"]
            return {"path": path}

        with tempfile.TemporaryDirectory(prefix="algolia-index-contract-") as parent:
            evidence = MODULE.safe_evidence_dir(str(Path(parent) / "evidence"))
            with mock.patch.object(MODULE.jahia, "block_html", side_effect=lambda workspace: state[workspace]):
                MODULE.dry_run(evidence, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
                with mock.patch.object(MODULE.jahia, "set_block_html", side_effect=set_html), \
                     mock.patch.object(MODULE.jahia, "version_block", return_value={"version": True}), \
                     mock.patch.object(MODULE.jahia, "publish", side_effect=publish), \
                     mock.patch.object(MODULE, "public_identity", return_value={"indexName": MODULE.REQUIRED_INDEX}):
                    result = MODULE.apply(evidence)
            self.assertTrue(result["validation"]["pass"])
            self.assertEqual(state, {"EDIT": VANILLA, "LIVE": VANILLA})

    def test_apply_never_publishes_when_exact_edit_readback_does_not_arrive(self):
        state = {"EDIT": ENHANCED, "LIVE": ENHANCED}
        with tempfile.TemporaryDirectory(prefix="algolia-index-contract-") as parent:
            evidence = MODULE.safe_evidence_dir(str(Path(parent) / "evidence"))
            with mock.patch.object(MODULE.jahia, "block_html", side_effect=lambda workspace: state[workspace]):
                MODULE.dry_run(evidence, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
                with mock.patch.object(MODULE.jahia, "set_block_html", return_value={"setValue": True}), \
                     mock.patch.object(MODULE.jahia, "publish") as publisher, \
                     mock.patch.object(MODULE.time, "sleep"):
                    with self.assertRaisesRegex(RuntimeError, "exact EDIT readback never appeared"):
                        MODULE.apply(evidence)
            publisher.assert_not_called()

    def test_apply_refuses_post_dry_run_drift(self):
        state = {"EDIT": ENHANCED, "LIVE": ENHANCED}
        with tempfile.TemporaryDirectory(prefix="algolia-index-contract-") as parent:
            evidence = MODULE.safe_evidence_dir(str(Path(parent) / "evidence"))
            with mock.patch.object(MODULE.jahia, "block_html", side_effect=lambda workspace: state[workspace]):
                MODULE.dry_run(evidence, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
                state["LIVE"] = VANILLA
                with self.assertRaisesRegex(RuntimeError, "drifted after dry-run"):
                    MODULE.apply(evidence)

    def test_publication_recovery_accepts_only_reviewed_partial_state(self):
        state = {"EDIT": ENHANCED, "LIVE": ENHANCED}

        def publish(path, subtree=False):
            self.assertIn(path, {MODULE.DRIFT_PATH, MODULE.BLOCK_PATH})
            self.assertTrue(subtree)
            state["LIVE"] = state["EDIT"]
            return {"path": path}

        with tempfile.TemporaryDirectory(prefix="algolia-index-contract-") as parent:
            evidence = MODULE.safe_evidence_dir(str(Path(parent) / "evidence"))
            with mock.patch.object(MODULE.jahia, "block_html", side_effect=lambda workspace: state[workspace]):
                MODULE.dry_run(evidence, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
                state["EDIT"] = VANILLA
                with mock.patch.object(MODULE.jahia, "version_block", return_value={"version": True}), \
                     mock.patch.object(MODULE.jahia, "publish", side_effect=publish), \
                     mock.patch.object(MODULE, "public_identity", return_value={"indexName": MODULE.REQUIRED_INDEX}):
                    result = MODULE.recover_publication(evidence)
            self.assertTrue(result["validation"]["pass"])
            self.assertTrue(result["mutationApplied"])
            self.assertEqual(state, {"EDIT": VANILLA, "LIVE": VANILLA})

    def test_publication_recovery_rejects_unreviewed_live_drift(self):
        state = {"EDIT": ENHANCED, "LIVE": ENHANCED}
        with tempfile.TemporaryDirectory(prefix="algolia-index-contract-") as parent:
            evidence = MODULE.safe_evidence_dir(str(Path(parent) / "evidence"))
            with mock.patch.object(MODULE.jahia, "block_html", side_effect=lambda workspace: state[workspace]):
                MODULE.dry_run(evidence, MODULE.EXPECTED_STALE, MODULE.REQUIRED_INDEX)
                state["EDIT"] = VANILLA
                state["LIVE"] = ENHANCED.replace(MODULE.EXPECTED_STALE, "Unexpected_Index")
                with self.assertRaisesRegex(RuntimeError, "LIVE drifted"):
                    MODULE.recover_publication(evidence)


if __name__ == "__main__":
    unittest.main()
