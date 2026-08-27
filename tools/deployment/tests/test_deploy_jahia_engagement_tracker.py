import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "deploy_jahia_engagement_tracker.py"
SPEC = importlib.util.spec_from_file_location("deploy_jahia_engagement_tracker", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def file_node(content: str) -> dict:
    return {
        "children": {
            "nodes": [
                {
                    "name": "jcr:content",
                    "properties": [{"name": "jcr:data", "value": content}],
                }
            ]
        }
    }


def block_html(version: str = "20260818-runtime-y") -> str:
    return (
        '<div class="algolia-chat-embed" data-release="existing-release">\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-chat.js?chat={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-proactive-controller.js?proactive={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-chat-theme-algolia-modal-greeting-width-20260815a.js?theme={version}"></script>\n'
        "</div>"
    )


def controller_state(html: str, content: str) -> dict:
    return {
        "capturedAt": "2026-08-19T00:00:00+00:00",
        "mode": "controller-only",
        "controllerVersion": MODULE.CONTROLLER_ONLY_VERSION,
        "target": {
            "controller": MODULE.PROACTIVE_CONTROLLER,
            "block": MODULE.BLOCK_PATH,
        },
        "edit": {
            "blockHtml": html,
            "proactiveControllerNode": file_node(content),
        },
        "live": {
            "blockHtml": html,
            "proactiveControllerNode": file_node(content),
        },
    }


def chat_state(html: str, content: str) -> dict:
    return {
        "capturedAt": "2026-08-19T00:00:00+00:00",
        "mode": "chat-only",
        "chatVersion": MODULE.CHAT_ONLY_VERSION,
        "target": {
            "chat": MODULE.CHAT,
            "block": MODULE.BLOCK_PATH,
        },
        "edit": {
            "blockHtml": html,
            "chatNode": file_node(content),
        },
        "live": {
            "blockHtml": html,
            "chatNode": file_node(content),
        },
    }


def judge_block_html(version: str = "old") -> str:
    return (
        '<div class="algolia-chat-embed" data-release="existing-release">\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-chat.js?chat={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-confidence-badge.js?judgeReview={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-proactive-controller.js?proactive={version}"></script>\n'
        "</div>"
    )


def judge_runtime_state(html: str, chat: str, badge: str) -> dict:
    side = {
        "blockHtml": html,
        "chatNode": file_node(chat),
        "confidenceBadgeNode": file_node(badge),
    }
    return {
        "capturedAt": "2026-08-20T00:00:00+00:00",
        "mode": "judge-runtime-only",
        "judgeRuntimeVersion": MODULE.JUDGE_RUNTIME_VERSION,
        "edit": dict(side),
        "live": dict(side),
    }


def journey_block_html(version: str = "old") -> str:
    return (
        '<div class="algolia-chat-embed" data-release="existing-release">\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-chat.js?chat={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-engagement-tracker.js?tracker={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-context-compiler.js?context={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-proactive-controller.js?proactive={version}"></script>\n'
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'handoff-to-orchestrator.js?handoff={version}"></script>\n'
        "</div>"
    )


def journey_state(html: str, tracker: str, compiler: str, controller: str) -> dict:
    side = {
        "blockHtml": html,
        "newTrackerNode": file_node(tracker),
        "contextCompilerNode": file_node(compiler),
        "proactiveControllerNode": file_node(controller),
    }
    return {
        "capturedAt": "2026-08-20T00:00:00+00:00",
        "mode": "journey-runtime-only",
        "journeyRuntimeVersion": MODULE.JOURNEY_RUNTIME_VERSION,
        "edit": dict(side),
        "live": dict(side),
    }


class ControllerOnlyHtmlTests(unittest.TestCase):
    def test_uses_new_august_19_controller_cache_token(self):
        self.assertEqual(MODULE.CONTROLLER_ONLY_VERSION, "20260819-controller-a")
        updated = MODULE.update_controller_block_html(block_html())

        self.assertIn("proactive=20260819-controller-a", updated)
        self.assertIn(
            'data-proactive-controller-release="20260819-controller-a"', updated
        )

    def test_changes_only_controller_query_and_controller_marker(self):
        original = block_html()
        updated = MODULE.update_controller_block_html(original)
        expected = original.replace(
            '<div class="algolia-chat-embed" data-release="existing-release">',
            '<div class="algolia-chat-embed" data-release="existing-release" '
            'data-proactive-controller-release="20260819-controller-a">',
        ).replace(
            "proactive=20260818-runtime-y",
            "proactive=20260819-controller-a",
        )

        self.assertEqual(updated, expected)
        self.assertIn("chat=20260818-runtime-y", updated)
        self.assertIn("theme=20260818-runtime-y", updated)
        self.assertIn('data-release="existing-release"', updated)

    def test_replaces_existing_controller_marker_idempotently(self):
        current = block_html().replace(
            'data-release="existing-release"',
            'data-release="existing-release" data-proactive-controller-release="old"',
        )
        once = MODULE.update_controller_block_html(current)
        twice = MODULE.update_controller_block_html(once)

        self.assertEqual(once, twice)
        self.assertEqual(once.count("data-proactive-controller-release="), 1)

    def test_fails_closed_when_controller_tag_is_missing_or_duplicated(self):
        missing = block_html().replace("algolia-proactive-controller.js", "missing.js")
        with self.assertRaisesRegex(RuntimeError, "exactly one proactive controller"):
            MODULE.update_controller_block_html(missing)

        controller_tag = block_html().splitlines()[2]
        duplicate = block_html() + controller_tag
        with self.assertRaisesRegex(RuntimeError, "exactly one proactive controller"):
            MODULE.update_controller_block_html(duplicate)


class CredentialLoadingTests(unittest.TestCase):
    def test_process_environment_takes_precedence_over_env_local(self):
        with tempfile.TemporaryDirectory() as directory:
            env_local = Path(directory) / ".env.local"
            env_local.write_text("JAHIA_API_TOKEN=repo-local-token\n", encoding="utf-8")
            with patch.object(MODULE, "ENV_LOCAL", env_local), patch.dict(
                MODULE.os.environ,
                {"JAHIA_API_TOKEN": "process-token"},
                clear=True,
            ):
                authorization = MODULE.load_token()

        self.assertEqual(authorization, "APIToken process-token")

    def test_loads_jahia_api_token_from_env_local_with_api_token_prefix(self):
        self.assertEqual(MODULE.ENV_LOCAL, MODULE.ROOT / ".env.local")
        with tempfile.TemporaryDirectory() as directory:
            env_local = Path(directory) / ".env.local"
            env_local.write_text('JAHIA_API_TOKEN="synthetic-test-token"\n', encoding="utf-8")
            with patch.object(MODULE, "ENV_LOCAL", env_local), patch.dict(
                MODULE.os.environ, {}, clear=True
            ):
                authorization = MODULE.load_token()

        self.assertEqual(authorization, "APIToken synthetic-test-token")

    def test_legacy_jhia_api_token_still_loads_as_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            env_local = Path(directory) / ".env.local"
            env_local.write_text('JHIA_API_TOKEN="legacy-test-token"\n', encoding="utf-8")
            with patch.object(MODULE, "ENV_LOCAL", env_local), patch.dict(
                MODULE.os.environ, {}, clear=True
            ):
                authorization = MODULE.load_token()

        self.assertEqual(authorization, "APIToken legacy-test-token")

    def test_missing_token_never_uses_personal_or_legacy_fallbacks(self):
        with tempfile.TemporaryDirectory() as directory:
            missing_env_local = Path(directory) / ".env.local"
            with patch.object(MODULE, "ENV_LOCAL", missing_env_local), patch.dict(
                MODULE.os.environ,
                {"JAHIA_AUTHORIZATION": "Bearer legacy-authorization"},
                clear=True,
            ), patch.object(
                MODULE.Path,
                "home",
                side_effect=AssertionError("personal home directory was consulted"),
            ):
                with self.assertRaisesRegex(RuntimeError, "JAHIA_API_TOKEN"):
                    MODULE.load_token()


class AccessCheckTests(unittest.TestCase):
    def test_access_check_reads_edit_and_live_without_returning_authorization(self):
        with patch.object(MODULE, "load_token", return_value="APIToken secret") as token, patch.object(
            MODULE, "load_base_url", return_value="https://jahia.example"
        ), patch.object(
            MODULE, "node", side_effect=[{"path": MODULE.BLOCK_PATH}, {"path": MODULE.BLOCK_PATH}]
        ) as read_node, patch.object(
            MODULE, "block_html", side_effect=["edit html", "live html"]
        ) as read_html:
            checks = MODULE.access_check()

        self.assertTrue(checks["pass"])
        self.assertTrue(checks["tokenConfigured"])
        self.assertNotIn("authorization", checks)
        self.assertNotIn("secret", str(checks))
        self.assertEqual(
            read_node.call_args_list,
            [call(MODULE.BLOCK_PATH, "EDIT"), call(MODULE.BLOCK_PATH, "LIVE")],
        )
        self.assertEqual(read_html.call_args_list, [call("EDIT"), call("LIVE")])
        token.assert_called_once_with()

    def test_access_check_cli_is_read_only(self):
        with patch.object(MODULE.sys, "argv", ["deploy", "--check-access"]), patch.object(
            MODULE, "run_access_check", return_value=0
        ) as runner, patch.object(MODULE, "snapshot") as full_snapshot:
            result = MODULE.main()

        self.assertEqual(result, 0)
        runner.assert_called_once_with()
        full_snapshot.assert_not_called()


class ControllerOnlyDeploymentTests(unittest.TestCase):
    def test_plan_declares_exact_mutation_allowlist_and_exclusions(self):
        original = block_html()
        before = controller_state(original, "old controller")
        next_html = MODULE.update_controller_block_html(original)
        plan = MODULE.controller_only_plan(before, "new controller", next_html)

        self.assertEqual(
            [(item["operation"], item["path"]) for item in plan["mutationAllowlist"]],
            [
                ("upsert", MODULE.PROACTIVE_CONTROLLER),
                ("setBlockHtml", MODULE.BLOCK_PATH),
                ("publish", MODULE.PROACTIVE_CONTROLLER_CONTENT),
                ("publish", MODULE.PROACTIVE_CONTROLLER),
                ("createVersion", MODULE.BLOCK_PATH),
                ("publish", MODULE.BLOCK_PATH),
            ],
        )
        self.assertIn(MODULE.THEME, plan["excluded"]["theme"])
        self.assertNotIn(MODULE.PROACTIVE_CONTROLLER, plan["excluded"]["runtimeFiles"])
        self.assertEqual(plan["excluded"]["subtrees"], [MODULE.FILES_PATH, "/sites/www/home/drift"])
        self.assertEqual(
            [item["subtree"] for item in plan["mutationAllowlist"] if item["operation"] == "publish"],
            [False, False, False],
        )
    def test_apply_updates_and_publishes_only_controller_and_block(self):
        controller_content = MODULE.PROACTIVE_CONTROLLER_SRC.read_text(encoding="utf-8")
        original = block_html()
        expected_html = MODULE.update_controller_block_html(original)
        before = controller_state(original, "old controller")
        after = controller_state(expected_html, controller_content)

        with tempfile.TemporaryDirectory() as directory, patch.object(
            MODULE, "EVIDENCE_DIR", Path(directory)
        ), patch.object(
            MODULE, "controller_snapshot", side_effect=[before, after]
        ), patch.object(
            MODULE, "upsert_file", return_value={"updated": True}
        ) as upsert, patch.object(
            MODULE, "set_block_html", return_value={"updated": True}
        ) as set_html, patch.object(
            MODULE, "publish", return_value={"published": True}
        ) as publish, patch.object(
            MODULE, "version_block", return_value={"versioned": True}
        ) as version:
            result = MODULE.run_controller_only(apply=True)

        self.assertEqual(result, 0)
        upsert.assert_called_once_with(MODULE.PROACTIVE_CONTROLLER, controller_content)
        set_html.assert_called_once_with(expected_html)
        self.assertEqual(
            publish.call_args_list,
            [
                call(MODULE.PROACTIVE_CONTROLLER_CONTENT, subtree=False),
                call(MODULE.PROACTIVE_CONTROLLER, subtree=False),
                call(MODULE.BLOCK_PATH, subtree=False),
            ],
        )
        version.assert_called_once_with()

    def test_stale_live_republishes_only_exact_chat_and_block_subtrees(self):
        chat_content = MODULE.CHAT_SRC.read_text(encoding="utf-8")
        original = block_html()
        expected_html = MODULE.update_chat_block_html(original)
        before = chat_state(original, "old chat")
        stale = chat_state(original, "old chat")
        stale["edit"] = {
            "blockHtml": expected_html,
            "chatNode": file_node(chat_content),
        }
        after = chat_state(expected_html, chat_content)

        with tempfile.TemporaryDirectory() as directory, patch.object(
            MODULE, "EVIDENCE_DIR", Path(directory)
        ), patch.object(
            MODULE, "chat_snapshot", side_effect=[before, stale, after]
        ), patch.object(
            MODULE, "upsert_file", return_value={"updated": True}
        ), patch.object(
            MODULE, "set_block_html", return_value={"updated": True}
        ), patch.object(
            MODULE, "publish", return_value={"published": True}
        ) as publish, patch.object(
            MODULE, "version_block", return_value={"versioned": True}
        ):
            result = MODULE.run_chat_only(apply=True)

        self.assertEqual(result, 0)
        self.assertEqual(
            publish.call_args_list,
            [
                call(MODULE.CHAT_CONTENT, subtree=False),
                call(MODULE.CHAT, subtree=False),
                call(MODULE.BLOCK_PATH, subtree=False),
                call(MODULE.CHAT, subtree=True),
                call(MODULE.BLOCK_PATH, subtree=True),
            ],
        )

    def test_dry_run_writes_evidence_without_mutating(self):
        original = block_html()
        before = controller_state(original, "old controller")
        with tempfile.TemporaryDirectory() as directory, patch.object(
            MODULE, "EVIDENCE_DIR", Path(directory)
        ), patch.object(
            MODULE, "controller_snapshot", return_value=before
        ), patch.object(MODULE, "upsert_file") as upsert, patch.object(
            MODULE, "set_block_html"
        ) as set_html, patch.object(MODULE, "publish") as publish:
            result = MODULE.run_controller_only(apply=False)
            evidence = Path(directory)
            self.assertTrue((evidence / "before-snapshot.json").exists())
            self.assertTrue((evidence / "deployment-plan.json").exists())

        self.assertEqual(result, 0)
        upsert.assert_not_called()
        set_html.assert_not_called()
        publish.assert_not_called()

    def test_validation_requires_edit_and_live_sha_and_exact_block(self):
        content = "new controller"
        expected_html = MODULE.update_controller_block_html(block_html())
        state = controller_state(expected_html, content)
        checks = MODULE.validate_controller_only(state, content, expected_html)
        self.assertTrue(checks["pass"])
        self.assertEqual(checks["editControllerSha256"], MODULE.sha256(content))
        self.assertEqual(checks["liveControllerSha256"], MODULE.sha256(content))

        state["live"]["proactiveControllerNode"] = file_node("stale controller")
        self.assertFalse(
            MODULE.validate_controller_only(state, content, expected_html)["pass"]
        )


class ChatOnlyHtmlTests(unittest.TestCase):
    def test_changes_only_chat_query_and_chat_marker(self):
        original = block_html()
        updated = MODULE.update_chat_block_html(original)
        expected = original.replace(
            '<div class="algolia-chat-embed" data-release="existing-release">',
            '<div class="algolia-chat-embed" data-release="existing-release" '
            f'data-chat-release="{MODULE.CHAT_ONLY_VERSION}">',
        ).replace(
            "chat=20260818-runtime-y",
            f"chat={MODULE.CHAT_ONLY_VERSION}",
        )

        self.assertEqual(updated, expected)
        self.assertIn("proactive=20260818-runtime-y", updated)
        self.assertIn("theme=20260818-runtime-y", updated)
        self.assertIn('data-release="existing-release"', updated)

    def test_replaces_existing_chat_marker_idempotently(self):
        current = block_html().replace(
            'data-release="existing-release"',
            'data-release="existing-release" data-chat-release="old"',
        )
        once = MODULE.update_chat_block_html(current)
        twice = MODULE.update_chat_block_html(once)

        self.assertEqual(once, twice)
        self.assertEqual(once.count("data-chat-release="), 1)

    def test_fails_closed_when_chat_tag_is_missing_or_duplicated(self):
        missing = block_html().replace("algolia-chat.js", "missing.js")
        with self.assertRaisesRegex(RuntimeError, "exactly one algolia-chat.js"):
            MODULE.update_chat_block_html(missing)

        chat_tag = block_html().splitlines()[1]
        duplicate = block_html() + chat_tag
        with self.assertRaisesRegex(RuntimeError, "exactly one algolia-chat.js"):
            MODULE.update_chat_block_html(duplicate)


class ChatOnlyDeploymentTests(unittest.TestCase):
    def test_cli_routes_chat_only_to_narrow_runner(self):
        with patch.object(MODULE.sys, "argv", ["deploy", "--chat-only", "--apply"]), patch.object(
            MODULE, "run_chat_only", return_value=7
        ) as run_chat, patch.object(MODULE, "snapshot") as full_snapshot:
            result = MODULE.main()

        self.assertEqual(result, 7)
        run_chat.assert_called_once_with(True)
        full_snapshot.assert_not_called()

    def test_plan_declares_exact_mutation_allowlist_and_exclusions(self):
        original = block_html()
        before = chat_state(original, "old chat")
        next_html = MODULE.update_chat_block_html(original)
        plan = MODULE.chat_only_plan(before, "new chat", next_html)

        self.assertEqual(
            [(item["operation"], item["path"]) for item in plan["mutationAllowlist"]],
            [
                ("upsert", MODULE.CHAT),
                ("setBlockHtml", MODULE.BLOCK_PATH),
                ("publish", MODULE.CHAT_CONTENT),
                ("publish", MODULE.CHAT),
                ("createVersion", MODULE.BLOCK_PATH),
                ("publish", MODULE.BLOCK_PATH),
            ],
        )
        self.assertIn(MODULE.PROACTIVE_CONTROLLER, plan["excluded"]["runtimeFiles"])
        self.assertNotIn(MODULE.CHAT, plan["excluded"]["runtimeFiles"])
        self.assertEqual(
            plan["excluded"]["subtrees"],
            [MODULE.FILES_PATH, "/sites/www/home/drift"],
        )
        self.assertEqual(
            [item["subtree"] for item in plan["mutationAllowlist"] if item["operation"] == "publish"],
            [False, False, False],
        )
        self.assertEqual(
            [(item["path"], item["subtree"]) for item in plan["boundedRecovery"]],
            [(MODULE.CHAT, True), (MODULE.BLOCK_PATH, True)],
        )

    def test_apply_updates_and_publishes_only_chat_and_block(self):
        chat_content = MODULE.CHAT_SRC.read_text(encoding="utf-8")
        original = block_html()
        expected_html = MODULE.update_chat_block_html(original)
        before = chat_state(original, "old chat")
        after = chat_state(expected_html, chat_content)

        with tempfile.TemporaryDirectory() as directory, patch.object(
            MODULE, "EVIDENCE_DIR", Path(directory)
        ), patch.object(
            MODULE, "chat_snapshot", side_effect=[before, after]
        ), patch.object(
            MODULE, "upsert_file", return_value={"updated": True}
        ) as upsert, patch.object(
            MODULE, "set_block_html", return_value={"updated": True}
        ) as set_html, patch.object(
            MODULE, "publish", return_value={"published": True}
        ) as publish, patch.object(
            MODULE, "version_block", return_value={"versioned": True}
        ) as version:
            result = MODULE.run_chat_only(apply=True)

        self.assertEqual(result, 0)
        upsert.assert_called_once_with(MODULE.CHAT, chat_content)
        set_html.assert_called_once_with(expected_html)
        self.assertEqual(
            publish.call_args_list,
            [
                call(MODULE.CHAT_CONTENT, subtree=False),
                call(MODULE.CHAT, subtree=False),
                call(MODULE.BLOCK_PATH, subtree=False),
            ],
        )
        version.assert_called_once_with()

    def test_dry_run_snapshots_and_writes_plan_without_mutating(self):
        original = block_html()
        before = chat_state(original, "old chat")
        with tempfile.TemporaryDirectory() as directory, patch.object(
            MODULE, "EVIDENCE_DIR", Path(directory)
        ), patch.object(
            MODULE, "chat_snapshot", return_value=before
        ) as snapshot, patch.object(MODULE, "upsert_file") as upsert, patch.object(
            MODULE, "set_block_html"
        ) as set_html, patch.object(MODULE, "publish") as publish:
            result = MODULE.run_chat_only(apply=False)
            evidence = Path(directory)
            self.assertTrue((evidence / "before-snapshot.json").exists())
            self.assertTrue((evidence / "deployment-plan.json").exists())

        self.assertEqual(result, 0)
        snapshot.assert_called_once_with()
        upsert.assert_not_called()
        set_html.assert_not_called()
        publish.assert_not_called()

    def test_validation_requires_edit_and_live_sha_and_exact_block(self):
        content = "new chat"
        expected_html = MODULE.update_chat_block_html(block_html())
        state = chat_state(expected_html, content)
        checks = MODULE.validate_chat_only(state, content, expected_html)
        self.assertTrue(checks["pass"])
        self.assertEqual(checks["editChatSha256"], MODULE.sha256(content))
        self.assertEqual(checks["liveChatSha256"], MODULE.sha256(content))

        state["live"]["chatNode"] = file_node("stale chat")
        self.assertFalse(MODULE.validate_chat_only(state, content, expected_html)["pass"])


class JudgeRuntimeOnlyDeploymentTests(unittest.TestCase):
    def test_changes_only_judge_assets_and_release_marker(self):
        original = judge_block_html()
        updated = MODULE.update_judge_runtime_block_html(original)

        self.assertIn(f"chat={MODULE.JUDGE_RUNTIME_VERSION}", updated)
        self.assertIn(f"judgeReview={MODULE.JUDGE_RUNTIME_VERSION}", updated)
        self.assertIn(
            f'data-judge-runtime-release="{MODULE.JUDGE_RUNTIME_VERSION}"', updated
        )
        self.assertIn("proactive=old", updated)
        self.assertEqual(MODULE.update_judge_runtime_block_html(updated), updated)

    def test_plan_allowlists_only_chat_badge_and_block(self):
        original = judge_block_html()
        before = judge_runtime_state(original, "old chat", "old badge")
        expected_html = MODULE.update_judge_runtime_block_html(original)
        plan = MODULE.judge_runtime_only_plan(
            before, "new chat", "new badge", expected_html
        )

        self.assertEqual(
            [(item["operation"], item["path"]) for item in plan["mutationAllowlist"]],
            [
                ("upsert", MODULE.CHAT),
                ("upsert", MODULE.CONFIDENCE_BADGE),
                ("setBlockHtml", MODULE.BLOCK_PATH),
                ("publish", MODULE.CHAT_CONTENT),
                ("publish", MODULE.CHAT),
                ("publish", MODULE.CONFIDENCE_BADGE_CONTENT),
                ("publish", MODULE.CONFIDENCE_BADGE),
                ("createVersion", MODULE.BLOCK_PATH),
                ("publish", MODULE.BLOCK_PATH),
            ],
        )
        self.assertEqual(plan["excluded"]["subtrees"], [MODULE.FILES_PATH, "/sites/www/home/drift"])
        self.assertEqual(plan["mutationAllowlist"][-1], {
            "operation": "publish",
            "path": MODULE.BLOCK_PATH,
            "subtree": True,
        })

    def test_validation_requires_both_live_hashes_and_exact_block(self):
        chat = "new chat"
        badge = "new badge"
        expected_html = MODULE.update_judge_runtime_block_html(judge_block_html())
        state = judge_runtime_state(expected_html, chat, badge)

        self.assertTrue(
            MODULE.validate_judge_runtime_only(state, chat, badge, expected_html)["pass"]
        )
        state["live"]["confidenceBadgeNode"] = file_node("stale badge")
        self.assertFalse(
            MODULE.validate_judge_runtime_only(state, chat, badge, expected_html)["pass"]
        )


class JourneyRuntimeOnlyDeploymentTests(unittest.TestCase):
    def test_html_changes_only_three_queries_and_one_marker(self):
        original = journey_block_html()
        updated = MODULE.update_journey_runtime_block_html(original)

        self.assertIn(f"tracker={MODULE.JOURNEY_RUNTIME_VERSION}", updated)
        self.assertIn(f"context={MODULE.JOURNEY_RUNTIME_VERSION}", updated)
        self.assertIn(f"proactive={MODULE.JOURNEY_RUNTIME_VERSION}", updated)
        self.assertIn(
            f'data-journey-runtime-release="{MODULE.JOURNEY_RUNTIME_VERSION}"',
            updated,
        )
        self.assertIn("chat=old", updated)
        self.assertIn("handoff=old", updated)

    def test_html_update_is_idempotent_and_fails_closed(self):
        once = MODULE.update_journey_runtime_block_html(journey_block_html())
        self.assertEqual(once, MODULE.update_journey_runtime_block_html(once))
        for filename in (
            "algolia-engagement-tracker.js",
            "algolia-context-compiler.js",
            "algolia-proactive-controller.js",
        ):
            with self.assertRaisesRegex(RuntimeError, "exactly one"):
                MODULE.update_journey_runtime_block_html(
                    journey_block_html().replace(filename, "missing.js")
                )

    def test_cli_routes_to_narrow_runner(self):
        with patch.object(
            MODULE.sys,
            "argv",
            ["deploy", "--journey-runtime-only", "--apply"],
        ), patch.object(
            MODULE, "run_journey_runtime_only", return_value=9
        ) as runner, patch.object(MODULE, "snapshot") as full_snapshot:
            result = MODULE.main()

        self.assertEqual(result, 9)
        runner.assert_called_once_with(True)
        full_snapshot.assert_not_called()

    def test_apply_updates_only_three_assets_and_block(self):
        tracker = MODULE.TRACKER_SRC.read_text(encoding="utf-8")
        compiler = MODULE.CONTEXT_COMPILER_SRC.read_text(encoding="utf-8")
        controller = MODULE.PROACTIVE_CONTROLLER_SRC.read_text(encoding="utf-8")
        original = journey_block_html()
        expected_html = MODULE.update_journey_runtime_block_html(original)
        before = journey_state(original, "old tracker", "old compiler", "old controller")
        after = journey_state(expected_html, tracker, compiler, controller)

        with tempfile.TemporaryDirectory() as directory, patch.object(
            MODULE, "EVIDENCE_DIR", Path(directory)
        ), patch.object(
            MODULE, "journey_runtime_snapshot", side_effect=[before, after]
        ), patch.object(MODULE, "upsert_file", return_value={}) as upsert, patch.object(
            MODULE, "set_block_html", return_value={}
        ), patch.object(MODULE, "publish", return_value={}) as publish, patch.object(
            MODULE, "version_block", return_value={}
        ):
            result = MODULE.run_journey_runtime_only(apply=True)

        self.assertEqual(result, 0)
        self.assertEqual(
            upsert.call_args_list,
            [
                call(MODULE.NEW_TRACKER, tracker),
                call(MODULE.CONTEXT_COMPILER, compiler),
                call(MODULE.PROACTIVE_CONTROLLER, controller),
            ],
        )
        self.assertEqual(
            publish.call_args_list,
            [
                call(MODULE.TRACKER_CONTENT, subtree=False),
                call(MODULE.NEW_TRACKER, subtree=False),
                call(MODULE.CONTEXT_COMPILER_CONTENT, subtree=False),
                call(MODULE.CONTEXT_COMPILER, subtree=False),
                call(MODULE.PROACTIVE_CONTROLLER_CONTENT, subtree=False),
                call(MODULE.PROACTIVE_CONTROLLER, subtree=False),
                call(MODULE.BLOCK_PATH, subtree=True),
            ],
        )

    def test_validation_requires_exact_bytes_in_edit_and_live(self):
        html = MODULE.update_journey_runtime_block_html(journey_block_html())
        state = journey_state(html, "tracker", "compiler", "controller")
        checks = MODULE.validate_journey_runtime_only(
            state, "tracker", "compiler", "controller", html
        )
        self.assertTrue(checks["pass"])
        state["live"]["contextCompilerNode"] = file_node("stale")
        self.assertFalse(
            MODULE.validate_journey_runtime_only(
                state, "tracker", "compiler", "controller", html
            )["pass"]
        )


class TransientJcrRetryTests(unittest.TestCase):
    def test_publish_retries_eventual_path_visibility(self):
        with patch.object(
            MODULE,
            "graphql",
            side_effect=[
                RuntimeError("javax.jcr.PathNotFoundException"),
                {"data": {"jcr": {"target": {"node": {"path": "/asset"}}}}},
            ],
        ) as graphql, patch.object(MODULE.time, "sleep") as sleep:
            result = MODULE.publish("/asset/jcr:content", subtree=False)

        self.assertEqual(result["data"]["jcr"]["target"]["node"]["path"], "/asset")
        self.assertEqual(graphql.call_count, 2)
        sleep.assert_called_once_with(0.5)

    def test_block_write_never_blindly_retries_stale_item_save(self):
        with patch.object(
            MODULE,
            "graphql",
            side_effect=[
                RuntimeError("javax.jcr.InvalidItemStateException: stale item.save()"),
            ],
        ) as graphql, patch.object(MODULE.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "InvalidItemStateException"):
                MODULE.set_block_html("restored")

        self.assertEqual(graphql.call_count, 1)
        sleep.assert_not_called()

    def test_non_transient_publish_error_is_not_retried(self):
        with patch.object(
            MODULE, "graphql", side_effect=RuntimeError("permission denied")
        ) as graphql, patch.object(MODULE.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "permission denied"):
                MODULE.publish("/asset", subtree=False)

        self.assertEqual(graphql.call_count, 1)
        sleep.assert_not_called()

    def test_public_readback_retries_cdn_404_then_returns_exact_bytes(self):
        class Response:
            status = 200
            sent = False

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size):
                if self.sent:
                    return b""
                self.sent = True
                return b"published bytes"

        missing = MODULE.urllib.error.HTTPError(
            "https://example.invalid/asset.js", 404, "not found", None, None
        )
        with patch.object(
            MODULE.urllib.request, "urlopen", side_effect=[missing, Response()]
        ) as urlopen, patch.object(MODULE.time, "sleep") as sleep:
            observed = MODULE.fetch_public_bytes(
                "https://example.invalid/asset.js", attempts=2, delay=0.25
            )

        self.assertEqual(observed, b"published bytes")
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(0.25)

    def test_public_readback_does_not_retry_forbidden(self):
        forbidden = MODULE.urllib.error.HTTPError(
            "https://example.invalid/asset.js", 403, "forbidden", None, None
        )
        with patch.object(
            MODULE.urllib.request, "urlopen", side_effect=forbidden
        ) as urlopen, patch.object(MODULE.time, "sleep") as sleep:
            with self.assertRaises(MODULE.urllib.error.HTTPError):
                MODULE.fetch_public_bytes("https://example.invalid/asset.js")

        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()

    def test_public_readback_retries_connection_reset(self):
        class Response:
            status = 200
            sent = False

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size):
                if self.sent:
                    return b""
                self.sent = True
                return b"complete"

        with patch.object(
            MODULE.urllib.request,
            "urlopen",
            side_effect=[ConnectionResetError("reset"), Response()],
        ) as urlopen, patch.object(MODULE.time, "sleep"):
            observed = MODULE.fetch_public_bytes(
                "https://example.invalid/asset.js", attempts=2, delay=0
            )

        self.assertEqual(observed, b"complete")
        self.assertEqual(urlopen.call_count, 2)

    def test_public_readback_does_not_retry_certificate_failure(self):
        certificate_error = MODULE.urllib.error.URLError(
            MODULE.ssl.SSLCertVerificationError("certificate verify failed")
        )
        with patch.object(
            MODULE.urllib.request, "urlopen", side_effect=certificate_error
        ) as urlopen, patch.object(MODULE.time, "sleep") as sleep:
            with self.assertRaises(MODULE.urllib.error.URLError):
                MODULE.fetch_public_bytes("https://example.invalid/asset.js")

        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()

    def test_public_readback_deadline_can_abort_before_network_io(self):
        with patch.object(MODULE.urllib.request, "urlopen") as urlopen:
            with self.assertRaisesRegex(TimeoutError, "deadline exceeded"):
                MODULE.fetch_public_bytes(
                    "https://example.invalid/asset.js", deadline_seconds=0
                )

        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
