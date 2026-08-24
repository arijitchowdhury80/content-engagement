import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "deploy_team_uat.py"
SPEC = importlib.util.spec_from_file_location("deploy_team_uat", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class LoadAuthorizationTest(unittest.TestCase):
    def test_prefers_process_api_token_and_adds_required_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            self.assertEqual(
                MODULE.load_authorization(
                    {
                        "JAHIA_API_TOKEN": "process-secret",
                        "JHIA_API_TOKEN": "legacy-secret",
                        "JAHIA_AUTHORIZATION": "Bearer legacy",
                    },
                    missing,
                    (missing,),
                ),
                "APIToken process-secret",
            )

    def test_reads_repo_env_local_before_legacy_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_file = root / ".env.local"
            config_file = root / "config.toml"
            env_file.write_text(
                'JAHIA_API_TOKEN="repo-secret"\n', encoding="utf-8"
            )
            config_file.write_text(
                '[mcp_servers.jahia]\nauthorization = "Bearer config"\n',
                encoding="utf-8",
            )
            self.assertEqual(
                MODULE.load_authorization(
                    {"JAHIA_AUTHORIZATION": "Bearer legacy"},
                    env_file,
                    (config_file,),
                ),
                "APIToken repo-secret",
            )

    def test_supports_legacy_misspelled_token_as_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            self.assertEqual(
                MODULE.load_authorization(
                    {"JHIA_API_TOKEN": "legacy-secret"}, missing, (missing,)
                ),
                "APIToken legacy-secret",
            )

    def test_loads_canonical_base_url_and_strips_trailing_slash(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            self.assertEqual(
                MODULE.load_base_url(
                    {"JAHIA_BASE_URL": "https://jahia.example/"}, missing
                ),
                "https://jahia.example",
            )

    def test_falls_back_to_legacy_process_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            self.assertEqual(
                MODULE.load_authorization(
                    {"JAHIA_AUTHORIZATION": "Bearer current"},
                    missing,
                    (missing,),
                ),
                "Bearer current",
            )

    def test_reads_current_codex_config_before_fallbacks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_file = root / "config.toml"
            fallback = root / "config.toml.disabled"
            config_file.write_text(
                '[mcp_servers.jahia]\nauthorization = "Bearer current"\n',
                encoding="utf-8",
            )
            fallback.write_text(
                '[mcp_servers.jahia]\nauthorization = "Bearer fallback"\n',
                encoding="utf-8",
            )
            self.assertEqual(
                MODULE.load_authorization({}, root / ".env.local", (config_file, fallback)),
                "Bearer current",
            )

    def test_falls_back_to_legacy_codex_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            missing = root / "missing"
            config_file = root / "config.toml"
            config_file.write_text(
                '[mcp_servers.jahia]\nauthorization = "Bearer legacy"\n',
                encoding="utf-8",
            )
            self.assertEqual(
                MODULE.load_authorization({}, missing, (missing, config_file)),
                "Bearer legacy",
            )


class PublishTest(unittest.TestCase):
    def test_publishes_content_node_then_file_node(self):
        calls = []

        def record_publish(path):
            calls.append(path)

        with patch.object(MODULE, "publish_path", side_effect=record_publish):
            MODULE.publish()

        self.assertEqual(
            calls,
            [f"{MODULE.FILE_PATH}/jcr:content", MODULE.FILE_PATH],
        )

    def test_each_publish_uses_subtree_flags_and_exact_path(self):
        with patch.object(MODULE, "graphql") as graphql:
            MODULE.publish_path(f"{MODULE.FILE_PATH}/jcr:content")
            MODULE.publish_path(MODULE.FILE_PATH)

        self.assertEqual(
            [call.args[1]["path"] for call in graphql.call_args_list],
            [f"{MODULE.FILE_PATH}/jcr:content", MODULE.FILE_PATH],
        )
        for call in graphql.call_args_list:
            mutation = call.args[0]
            self.assertIn("publishSubNodes: true", mutation)
            self.assertIn("includeSubTree: true", mutation)


if __name__ == "__main__":
    unittest.main()
