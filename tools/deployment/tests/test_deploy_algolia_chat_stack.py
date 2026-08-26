import importlib.util
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "deploy_algolia_chat_stack.py"
SPEC = importlib.util.spec_from_file_location("deploy_algolia_chat_stack", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class MergeConfigTests(unittest.TestCase):
    def test_adds_temperature_without_dropping_existing_controls(self):
        current = {
            "useCache": False,
            "max_tokens": 1000,
            "rate_limit": {"agent": {"enabled": True}},
        }

        merged = MODULE.merge_config(current, {"temperature": 0.5})

        self.assertEqual(merged["temperature"], 0.5)
        self.assertEqual(merged["useCache"], False)
        self.assertEqual(merged["max_tokens"], 1000)
        self.assertEqual(merged["rate_limit"], current["rate_limit"])

    def test_does_not_mutate_input(self):
        current = {"max_iterations": 5}

        MODULE.merge_config(current, {"temperature": 0.5})

        self.assertEqual(current, {"max_iterations": 5})


class SearchToolPatchTests(unittest.TestCase):
    def setUp(self):
        self.tools = [
            {
                "name": "algolia_search_index",
                "type": "algolia_search_index",
                "indices": [
                    {
                        "index": "Algolia_Prod_Copy_Vanilla",
                        "description": "keep me",
                        "searchParameters": {"filters": None, "hitsPerPage": 7},
                    }
                ],
            },
            {"name": "ask_specialist", "type": "client_side"},
        ]
        self.patch = {
            "toolName": "algolia_search_index",
            "indexName": "Algolia_Prod_Copy_Vanilla",
            "searchParameters": {
                "filters": 'environment:"prod20260722" AND language_code:"en" AND NOT is404:true'
            },
        }

    def test_patches_only_the_declared_search_parameters(self):
        original = deepcopy(self.tools)

        patched = MODULE.patch_search_tool(self.tools, self.patch)

        self.assertEqual(self.tools, original)
        self.assertEqual(patched[1], original[1])
        self.assertEqual(patched[0]["indices"][0]["description"], "keep me")
        self.assertEqual(patched[0]["indices"][0]["searchParameters"]["hitsPerPage"], 7)
        self.assertEqual(
            patched[0]["indices"][0]["searchParameters"]["filters"],
            self.patch["searchParameters"]["filters"],
        )

    def test_rejects_missing_or_ambiguous_targets(self):
        with self.assertRaisesRegex(RuntimeError, "exactly one tool"):
            MODULE.patch_search_tool([], self.patch)

        duplicate = self.tools + [deepcopy(self.tools[0])]
        with self.assertRaisesRegex(RuntimeError, "exactly one tool"):
            MODULE.patch_search_tool(duplicate, self.patch)

        missing_index = {**self.patch, "indexName": "missing"}
        with self.assertRaisesRegex(RuntimeError, "exactly one index"):
            MODULE.patch_search_tool(self.tools, missing_index)

    def test_payload_cannot_mutate_prompts_or_agent_config(self):
        payload = MODULE.build_search_tool_payload(self.tools, self.patch)

        self.assertEqual(set(payload), {"tools"})
        self.assertNotIn("instructions", payload)
        self.assertNotIn("systemPrompt", payload)
        self.assertNotIn("config", payload)

    def test_manifest_declares_the_measured_production_english_filter(self):
        manifest = json.loads((MODULE.ROOT / "config/deployments/algolia-chat-stack.json").read_text())
        patch = manifest["agentStudio"]["orchestrator"]["searchToolPatch"]

        self.assertEqual(patch["toolName"], "algolia_search_index")
        self.assertEqual(patch["indexName"], "Algolia_Prod_Copy_Vanilla")
        self.assertEqual(
            patch["searchParameters"]["filters"],
            'environment:"prod20260722" AND language_code:"en" AND NOT is404:true',
        )
        self.assertEqual(patch["searchParameters"]["hitsPerPage"], 5)
        self.assertEqual(
            patch["searchParameters"]["attributesToRetrieve"],
            ["objectID", "title", "url", "source", "category"],
        )
        self.assertEqual(patch["searchParameters"]["attributesToSnippet"], ["description:80"])

    def test_apply_sends_only_tools_and_proves_prompts_are_unchanged(self):
        before = {
            "tools": self.tools,
            "instructions": "carefully curated instructions",
            "systemPrompt": "carefully curated system prompt",
            "config": {"guardrail": {"enabled": True}},
            "providerId": "provider",
            "model": "model",
        }
        expected_tools = MODULE.patch_search_tool(self.tools, self.patch)
        after = {**before, "tools": expected_tools}
        manifest = {
            "environment": {
                "algoliaAppIdEnv": "APP",
                "algoliaAdminApiKeyEnv": "KEY",
            },
            "agentStudio": {
                "orchestrator": {
                    "agentId": "agent",
                    "name": "orchestrator",
                    "evidenceRoot": "evidence",
                    "searchToolPatch": self.patch,
                }
            },
        }

        with tempfile.TemporaryDirectory() as directory, patch.object(
            MODULE, "ROOT", Path(directory)
        ), patch.object(MODULE, "load_env", return_value={"APP": "app", "KEY": "key"}), patch.object(
            MODULE, "request_json", side_effect=[before, {}, after]
        ) as request:
            result = MODULE.deploy_search_tool(manifest, apply=True, run_id="run")

        self.assertTrue(result["pass"])
        method, _, _, _, payload = request.call_args_list[1].args
        self.assertEqual(method, "PATCH")
        self.assertEqual(set(payload), {"tools"})
        self.assertEqual(payload["tools"], expected_tools)

    def test_reviewed_private_apply_refuses_target_drift(self):
        before = {
            "tools": self.tools,
            "instructions": "instructions",
            "systemPrompt": "system",
            "config": {"guardrail": {"enabled": True}},
            "providerId": "provider",
            "model": "model",
        }
        manifest = {
            "environment": {"algoliaAppIdEnv": "APP", "algoliaAdminApiKeyEnv": "KEY"},
            "agentStudio": {
                "orchestrator": {
                    "agentId": "agent",
                    "name": "orchestrator",
                    "evidenceRoot": "evidence",
                    "searchToolPatch": self.patch,
                }
            },
        }
        with tempfile.TemporaryDirectory(dir="/private/tmp") as directory:
            evidence_dir = Path(directory)
            (evidence_dir / "before-snapshot.json").write_text(json.dumps(before))
            (evidence_dir / "mutation-packet.json").write_text(json.dumps({"searchToolPatch": self.patch}))
            drifted = {**before, "config": {"guardrail": {"enabled": False}}}
            with patch.object(MODULE, "load_env", return_value={"APP": "app", "KEY": "key"}), patch.object(
                MODULE, "request_json", return_value=drifted
            ):
                with self.assertRaisesRegex(RuntimeError, "drifted after dry-run"):
                    MODULE.deploy_search_tool(
                        manifest,
                        apply=True,
                        run_id="run",
                        evidence_dir_override=evidence_dir,
                    )


if __name__ == "__main__":
    unittest.main()
