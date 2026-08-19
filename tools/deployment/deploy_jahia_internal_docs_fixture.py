#!/usr/bin/env python3
"""Create the internal InstantSearch fixture and wire AI Search to it.

Dry-run is the default. ``--apply`` is required for any Jahia mutation.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_jahia_engagement_tracker import ROOT, graphql, node, publish, write_json


SOURCE_PAGE = "/sites/www/home/products/ai-search"
SOURCE_CTA_PARENT = (
    SOURCE_PAGE + "/container-8-main-accordion-container-algolia-accordion-7"
)
SOURCE_LINK_NAME = "proactive-docs-link"
SOURCE_LINK = f"{SOURCE_CTA_PARENT}/{SOURCE_LINK_NAME}"
LEGACY_SOURCE_CTA = f"{SOURCE_CTA_PARENT}/proactive-docs-cta"
SOURCE_LINK_LABEL = "Read the AI Search docs"
REFERENCE_EXTERNAL_DOC_URL = (
    "https://www.algolia.com/doc/guides/building-search-ui/what-is-instantsearch/js/"
)
DOC_ROUTE = (
    "https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home/"
    "doc/guides/building-search-ui/"
    "what-is-instantsearch/js.html"
)
DOC_JCR_PATH = "/sites/www/home/doc/guides/building-search-ui/what-is-instantsearch/js"

PAGE_SEGMENTS = (
    ("/sites/www/home", "doc", "Documentation"),
    ("/sites/www/home/doc", "guides", "Guides"),
    ("/sites/www/home/doc/guides", "building-search-ui", "Building Search UI"),
    (
        "/sites/www/home/doc/guides/building-search-ui",
        "what-is-instantsearch",
        "What is InstantSearch?",
    ),
    (
        "/sites/www/home/doc/guides/building-search-ui/what-is-instantsearch",
        "js",
        "InstantSearch.js",
    ),
)

DOC_HTML = """
<article
  data-algolia-internal-doc-fixture="instantsearch-js"
  data-algolia-scroll-fixture="true"
  style="min-height: 180vh"
>
  <h1>What is InstantSearch.js?</h1>
  <p>InstantSearch.js is Algolia's open-source UI library for building search experiences in JavaScript.</p>
  <h2>How the pieces fit together</h2>
  <p>The search client connects your Algolia application and index. Widgets render the search box, results, filters, pagination, and other interactions. The InstantSearch instance coordinates state and requests.</p>
  <h2>Implementation path</h2>
  <ol>
    <li>Create the search client with a search-only API key.</li>
    <li>Initialize InstantSearch with the target index.</li>
    <li>Add the widgets required by the experience.</li>
    <li>Start the search and validate requests, relevance, and analytics.</li>
  </ol>
  <h2>What to decide before a proof of concept</h2>
  <p>Confirm the record shape, searchable and filterable attributes, ranking strategy, event plan, and the frontend surfaces that will own search state. These decisions determine implementation effort more than the first visual component does.</p>
  <h2>Next step</h2>
  <p>Use this internal same-origin fixture to validate that product research carries into implementation guidance without losing the visitor's active journey or conversation.</p>
</article>
""".strip()

DOC_LINK_HTML = (
    f'<p><a data-algolia-internal-doc-link="instantsearch-js" href="{DOC_ROUTE}">'
    f"{SOURCE_LINK_LABEL}</a></p>"
)


def expected_page_paths() -> list[str]:
    return [f"{parent}/{name}" for parent, name, _ in PAGE_SEGMENTS]


def page_properties(title: str) -> list[dict[str, str]]:
    return [
        {"name": "j:templateName", "type": "STRING", "value": "home"},
        {"name": "jcr:title", "language": "en", "type": "STRING", "value": title},
        {
            "name": "jcr:description",
            "language": "en",
            "type": "STRING",
            "value": "Internal same-origin documentation fixture for proactive journey testing.",
        },
    ]


def graphql_with_parent_retry(
    query: str, variables: dict, attempts: int = 12, delay: float = 0.5
) -> dict:
    """Retry only Jahia's transient parent-path visibility failure."""
    for attempt in range(attempts):
        try:
            return graphql(query, variables)
        except RuntimeError as exc:
            if "PathNotFoundException" not in str(exc) or attempt + 1 >= attempts:
                raise
            time.sleep(delay)
    raise AssertionError("unreachable")


def graphql_with_stale_retry(
    query: str, variables: dict, attempts: int = 12, delay: float = 0.5
) -> dict:
    """Retry Jahia consistency failures between sequential mutations."""
    for attempt in range(attempts):
        try:
            return graphql(query, variables)
        except RuntimeError as exc:
            transient = (
                "InvalidItemStateException" in str(exc)
                or "PathNotFoundException" in str(exc)
            )
            if not transient or attempt + 1 >= attempts:
                raise
            time.sleep(delay)
    raise AssertionError("unreachable")


def source_link_node(workspace: str) -> dict | None:
    """Read the link with its localized rich-text value."""
    query = """
    query SourceLink($path: String!) {
      jcr(workspace: %s) {
        nodeByPath(path: $path) {
          path
          name
          primaryNodeType { name }
          text: property(name: "text", language: "en") { name value values }
        }
      }
    }
    """ % workspace
    try:
        current = graphql(query, {"path": SOURCE_LINK})["data"]["jcr"]["nodeByPath"]
    except RuntimeError as exc:
        if "PathNotFoundException" in str(exc):
            return None
        raise
    if current and current.get("text"):
        current["properties"] = [current.pop("text")]
    return current


def read_state(workspace: str) -> dict:
    # Query nodes independently because Jahia fails an aliased multi-node query
    # when any optional path is absent, hiding valid siblings from readback.
    return {
        "sourceLink": source_link_node(workspace),
        "legacyCta": node(LEGACY_SOURCE_CTA, workspace),
        "doc": node(DOC_JCR_PATH, workspace),
    }


def create_page(parent: str, name: str, title: str) -> dict:
    mutation = """
    mutation CreatePage(
      $parent: String!
      $name: String!
      $properties: [InputJCRProperty]
    ) {
      jcr(workspace: EDIT) {
        page: addNode(
          parentPathOrId: $parent
          name: $name
          primaryNodeType: "jnt:page"
          properties: $properties
        ) { node { path } }
      }
    }
    """
    return graphql_with_parent_retry(
        mutation,
        {"parent": parent, "name": name, "properties": page_properties(title)},
    )


def wait_for_node(path: str, workspace: str = "EDIT", attempts: int = 12, delay: float = 0.5) -> dict:
    """Wait until a freshly-mutated Jahia node is queryable before using it as a parent."""
    for attempt in range(attempts):
        current = node(path, workspace)
        if current:
            return current
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise RuntimeError(f"Jahia node {path} was not queryable in {workspace} after {attempts} attempts")


def ensure_page_tree() -> list[dict]:
    results = []
    for parent, name, title in PAGE_SEGMENTS:
        path = f"{parent}/{name}"
        existing = node(path, "EDIT")
        if existing:
            if existing["primaryNodeType"]["name"] != "jnt:page":
                raise RuntimeError(f"{path} exists but is not a jnt:page")
            results.append({"path": path, "status": "existing"})
            continue
        result = create_page(parent, name, title)
        wait_for_node(path)
        results.append({"path": path, "status": "created", "result": result})
    return results


def ensure_doc_content() -> dict:
    pagecontent_path = f"{DOC_JCR_PATH}/pagecontent"
    content_path = f"{pagecontent_path}/instantsearch-overview"
    if not node(pagecontent_path, "EDIT"):
        graphql_with_parent_retry(
            """
            mutation AddContentList($parent: String!) {
              jcr(workspace: EDIT) {
                list: addNode(
                  parentPathOrId: $parent
                  name: "pagecontent"
                  primaryNodeType: "jnt:contentList"
                ) { node { path } }
              }
            }
            """,
            {"parent": DOC_JCR_PATH},
        )
        wait_for_node(pagecontent_path)

    if node(content_path, "EDIT"):
        mutation = """
        mutation UpdateContent($path: String!, $html: String!) {
          jcr(workspace: EDIT) {
            content: mutateNode(pathOrId: $path) {
              text: mutateProperty(name: "text") {
                setValue(language: "en", type: STRING, value: $html)
              }
              node { path }
            }
          }
        }
        """
        return graphql(mutation, {"path": content_path, "html": DOC_HTML})

    mutation = """
    mutation AddContent($parent: String!, $html: String!) {
      jcr(workspace: EDIT) {
        content: addNode(
          parentPathOrId: $parent
          name: "instantsearch-overview"
          primaryNodeType: "aant:algoliaRichText"
          properties: [{ name: "text", language: "en", type: STRING, value: $html }]
        ) { node { path } }
      }
    }
    """
    return graphql_with_parent_retry(mutation, {"parent": pagecontent_path, "html": DOC_HTML})


def wait_for_node_absent(path: str, attempts: int = 12, delay: float = 0.5) -> None:
    for attempt in range(attempts):
        if node(path, "EDIT") is None:
            return
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise RuntimeError(f"Jahia node remained queryable after deletion: {path}")


def delete_owned_node(path: str) -> dict:
    result = graphql_with_stale_retry(
        """
        mutation DeleteOwnedFixtureNode($path: String!) {
          jcr(workspace: EDIT) {
            deleteNode(pathOrId: $path)
          }
        }
        """,
        {"path": path},
    )
    wait_for_node_absent(path)
    return result


def remove_legacy_source_cta() -> dict:
    existing = node(LEGACY_SOURCE_CTA, "EDIT")
    if existing:
        if existing["primaryNodeType"]["name"] != "aant:algoliaCta":
            raise RuntimeError(f"{LEGACY_SOURCE_CTA} exists but is not the goal-owned CTA")
        return {"path": LEGACY_SOURCE_CTA, "status": "removed", "result": delete_owned_node(LEGACY_SOURCE_CTA)}
    return {"path": LEGACY_SOURCE_CTA, "status": "absent"}


def ensure_source_link() -> dict:
    """Create a normal anchor so navigation changes URL and remains tracker-observable."""
    existing = read_state("EDIT").get("sourceLink")
    if existing:
        if existing["primaryNodeType"]["name"] != "aant:algoliaRichText":
            raise RuntimeError(f"{SOURCE_LINK} exists but is not an aant:algoliaRichText")
        properties = {item["name"]: item.get("value") for item in existing.get("properties", [])}
        if properties.get("text") == DOC_LINK_HTML:
            return {"path": SOURCE_LINK, "status": "existing"}
        result = graphql_with_stale_retry(
            """
            mutation UpdateAiSearchDocsLink($path: String!, $html: String!) {
              jcr(workspace: EDIT) {
                link: mutateNode(pathOrId: $path) {
                  text: mutateProperty(name: "text") {
                    setValue(language: "en", type: STRING, value: $html)
                  }
                  node { path }
                }
              }
            }
            """,
            {"path": SOURCE_LINK, "html": DOC_LINK_HTML},
        )
        return {"path": SOURCE_LINK, "status": "updated", "result": result}

    result = graphql_with_parent_retry(
        """
        mutation AddAiSearchDocsLink(
          $parent: String!
          $name: String!
          $html: String!
        ) {
          jcr(workspace: EDIT) {
            link: addNode(
              parentPathOrId: $parent
              name: $name
              primaryNodeType: "aant:algoliaRichText"
              properties: [{ name: "text", language: "en", type: STRING, value: $html }]
            ) { node { path } }
          }
        }
        """,
        {"parent": SOURCE_CTA_PARENT, "name": SOURCE_LINK_NAME, "html": DOC_LINK_HTML},
    )
    wait_for_node(SOURCE_LINK)
    return {"path": SOURCE_LINK, "status": "created", "result": result}


def validate_state(state: dict) -> dict:
    source = state.get("sourceLink") or {}
    source_props = {item["name"]: item for item in source.get("properties", [])}
    source_html = source_props.get("text", {}).get("value", "")
    checks = {
        "docExists": (state.get("doc") or {}).get("path") == DOC_JCR_PATH,
        "docIsPage": (state.get("doc") or {}).get("primaryNodeType", {}).get("name") == "jnt:page",
        "sourceLinkExists": source.get("path") == SOURCE_LINK,
        "sourceLinkIsRichText": source.get("primaryNodeType", {}).get("name") == "aant:algoliaRichText",
        "sourceLinkUsesSameOriginRoute": DOC_ROUTE in source_html,
        "sourceLinkHasTrackerMarker": 'data-algolia-internal-doc-link="instantsearch-js"' in source_html,
        "legacyInterceptingCtaRemoved": state.get("legacyCta") is None,
    }
    checks["pass"] = all(checks.values())
    return checks


def wait_for_valid_state(workspace: str, attempts: int = 60, delay: float = 1.0) -> dict:
    """Wait for Jahia's asynchronous publication/readback to become usable."""
    last_state = None
    for attempt in range(attempts):
        last_state = read_state(workspace)
        if validate_state(last_state)["pass"]:
            return last_state
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise RuntimeError(f"Jahia fixture did not become valid in {workspace} after {attempts} attempts")


def verify_current_state() -> dict:
    after = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "edit": read_state("EDIT"),
        "live": read_state("LIVE"),
    }
    checks = {"edit": validate_state(after["edit"]), "live": validate_state(after["live"])}
    checks["pass"] = checks["edit"]["pass"] and checks["live"]["pass"]
    return {"after": after, "checks": checks}


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify", action="store_true")
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()

    evidence_dir = args.evidence_dir or (
        ROOT
        / "docs/evidence/visitor-intelligence"
        / f"jahia-internal-docs-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    )
    if not evidence_dir.is_absolute():
        evidence_dir = ROOT / evidence_dir

    plan = {
        "sourcePage": SOURCE_PAGE,
        "sourceLinkParent": SOURCE_CTA_PARENT,
        "sourceLink": SOURCE_LINK,
        "legacySourceCta": LEGACY_SOURCE_CTA,
        "referenceExternalTarget": REFERENCE_EXTERNAL_DOC_URL,
        "sameOriginRoute": DOC_ROUTE,
        "docJcrPath": DOC_JCR_PATH,
        "pagePaths": expected_page_paths(),
        "apply": args.apply,
        "verifyOnly": args.verify,
        "rollback": "Remove only the goal-owned AI Search documentation link and restore the legacy goal-owned CTA only if its before-state existed; preserve unrelated page content.",
    }
    write_json(evidence_dir / "deployment-plan.json", plan)

    if args.verify:
        verification = verify_current_state()
        write_json(evidence_dir / "after-readback.json", verification["after"])
        write_json(evidence_dir / "deployment-validation.json", verification["checks"])
        print(json.dumps(verification["checks"], indent=2))
        return 0 if verification["checks"]["pass"] else 1

    before = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "edit": read_state("EDIT"),
        "live": read_state("LIVE"),
    }
    write_json(evidence_dir / "before-snapshot.json", before)

    if not args.apply:
        print(json.dumps(plan, indent=2))
        return 0

    mutations = {
        "pages": ensure_page_tree(),
        "content": ensure_doc_content(),
        "removeLegacySourceCta": remove_legacy_source_cta(),
        "sourceLink": ensure_source_link(),
    }
    mutations["publishDocs"] = publish("/sites/www/home/doc", subtree=True)
    mutations["publishSourcePage"] = publish(SOURCE_PAGE, subtree=True)
    write_json(evidence_dir / "mutation-results.json", mutations)

    after = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "edit": wait_for_valid_state("EDIT"),
        "live": wait_for_valid_state("LIVE"),
    }
    checks = {"edit": validate_state(after["edit"]), "live": validate_state(after["live"])}
    checks["pass"] = checks["edit"]["pass"] and checks["live"]["pass"]
    write_json(evidence_dir / "after-readback.json", after)
    write_json(evidence_dir / "deployment-validation.json", checks)
    print(json.dumps(checks, indent=2))
    return 0 if checks["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
