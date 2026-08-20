import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "deploy_jahia_internal_docs_fixture.py"
SPEC = importlib.util.spec_from_file_location("deploy_jahia_internal_docs_fixture", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


def valid_state():
    return {
        "sourceLink": {
            "path": MODULE.SOURCE_LINK,
            "primaryNodeType": {"name": "aant:algoliaRichText"},
            "properties": [{"name": "text", "value": MODULE.DOC_LINK_HTML}],
        },
        "legacyCta": None,
        "doc": {"path": MODULE.DOC_JCR_PATH, "primaryNodeType": {"name": "jnt:page"}},
    }


class InternalDocsFixtureTests(unittest.TestCase):
    def test_source_link_reader_requests_localized_text(self):
        response = {
            "data": {
                "jcr": {
                    "nodeByPath": {
                        "path": MODULE.SOURCE_LINK,
                        "name": MODULE.SOURCE_LINK_NAME,
                        "primaryNodeType": {"name": "aant:algoliaRichText"},
                        "text": {"name": "text", "value": MODULE.DOC_LINK_HTML, "values": None},
                    }
                }
            }
        }
        with patch.object(MODULE, "graphql", return_value=response) as graphql:
            current = MODULE.source_link_node("EDIT")
        query, variables = graphql.call_args.args
        self.assertIn('property(name: "text", language: "en")', query)
        self.assertEqual(variables, {"path": MODULE.SOURCE_LINK})
        self.assertEqual(current["properties"][0]["value"], MODULE.DOC_LINK_HTML)

    def test_exact_product_to_documentation_contract(self):
        self.assertEqual(MODULE.SOURCE_PAGE, "/sites/www/home/products/ai-search")
        self.assertEqual(
            MODULE.SOURCE_LINK,
            "/sites/www/home/products/ai-search/container-8-main-accordion-container-algolia-accordion-7/proactive-docs-link",
        )
        self.assertEqual(
            MODULE.LEGACY_SOURCE_CTA,
            "/sites/www/home/products/ai-search/container-8-main-accordion-container-algolia-accordion-7/proactive-docs-cta",
        )
        self.assertIn(MODULE.DOC_ROUTE, MODULE.DOC_LINK_HTML)
        self.assertIn('data-algolia-internal-doc-link="instantsearch-js"', MODULE.DOC_LINK_HTML)

    def test_source_link_is_created_as_normal_rich_text_anchor(self):
        created = {"data": {"jcr": {"link": {"node": {"path": MODULE.SOURCE_LINK}}}}}
        with patch.object(MODULE, "read_state", return_value={"sourceLink": None}), patch.object(
            MODULE, "graphql_with_parent_retry", return_value=created
        ) as graphql, patch.object(MODULE, "wait_for_node") as wait_for_node:
            actual = MODULE.ensure_source_link()

        mutation, variables = graphql.call_args.args
        self.assertIn('primaryNodeType: "aant:algoliaRichText"', mutation)
        self.assertEqual(variables["parent"], MODULE.SOURCE_CTA_PARENT)
        self.assertEqual(variables["name"], MODULE.SOURCE_LINK_NAME)
        self.assertEqual(variables["html"], MODULE.DOC_LINK_HTML)
        self.assertEqual(actual["status"], "created")
        wait_for_node.assert_called_once_with(MODULE.SOURCE_LINK)

    def test_source_link_creation_is_idempotent(self):
        existing = valid_state()["sourceLink"]
        with patch.object(MODULE, "read_state", return_value={"sourceLink": existing}), patch.object(
            MODULE, "graphql_with_parent_retry"
        ) as graphql:
            self.assertEqual(MODULE.ensure_source_link(), {"path": MODULE.SOURCE_LINK, "status": "existing"})
        graphql.assert_not_called()

    def test_source_link_updates_stale_goal_owned_html(self):
        existing = valid_state()["sourceLink"]
        existing["properties"][0]["value"] = "<p>stale</p>"
        updated = {"data": {"jcr": {"link": {"node": {"path": MODULE.SOURCE_LINK}}}}}
        with patch.object(MODULE, "read_state", return_value={"sourceLink": existing}), patch.object(
            MODULE, "graphql_with_stale_retry", return_value=updated
        ) as graphql:
            actual = MODULE.ensure_source_link()
        mutation, variables = graphql.call_args.args
        self.assertIn('mutateProperty(name: "text")', mutation)
        self.assertEqual(variables, {"path": MODULE.SOURCE_LINK, "html": MODULE.DOC_LINK_HTML})
        self.assertEqual(actual["status"], "updated")

    def test_source_link_rejects_unexpected_existing_node_type(self):
        unexpected = {"primaryNodeType": {"name": "jnt:page"}, "properties": []}
        with patch.object(MODULE, "read_state", return_value={"sourceLink": unexpected}):
            with self.assertRaisesRegex(RuntimeError, "is not an aant:algoliaRichText"):
                MODULE.ensure_source_link()

    def test_legacy_goal_owned_cta_is_removed(self):
        legacy = {"primaryNodeType": {"name": "aant:algoliaCta"}}
        with patch.object(MODULE, "node", return_value=legacy), patch.object(
            MODULE, "delete_owned_node", return_value={"deleted": True}
        ) as delete:
            actual = MODULE.remove_legacy_source_cta()
        delete.assert_called_once_with(MODULE.LEGACY_SOURCE_CTA)
        self.assertEqual(actual["status"], "removed")

    def test_legacy_cleanup_rejects_unexpected_content(self):
        with patch.object(MODULE, "node", return_value={"primaryNodeType": {"name": "jnt:page"}}):
            with self.assertRaisesRegex(RuntimeError, "is not the goal-owned CTA"):
                MODULE.remove_legacy_source_cta()

    def test_page_properties_use_existing_home_template(self):
        properties = {item["name"]: item for item in MODULE.page_properties("InstantSearch.js")}
        self.assertEqual(properties["j:templateName"]["value"], "home")
        self.assertEqual(properties["jcr:title"]["language"], "en")

    def test_documentation_fixture_can_reach_required_scroll_depth(self):
        self.assertIn('data-algolia-scroll-fixture="true"', MODULE.DOC_HTML)
        self.assertIn("min-height: 180vh", MODULE.DOC_HTML)

    def test_parent_mutation_retries_path_not_found(self):
        success = {"data": {"jcr": {"page": {"node": {"path": "/sites/www/home/doc"}}}}}
        missing = RuntimeError("javax.jcr.PathNotFoundException")
        with patch.object(MODULE, "graphql", side_effect=[missing, success]), patch.object(MODULE.time, "sleep") as sleep:
            self.assertEqual(MODULE.graphql_with_parent_retry("mutation", {}, attempts=2, delay=0), success)
        self.assertEqual(sleep.call_count, 1)

    def test_sequential_mutation_retries_known_consistency_failures(self):
        success = {"ok": True}
        for failure in ("InvalidItemStateException", "PathNotFoundException"):
            with self.subTest(failure=failure), patch.object(
                MODULE, "graphql", side_effect=[RuntimeError(failure), success]
            ), patch.object(MODULE.time, "sleep"):
                self.assertEqual(MODULE.graphql_with_stale_retry("mutation", {}, attempts=2, delay=0), success)

    def test_mutation_retry_does_not_mask_unrelated_errors(self):
        with patch.object(MODULE, "graphql", side_effect=RuntimeError("permission denied")), patch.object(
            MODULE.time, "sleep"
        ) as sleep:
            with self.assertRaisesRegex(RuntimeError, "permission denied"):
                MODULE.graphql_with_stale_retry("mutation", {}, attempts=3, delay=0)
        sleep.assert_not_called()

    def test_validation_requires_real_navigation_link_and_no_legacy_cta(self):
        state = valid_state()
        self.assertTrue(MODULE.validate_state(state)["pass"])
        state["legacyCta"] = {"path": MODULE.LEGACY_SOURCE_CTA}
        self.assertFalse(MODULE.validate_state(state)["pass"])

    def test_validation_rejects_wrong_destination(self):
        state = valid_state()
        state["sourceLink"]["properties"][0]["value"] = '<p><a href="https://www.algolia.com/doc/">Docs</a></p>'
        self.assertFalse(MODULE.validate_state(state)["pass"])

    def test_wait_for_valid_state_handles_async_publication(self):
        invalid = {"sourceLink": None, "legacyCta": None, "doc": None}
        ready = valid_state()
        with patch.object(MODULE, "read_state", side_effect=[invalid, ready]), patch.object(
            MODULE.time, "sleep"
        ) as sleep:
            self.assertEqual(MODULE.wait_for_valid_state("LIVE", attempts=2, delay=0), ready)
        self.assertEqual(sleep.call_count, 1)

    def test_verify_current_state_is_read_only(self):
        ready = valid_state()
        with patch.object(MODULE, "read_state", side_effect=[ready, ready]) as read_state, patch.object(
            MODULE, "ensure_page_tree"
        ) as ensure_pages, patch.object(MODULE, "ensure_doc_content") as ensure_content, patch.object(
            MODULE, "ensure_source_link"
        ) as ensure_link, patch.object(MODULE, "publish") as publish:
            result = MODULE.verify_current_state()
        self.assertTrue(result["checks"]["pass"])
        self.assertEqual([call.args for call in read_state.call_args_list], [("EDIT",), ("LIVE",)])
        ensure_pages.assert_not_called()
        ensure_content.assert_not_called()
        ensure_link.assert_not_called()
        publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
