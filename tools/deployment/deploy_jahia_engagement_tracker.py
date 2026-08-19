#!/usr/bin/env python3
"""Deploy the visitor intelligence assets to the Jahia dev surface.

This is intentionally narrow: it updates only the visitor-intelligence assets
and the Drift custom-code block script references.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ENV_LOCAL = ROOT / ".env.local"
ENDPOINT = "https://tmp-content-eng-algolia.cloud.jahia.com/modules/graphql"
BLOCK_PATH = "/sites/www/home/drift/custom-code-block"
FILES_PATH = "/sites/www/files"
OLD_TRACKER = "/sites/www/files/algolia-chat-tracker.js"
CHAT = "/sites/www/files/algolia-chat.js"
CHAT_CONTENT = f"{CHAT}/jcr:content"
NEW_TRACKER = "/sites/www/files/algolia-engagement-tracker.js"
CONTEXT_COMPILER = "/sites/www/files/algolia-context-compiler.js"
PROACTIVE_CONTROLLER = "/sites/www/files/algolia-proactive-controller.js"
PROACTIVE_CONTROLLER_CONTENT = f"{PROACTIVE_CONTROLLER}/jcr:content"
HANDOFF_TO_ORCHESTRATOR = "/sites/www/files/handoff-to-orchestrator.js"
ENGAGE = "/sites/www/files/algolia-chat-engage.js"
THEME = "/sites/www/files/algolia-chat-theme-algolia-modal-greeting-width-20260815a.js"
CHAT_SRC = ROOT / "frontend/chat-widget/algolia-chat.js"
TRACKER_SRC = ROOT / "frontend/chat-widget/algolia-engagement-tracker.js"
CONTEXT_COMPILER_SRC = ROOT / "frontend/chat-widget/algolia-context-compiler.js"
PROACTIVE_CONTROLLER_SRC = ROOT / "frontend/chat-widget/algolia-proactive-controller.js"
HANDOFF_TO_ORCHESTRATOR_SRC = ROOT / "frontend/chat-widget/handoff-to-orchestrator.js"
ENGAGE_SRC = ROOT / "frontend/chat-widget/algolia-chat-engage.js"
THEME_SRC = ROOT / "frontend/chat-widget/algolia-chat-theme-algolia.js"
EVIDENCE_DIR = ROOT / "docs/evidence/visitor-intelligence/jahia-deploy-20260815/proactive-debug-trace"
RUNTIME_VERSION = "20260819-runtime-z"
CHAT_VERSION = RUNTIME_VERSION
CHAT_ONLY_VERSION = "20260819-chat-b"
TRACKER_VERSION = RUNTIME_VERSION
CONTEXT_COMPILER_VERSION = RUNTIME_VERSION
PROACTIVE_CONTROLLER_VERSION = RUNTIME_VERSION
CONTROLLER_ONLY_VERSION = "20260819-controller-a"
HANDOFF_TO_ORCHESTRATOR_VERSION = RUNTIME_VERSION
ENGAGE_VERSION = RUNTIME_VERSION
THEME_VERSION = "20260815-answer-rhythm-balanced-a"


def dotenv_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        name, separator, raw_value = line.partition("=")
        if not separator or name.strip() != key:
            continue
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        return value or None
    return None


def jahia_api_token_authorization(token: str) -> str:
    token = token.strip()
    if token.startswith("APIToken "):
        return token
    return f"APIToken {token}"


def load_token() -> str:
    if token := os.environ.get("JHIA_API_TOKEN"):
        return jahia_api_token_authorization(token)

    if token := dotenv_value(ENV_LOCAL, "JHIA_API_TOKEN"):
        return jahia_api_token_authorization(token)

    raise RuntimeError(
        "Jahia API token not found in JHIA_API_TOKEN or repository-local .env.local"
    )


def graphql(query: str, variables: dict | None = None) -> dict:
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": load_token(),
        },
    )
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        data = json.loads(response.read().decode("utf-8"))
    if data.get("errors"):
        raise RuntimeError(json.dumps(data["errors"], indent=2))
    return data


def node(path: str, workspace: str = "EDIT") -> dict | None:
    query = """
    query Node($path: String!) {
      jcr(workspace: %s) {
        nodeByPath(path: $path) {
          path
          name
          primaryNodeType { name }
          properties { name value values }
          children {
            nodes {
              path
              name
              primaryNodeType { name }
              properties { name value values }
            }
          }
        }
      }
    }
    """ % workspace
    try:
        return graphql(query, {"path": path})["data"]["jcr"]["nodeByPath"]
    except RuntimeError as exc:
        if "PathNotFoundException" in str(exc):
            return None
        raise


def block_html(workspace: str = "EDIT") -> str:
    query = """
    query BlockHtml {
      jcr(workspace: %s) {
        nodeByPath(path: "/sites/www/home/drift/custom-code-block") {
          property(name: "html", language: "en") { value }
        }
      }
    }
    """ % workspace
    return graphql(query)["data"]["jcr"]["nodeByPath"]["property"]["value"]


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_content(file_node: dict | None) -> str | None:
    if not file_node:
        return None
    for child in file_node.get("children", {}).get("nodes", []):
        if child.get("name") != "jcr:content":
            continue
        for prop in child.get("properties", []):
            if prop.get("name") == "jcr:data":
                return prop.get("value")
    return None


def validate_logo_reset(snapshot_after: dict, tracker_content: str) -> dict:
    live_html = snapshot_after["live"]["blockHtml"]
    checks = {
        "liveLogoResetEnabled": "reset-visitor-state-on-logo" in live_html,
        "liveHtmlReferencesTrackerVersion": f"tracker={TRACKER_VERSION}" in live_html,
        "liveNewTrackerExists": snapshot_after["live"]["newTrackerNode"] is not None,
        "liveTrackerMatchesSource": file_content(snapshot_after["live"]["newTrackerNode"])
        == tracker_content,
    }
    checks["pass"] = all(checks.values())
    return checks


def snapshot() -> dict:
    return {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "target": BLOCK_PATH,
        "trackerVersion": TRACKER_VERSION,
        "contextCompilerVersion": CONTEXT_COMPILER_VERSION,
        "engageVersion": ENGAGE_VERSION,
        "chatVersion": CHAT_VERSION,
        "edit": {
            "blockHtml": block_html("EDIT"),
            "oldTrackerNode": node(OLD_TRACKER, "EDIT"),
            "chatNode": node(CHAT, "EDIT"),
            "newTrackerNode": node(NEW_TRACKER, "EDIT"),
            "contextCompilerNode": node(CONTEXT_COMPILER, "EDIT"),
            "proactiveControllerNode": node(PROACTIVE_CONTROLLER, "EDIT"),
            "handoffToOrchestratorNode": node(HANDOFF_TO_ORCHESTRATOR, "EDIT"),
            "engageNode": node(ENGAGE, "EDIT"),
            "themeNode": node(THEME, "EDIT"),
        },
        "live": {
            "blockHtml": block_html("LIVE"),
            "oldTrackerNode": node(OLD_TRACKER, "LIVE"),
            "chatNode": node(CHAT, "LIVE"),
            "newTrackerNode": node(NEW_TRACKER, "LIVE"),
            "contextCompilerNode": node(CONTEXT_COMPILER, "LIVE"),
            "proactiveControllerNode": node(PROACTIVE_CONTROLLER, "LIVE"),
            "handoffToOrchestratorNode": node(HANDOFF_TO_ORCHESTRATOR, "LIVE"),
            "engageNode": node(ENGAGE, "LIVE"),
            "themeNode": node(THEME, "LIVE"),
        },
    }


def controller_snapshot() -> dict:
    """Capture only the two nodes owned by a controller-only deployment."""
    return {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "controller-only",
        "controllerVersion": CONTROLLER_ONLY_VERSION,
        "target": {
            "controller": PROACTIVE_CONTROLLER,
            "block": BLOCK_PATH,
        },
        "edit": {
            "blockHtml": block_html("EDIT"),
            "proactiveControllerNode": node(PROACTIVE_CONTROLLER, "EDIT"),
        },
        "live": {
            "blockHtml": block_html("LIVE"),
            "proactiveControllerNode": node(PROACTIVE_CONTROLLER, "LIVE"),
        },
    }


def chat_snapshot() -> dict:
    """Capture only the two nodes owned by a chat-only deployment."""
    return {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "chat-only",
        "chatVersion": CHAT_ONLY_VERSION,
        "target": {
            "chat": CHAT,
            "block": BLOCK_PATH,
        },
        "edit": {
            "blockHtml": block_html("EDIT"),
            "chatNode": node(CHAT, "EDIT"),
        },
        "live": {
            "blockHtml": block_html("LIVE"),
            "chatNode": node(CHAT, "LIVE"),
        },
    }


def upsert_file(path: str, content: str) -> dict:
    existing = node(path, "EDIT")
    if existing:
        mutation = """
        mutation UpdateFile($path: String!, $content: String!) {
          jcr(workspace: EDIT) {
            file: mutateNode(pathOrId: $path) {
              content: mutateDescendant(relPath: "jcr:content") {
                data: mutateProperty(name: "jcr:data") {
                  setValue(type: STRING, value: $content)
                }
                mime: mutateProperty(name: "jcr:mimeType") {
                  setValue(type: STRING, value: "application/javascript")
                }
                node { path }
              }
              node { path }
            }
          }
        }
        """
    else:
        name = path.rsplit("/", 1)[-1]
        mutation = """
        mutation CreateFile($content: String!, $name: String!) {
          jcr(workspace: EDIT) {
            file: addNode(
              parentPathOrId: "/sites/www/files",
              name: $name,
              primaryNodeType: "jnt:file",
              children: [{
                name: "jcr:content",
                primaryNodeType: "jnt:resource",
                properties: [
                  { name: "jcr:data", type: STRING, value: $content },
                  { name: "jcr:mimeType", type: STRING, value: "application/javascript" }
                ]
              }]
            ) {
              node { path }
            }
          }
        }
        """
        return graphql(mutation, {"content": content, "name": name})
    return graphql(mutation, {"path": path, "content": content})


def update_block_html(current: str) -> str:
    next_html = current
    next_html = re.sub(
        r"<algolia-chat\b[^>]*>",
        lambda match: (
            match.group(0)
            if "reset-visitor-state-on-logo" in match.group(0)
            else match.group(0)[:-1] + " reset-visitor-state-on-logo>"
        ),
        next_html,
        count=1,
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/algolia-chat-tracker\.js"></script>\n?',
        "",
        next_html,
    )
    tracker_tag = (
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-engagement-tracker.js?tracker={TRACKER_VERSION}"></script>'
    )
    context_compiler_tag = (
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-context-compiler.js?context={CONTEXT_COMPILER_VERSION}"></script>'
    )
    proactive_controller_tag = (
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-proactive-controller.js?proactive={PROACTIVE_CONTROLLER_VERSION}"></script>'
    )
    handoff_tag = (
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'handoff-to-orchestrator.js?handoff={HANDOFF_TO_ORCHESTRATOR_VERSION}"></script>'
    )
    engage_tag = (
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-chat-engage.js?engage={ENGAGE_VERSION}"></script>'
    )
    theme_tag = (
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-chat-theme-algolia-modal-greeting-width-20260815a.js?theme={THEME_VERSION}"></script>'
    )
    chat_tag = (
        '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/'
        f'algolia-chat.js?chat={CHAT_VERSION}"></script>'
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/algolia-chat\.js(?:\?[^"]*)?"></script>',
        chat_tag,
        next_html,
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/algolia-chat-theme-algolia[^"]*\.js(?:\?[^"]*)?"></script>',
        theme_tag,
        next_html,
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/algolia-engagement-tracker\.js(?:\?[^"]*)?"></script>',
        tracker_tag,
        next_html,
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/algolia-chat-engage\.js(?:\?[^"]*)?"></script>',
        engage_tag,
        next_html,
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/algolia-context-compiler\.js(?:\?[^"]*)?"></script>',
        context_compiler_tag,
        next_html,
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/algolia-proactive-controller\.js(?:\?[^"]*)?"></script>',
        proactive_controller_tag,
        next_html,
    )
    next_html = re.sub(
        r'<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/sites/www/files/handoff-to-orchestrator\.js(?:\?[^"]*)?"></script>',
        handoff_tag,
        next_html,
    )
    if "algolia-engagement-tracker.js" not in next_html:
        next_html = next_html.replace(engage_tag, tracker_tag + "\n" + engage_tag)
    if "algolia-chat.js" not in next_html:
        next_html = next_html.replace(engage_tag, chat_tag + "\n" + engage_tag)
    if "algolia-context-compiler.js" not in next_html:
        if tracker_tag in next_html:
            next_html = next_html.replace(tracker_tag, tracker_tag + "\n" + context_compiler_tag)
        else:
            next_html = next_html.replace(engage_tag, context_compiler_tag + "\n" + engage_tag)
    if "algolia-proactive-controller.js" not in next_html:
        if context_compiler_tag in next_html:
            next_html = next_html.replace(
                context_compiler_tag,
                context_compiler_tag + "\n" + proactive_controller_tag,
            )
        else:
            next_html = next_html.replace(engage_tag, proactive_controller_tag + "\n" + engage_tag)
    if "handoff-to-orchestrator.js" not in next_html:
        if proactive_controller_tag in next_html:
            next_html = next_html.replace(
                proactive_controller_tag,
                proactive_controller_tag + "\n" + handoff_tag,
            )
        else:
            next_html = next_html.replace(engage_tag, handoff_tag + "\n" + engage_tag)
    return next_html


def update_controller_block_html(current: str) -> str:
    """Change only the proactive controller cache key and its release marker."""
    controller_pattern = re.compile(
        r'(<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/'
        r'sites/www/files/algolia-proactive-controller\.js)(?:\?[^"\n]*)?(\"></script>)'
    )
    if len(controller_pattern.findall(current)) != 1:
        raise RuntimeError(
            "Controller-only deployment requires exactly one proactive controller script tag"
        )
    next_html = controller_pattern.sub(
        rf'\1?proactive={CONTROLLER_ONLY_VERSION}\2', current, count=1
    )

    embed_pattern = re.compile(r'<div\b[^>]*\bclass="[^"]*\balgolia-chat-embed\b[^"]*"[^>]*>')
    embed_matches = embed_pattern.findall(next_html)
    if len(embed_matches) != 1:
        raise RuntimeError(
            "Controller-only deployment requires exactly one algolia-chat-embed element"
        )
    embed = embed_matches[0]
    marker = f'data-proactive-controller-release="{CONTROLLER_ONLY_VERSION}"'
    if re.search(r'\sdata-proactive-controller-release="[^"]*"', embed):
        updated_embed = re.sub(
            r'\sdata-proactive-controller-release="[^"]*"',
            f" {marker}",
            embed,
            count=1,
        )
    else:
        updated_embed = embed[:-1] + f" {marker}>"
    return next_html.replace(embed, updated_embed, 1)


def update_chat_block_html(current: str) -> str:
    """Change only the chat asset cache key and its release marker."""
    chat_pattern = re.compile(
        r'(<script src="https://tmp-content-eng-algolia\.cloud\.jahia\.com/files/live/'
        r'sites/www/files/algolia-chat\.js)(?:\?[^"\n]*)?(\"></script>)'
    )
    if len(chat_pattern.findall(current)) != 1:
        raise RuntimeError(
            "Chat-only deployment requires exactly one algolia-chat.js script tag"
        )
    next_html = chat_pattern.sub(rf'\1?chat={CHAT_ONLY_VERSION}\2', current, count=1)

    embed_pattern = re.compile(r'<div\b[^>]*\bclass="[^"]*\balgolia-chat-embed\b[^"]*"[^>]*>')
    embed_matches = embed_pattern.findall(next_html)
    if len(embed_matches) != 1:
        raise RuntimeError(
            "Chat-only deployment requires exactly one algolia-chat-embed element"
        )
    embed = embed_matches[0]
    marker = f'data-chat-release="{CHAT_ONLY_VERSION}"'
    if re.search(r'\sdata-chat-release="[^"]*"', embed):
        updated_embed = re.sub(
            r'\sdata-chat-release="[^"]*"',
            f" {marker}",
            embed,
            count=1,
        )
    else:
        updated_embed = embed[:-1] + f" {marker}>"
    return next_html.replace(embed, updated_embed, 1)


def set_block_html(html: str) -> dict:
    mutation = """
    mutation SetBlockHtml($html: String!) {
      jcr(workspace: EDIT) {
        block: mutateNode(pathOrId: "/sites/www/home/drift/custom-code-block") {
          html: mutateProperty(name: "html") {
            setValue(language: "en", type: STRING, value: $html)
          }
          node { path }
        }
      }
    }
    """
    return graphql(mutation, {"html": html})


def version_block() -> dict:
    return graphql("""
      mutation VersionBlock {
        jcr(workspace: EDIT) {
          block: mutateNode(pathOrId: "/sites/www/home/drift/custom-code-block") {
            createVersion
            node { path }
          }
        }
      }
    """)


def publish(path: str, subtree: bool = False) -> dict:
    mutation = """
    mutation Publish($path: String!, $subtree: Boolean!) {
      jcr(workspace: EDIT) {
        target: mutateNode(pathOrId: $path) {
          publish(languages: ["en"], publishSubNodes: $subtree, includeSubTree: $subtree)
          node { path }
        }
      }
    }
    """
    return graphql(mutation, {"path": path, "subtree": subtree})


def delete_old_tracker() -> dict:
    if not node(OLD_TRACKER, "EDIT"):
        return {"skipped": "old tracker not present in EDIT"}
    mutation = """
    mutation DeleteOldTracker {
      jcr(workspace: EDIT) {
        deleteNode(pathOrId: "/sites/www/files/algolia-chat-tracker.js")
      }
    }
    """
    return graphql(mutation)


def validate(snapshot_after: dict) -> dict:
    live_html = snapshot_after["live"]["blockHtml"]
    live_chat = snapshot_after["live"]["chatNode"]
    live_tracker = snapshot_after["live"]["newTrackerNode"]
    live_context_compiler = snapshot_after["live"]["contextCompilerNode"]
    live_proactive_controller = snapshot_after["live"]["proactiveControllerNode"]
    live_handoff = snapshot_after["live"]["handoffToOrchestratorNode"]
    live_engage = snapshot_after["live"]["engageNode"]
    live_theme = snapshot_after["live"]["themeNode"]
    live_old_tracker = snapshot_after["live"]["oldTrackerNode"]
    edit_old_tracker = snapshot_after["edit"]["oldTrackerNode"]
    checks = {
        "liveHtmlReferencesNewTracker": "algolia-engagement-tracker.js" in live_html,
        "liveHtmlReferencesChat": "algolia-chat.js" in live_html,
        "liveHtmlReferencesChatVersion": f"chat={CHAT_VERSION}" in live_html,
        "liveHtmlReferencesTrackerVersion": f"tracker={TRACKER_VERSION}" in live_html,
        "liveHtmlReferencesContextCompiler": "algolia-context-compiler.js" in live_html,
        "liveHtmlReferencesContextCompilerVersion": f"context={CONTEXT_COMPILER_VERSION}" in live_html,
        "liveHtmlReferencesProactiveController": "algolia-proactive-controller.js" in live_html,
        "liveHtmlReferencesProactiveControllerVersion": f"proactive={PROACTIVE_CONTROLLER_VERSION}" in live_html,
        "liveHtmlReferencesHandoffToOrchestrator": "handoff-to-orchestrator.js" in live_html,
        "liveHtmlReferencesHandoffToOrchestratorVersion": f"handoff={HANDOFF_TO_ORCHESTRATOR_VERSION}" in live_html,
        "liveHtmlReferencesEngageVersion": f"engage={ENGAGE_VERSION}" in live_html,
        "liveHtmlReferencesTheme": "algolia-chat-theme-algolia-modal-greeting-width-20260815a.js" in live_html,
        "liveHtmlReferencesThemeVersion": f"theme={THEME_VERSION}" in live_html,
        "liveHtmlOmitsOldTracker": "algolia-chat-tracker.js" not in live_html,
        "liveNewTrackerExists": live_tracker is not None,
        "liveChatExists": live_chat is not None,
        "liveContextCompilerExists": live_context_compiler is not None,
        "liveProactiveControllerExists": live_proactive_controller is not None,
        "liveHandoffToOrchestratorExists": live_handoff is not None,
        "liveEngageExists": live_engage is not None,
        "liveThemeExists": live_theme is not None,
        "oldTrackerAbsentFromEdit": edit_old_tracker is None,
        "oldTrackerAbsentFromLive": live_old_tracker is None,
    }
    checks["pass"] = all(checks.values())
    return checks


def edit_has_expected_html(snapshot_after: dict) -> bool:
    edit_html = snapshot_after["edit"]["blockHtml"]
    return all(
        [
            f"tracker={TRACKER_VERSION}" in edit_html,
            "algolia-chat.js" in edit_html,
            f"chat={CHAT_VERSION}" in edit_html,
            "algolia-context-compiler.js" in edit_html,
            f"context={CONTEXT_COMPILER_VERSION}" in edit_html,
            "algolia-proactive-controller.js" in edit_html,
            f"proactive={PROACTIVE_CONTROLLER_VERSION}" in edit_html,
            "handoff-to-orchestrator.js" in edit_html,
            f"handoff={HANDOFF_TO_ORCHESTRATOR_VERSION}" in edit_html,
            f"engage={ENGAGE_VERSION}" in edit_html,
            "algolia-chat-theme-algolia-modal-greeting-width-20260815a.js" in edit_html,
            f"theme={THEME_VERSION}" in edit_html,
        ]
    )


def wait_for_live_validation(snapshot_after: dict, checks: dict, attempts: int = 8) -> tuple[dict, dict]:
    """Give Jahia LIVE readback a short bounded window to catch up after publish."""
    for _ in range(attempts):
        if checks["pass"] or not edit_has_expected_html(snapshot_after):
            break
        time.sleep(2)
        snapshot_after = snapshot()
        checks = validate(snapshot_after)
    return snapshot_after, checks


def validate_controller_only(
    snapshot_after: dict,
    controller_content: str,
    expected_html: str,
) -> dict:
    expected_sha = sha256(controller_content)
    edit_content = file_content(snapshot_after["edit"]["proactiveControllerNode"])
    live_content = file_content(snapshot_after["live"]["proactiveControllerNode"])
    edit_html = snapshot_after["edit"]["blockHtml"]
    live_html = snapshot_after["live"]["blockHtml"]
    marker = f'data-proactive-controller-release="{CONTROLLER_ONLY_VERSION}"'
    query = f"proactive={CONTROLLER_ONLY_VERSION}"
    checks = {
        "mode": "controller-only",
        "controllerVersion": CONTROLLER_ONLY_VERSION,
        "expectedControllerSha256": expected_sha,
        "editControllerSha256": sha256(edit_content) if edit_content is not None else None,
        "liveControllerSha256": sha256(live_content) if live_content is not None else None,
        "editControllerMatchesSource": edit_content == controller_content,
        "liveControllerMatchesSource": live_content == controller_content,
        "editBlockMatchesExpected": edit_html == expected_html,
        "liveBlockMatchesExpected": live_html == expected_html,
        "editBlockHasControllerQuery": query in edit_html,
        "liveBlockHasControllerQuery": query in live_html,
        "editBlockHasControllerMarker": marker in edit_html,
        "liveBlockHasControllerMarker": marker in live_html,
    }
    checks["pass"] = all(
        value for key, value in checks.items() if key not in {
            "mode",
            "controllerVersion",
            "expectedControllerSha256",
            "editControllerSha256",
            "liveControllerSha256",
        }
    )
    return checks


def controller_only_plan(before: dict, controller_content: str, next_html: str) -> dict:
    return {
        "mode": "controller-only",
        "target": {
            "controller": PROACTIVE_CONTROLLER,
            "block": BLOCK_PATH,
        },
        "intended": {
            "controllerVersion": CONTROLLER_ONLY_VERSION,
            "controllerSha256": sha256(controller_content),
            "controllerCacheQuery": f"proactive={CONTROLLER_ONLY_VERSION}",
            "controllerReleaseMarker": CONTROLLER_ONLY_VERSION,
            "blockHtmlSha256": sha256(next_html),
        },
        "mutationAllowlist": [
            {"operation": "upsert", "path": PROACTIVE_CONTROLLER},
            {"operation": "setBlockHtml", "path": BLOCK_PATH},
            {
                "operation": "publish",
                "path": PROACTIVE_CONTROLLER_CONTENT,
                "subtree": False,
            },
            {
                "operation": "publish",
                "path": PROACTIVE_CONTROLLER,
                "subtree": False,
            },
            {"operation": "createVersion", "path": BLOCK_PATH},
            {"operation": "publish", "path": BLOCK_PATH, "subtree": False},
        ],
        "excluded": {
            "runtimeFiles": [CHAT, NEW_TRACKER, CONTEXT_COMPILER, HANDOFF_TO_ORCHESTRATOR, ENGAGE],
            "theme": THEME,
            "subtrees": [FILES_PATH, "/sites/www/home/drift"],
        },
        "rollback": {
            "restoreControllerFrom": "before-snapshot.json edit.proactiveControllerNode",
            "restoreBlockHtmlFrom": "before-snapshot.json edit.blockHtml",
        },
        "before": {
            "editControllerSha256": sha256(file_content(before["edit"]["proactiveControllerNode"]) or ""),
            "liveControllerSha256": sha256(file_content(before["live"]["proactiveControllerNode"]) or ""),
            "editBlockHtmlSha256": sha256(before["edit"]["blockHtml"]),
            "liveBlockHtmlSha256": sha256(before["live"]["blockHtml"]),
        },
    }


def run_controller_only(apply: bool) -> int:
    before = controller_snapshot()
    write_json(EVIDENCE_DIR / "before-snapshot.json", before)
    controller_content = PROACTIVE_CONTROLLER_SRC.read_text(encoding="utf-8")
    next_html = update_controller_block_html(before["edit"]["blockHtml"])
    plan = controller_only_plan(before, controller_content, next_html)
    write_json(EVIDENCE_DIR / "deployment-plan.json", plan)
    if not apply:
        print(json.dumps(plan, indent=2))
        return 0

    mutations = {
        "upsertProactiveController": upsert_file(PROACTIVE_CONTROLLER, controller_content),
        "setBlockHtml": set_block_html(next_html),
        "publishProactiveControllerContent": publish(
            PROACTIVE_CONTROLLER_CONTENT, subtree=False
        ),
        "publishProactiveController": publish(PROACTIVE_CONTROLLER, subtree=False),
        "versionBlock": version_block(),
        "publishBlock": publish(BLOCK_PATH, subtree=False),
    }
    write_json(EVIDENCE_DIR / "mutation-results.json", mutations)

    after = controller_snapshot()
    checks = validate_controller_only(after, controller_content, next_html)
    for _ in range(8):
        if checks["pass"]:
            break
        time.sleep(2)
        after = controller_snapshot()
        checks = validate_controller_only(after, controller_content, next_html)
    write_json(EVIDENCE_DIR / "after-readback.json", after)
    write_json(EVIDENCE_DIR / "deployment-validation.json", checks)
    print(json.dumps(checks, indent=2))
    return 0 if checks["pass"] else 1


def validate_chat_only(
    snapshot_after: dict,
    chat_content: str,
    expected_html: str,
) -> dict:
    expected_sha = sha256(chat_content)
    edit_content = file_content(snapshot_after["edit"]["chatNode"])
    live_content = file_content(snapshot_after["live"]["chatNode"])
    edit_html = snapshot_after["edit"]["blockHtml"]
    live_html = snapshot_after["live"]["blockHtml"]
    marker = f'data-chat-release="{CHAT_ONLY_VERSION}"'
    query = f"chat={CHAT_ONLY_VERSION}"
    checks = {
        "mode": "chat-only",
        "chatVersion": CHAT_ONLY_VERSION,
        "expectedChatSha256": expected_sha,
        "editChatSha256": sha256(edit_content) if edit_content is not None else None,
        "liveChatSha256": sha256(live_content) if live_content is not None else None,
        "editChatMatchesSource": edit_content == chat_content,
        "liveChatMatchesSource": live_content == chat_content,
        "editBlockMatchesExpected": edit_html == expected_html,
        "liveBlockMatchesExpected": live_html == expected_html,
        "editBlockHasChatQuery": query in edit_html,
        "liveBlockHasChatQuery": query in live_html,
        "editBlockHasChatMarker": marker in edit_html,
        "liveBlockHasChatMarker": marker in live_html,
    }
    checks["pass"] = all(
        value for key, value in checks.items() if key not in {
            "mode",
            "chatVersion",
            "expectedChatSha256",
            "editChatSha256",
            "liveChatSha256",
        }
    )
    return checks


def chat_only_plan(before: dict, chat_content: str, next_html: str) -> dict:
    return {
        "mode": "chat-only",
        "target": {
            "chat": CHAT,
            "block": BLOCK_PATH,
        },
        "intended": {
            "chatVersion": CHAT_ONLY_VERSION,
            "chatSha256": sha256(chat_content),
            "chatCacheQuery": f"chat={CHAT_ONLY_VERSION}",
            "chatReleaseMarker": CHAT_ONLY_VERSION,
            "blockHtmlSha256": sha256(next_html),
        },
        "mutationAllowlist": [
            {"operation": "upsert", "path": CHAT},
            {"operation": "setBlockHtml", "path": BLOCK_PATH},
            {"operation": "publish", "path": CHAT_CONTENT, "subtree": False},
            {"operation": "publish", "path": CHAT, "subtree": False},
            {"operation": "createVersion", "path": BLOCK_PATH},
            {"operation": "publish", "path": BLOCK_PATH, "subtree": False},
        ],
        "excluded": {
            "runtimeFiles": [
                NEW_TRACKER,
                CONTEXT_COMPILER,
                PROACTIVE_CONTROLLER,
                HANDOFF_TO_ORCHESTRATOR,
                ENGAGE,
            ],
            "theme": THEME,
            "subtrees": [FILES_PATH, "/sites/www/home/drift"],
        },
        "rollback": {
            "restoreChatFrom": "before-snapshot.json edit.chatNode",
            "restoreBlockHtmlFrom": "before-snapshot.json edit.blockHtml",
        },
        "before": {
            "editChatSha256": sha256(file_content(before["edit"]["chatNode"]) or ""),
            "liveChatSha256": sha256(file_content(before["live"]["chatNode"]) or ""),
            "editBlockHtmlSha256": sha256(before["edit"]["blockHtml"]),
            "liveBlockHtmlSha256": sha256(before["live"]["blockHtml"]),
        },
    }


def run_chat_only(apply: bool) -> int:
    before = chat_snapshot()
    write_json(EVIDENCE_DIR / "before-snapshot.json", before)
    chat_content = CHAT_SRC.read_text(encoding="utf-8")
    next_html = update_chat_block_html(before["edit"]["blockHtml"])
    plan = chat_only_plan(before, chat_content, next_html)
    write_json(EVIDENCE_DIR / "deployment-plan.json", plan)
    if not apply:
        print(json.dumps(plan, indent=2))
        return 0

    mutations = {
        "upsertChat": upsert_file(CHAT, chat_content),
        "setBlockHtml": set_block_html(next_html),
        "publishChatContent": publish(CHAT_CONTENT, subtree=False),
        "publishChat": publish(CHAT, subtree=False),
        "versionBlock": version_block(),
        "publishBlock": publish(BLOCK_PATH, subtree=False),
    }
    write_json(EVIDENCE_DIR / "mutation-results.json", mutations)

    after = chat_snapshot()
    checks = validate_chat_only(after, chat_content, next_html)
    for _ in range(8):
        if checks["pass"]:
            break
        time.sleep(2)
        after = chat_snapshot()
        checks = validate_chat_only(after, chat_content, next_html)
    write_json(EVIDENCE_DIR / "after-readback.json", after)
    write_json(EVIDENCE_DIR / "deployment-validation.json", checks)
    print(json.dumps(checks, indent=2))
    return 0 if checks["pass"] else 1


def main() -> int:
    global EVIDENCE_DIR
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--logo-reset-only",
        action="store_true",
        help="Deploy only the engagement tracker and logo-reset markup.",
    )
    parser.add_argument(
        "--controller-only",
        action="store_true",
        help="Deploy only the proactive controller and its Drift cache marker.",
    )
    parser.add_argument(
        "--chat-only",
        action="store_true",
        help="Deploy only algolia-chat.js and its Drift cache marker.",
    )
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()
    if args.evidence_dir:
        EVIDENCE_DIR = (
            args.evidence_dir
            if args.evidence_dir.is_absolute()
            else ROOT / args.evidence_dir
        )

    selected_modes = [args.logo_reset_only, args.controller_only, args.chat_only]
    if sum(selected_modes) > 1:
        parser.error(
            "--logo-reset-only, --controller-only, and --chat-only are mutually exclusive"
        )
    if args.controller_only:
        return run_controller_only(args.apply)
    if args.chat_only:
        return run_chat_only(args.apply)

    before = snapshot()
    write_json(EVIDENCE_DIR / "before-snapshot.json", before)

    current_html = before["edit"]["blockHtml"]
    next_html = update_block_html(current_html)
    chat_content = CHAT_SRC.read_text(encoding="utf-8")
    tracker_content = TRACKER_SRC.read_text(encoding="utf-8")
    context_compiler_content = CONTEXT_COMPILER_SRC.read_text(encoding="utf-8")
    proactive_controller_content = PROACTIVE_CONTROLLER_SRC.read_text(encoding="utf-8")
    handoff_content = HANDOFF_TO_ORCHESTRATOR_SRC.read_text(encoding="utf-8")
    engage_content = ENGAGE_SRC.read_text(encoding="utf-8")
    theme_content = THEME_SRC.read_text(encoding="utf-8")
    plan = {
        "target": {
            "block": BLOCK_PATH,
            "chat": CHAT,
            "newTracker": NEW_TRACKER,
            "contextCompiler": CONTEXT_COMPILER,
            "proactiveController": PROACTIVE_CONTROLLER,
            "handoffToOrchestrator": HANDOFF_TO_ORCHESTRATOR,
            "oldTracker": OLD_TRACKER,
            "engage": ENGAGE,
            "theme": THEME,
        },
        "current": {
            "oldTrackerReferenced": "algolia-chat-tracker.js" in current_html,
            "chatReferenced": "algolia-chat.js" in current_html,
            "newTrackerReferenced": "algolia-engagement-tracker.js" in current_html,
            "contextCompilerReferenced": "algolia-context-compiler.js" in current_html,
            "proactiveControllerReferenced": "algolia-proactive-controller.js" in current_html,
            "handoffToOrchestratorReferenced": "handoff-to-orchestrator.js" in current_html,
            "themeReferenced": "algolia-chat-theme-algolia" in current_html,
            "releaseMarkers": re.findall(r'data-release="([^"]+)"', current_html),
            "chatExists": before["edit"]["chatNode"] is not None,
            "newTrackerExists": before["edit"]["newTrackerNode"] is not None,
            "contextCompilerExists": before["edit"]["contextCompilerNode"] is not None,
            "proactiveControllerExists": before["edit"]["proactiveControllerNode"] is not None,
            "handoffToOrchestratorExists": before["edit"]["handoffToOrchestratorNode"] is not None,
            "themeExists": before["edit"]["themeNode"] is not None,
        },
        "intended": {
            "oldTrackerReferenced": False,
            "chatReferenced": True,
            "newTrackerReferenced": True,
            "contextCompilerReferenced": True,
            "proactiveControllerReferenced": True,
            "handoffToOrchestratorReferenced": True,
            "themeReferenced": True,
            "chatVersion": CHAT_VERSION,
            "trackerVersion": TRACKER_VERSION,
            "contextCompilerVersion": CONTEXT_COMPILER_VERSION,
            "proactiveControllerVersion": PROACTIVE_CONTROLLER_VERSION,
            "handoffToOrchestratorVersion": HANDOFF_TO_ORCHESTRATOR_VERSION,
            "engageVersion": ENGAGE_VERSION,
            "themeVersion": THEME_VERSION,
            "chatSha256": sha256(chat_content),
            "trackerSha256": sha256(tracker_content),
            "contextCompilerSha256": sha256(context_compiler_content),
            "proactiveControllerSha256": sha256(proactive_controller_content),
            "handoffToOrchestratorSha256": sha256(handoff_content),
            "engageSha256": sha256(engage_content),
            "themeSha256": sha256(theme_content),
        },
        "rollback": {
            "restoreBlockHtmlFrom": str(EVIDENCE_DIR / "before-snapshot.json"),
            "restoreOldTrackerFrom": "before-snapshot.json edit.oldTrackerNode children[0].properties[jcr:data]",
            "restoreChatFrom": "before-snapshot.json edit.chatNode children[0].properties[jcr:data]",
            "restoreOrRemoveContextCompilerFrom": "before-snapshot.json edit.contextCompilerNode children[0].properties[jcr:data]",
            "restoreOrRemoveProactiveControllerFrom": "before-snapshot.json edit.proactiveControllerNode children[0].properties[jcr:data]",
            "restoreOrRemoveHandoffToOrchestratorFrom": "before-snapshot.json edit.handoffToOrchestratorNode children[0].properties[jcr:data]",
            "restoreEngageFrom": "before-snapshot.json edit.engageNode children[0].properties[jcr:data]",
            "restoreThemeFrom": "before-snapshot.json edit.themeNode children[0].properties[jcr:data]",
        },
    }
    write_json(EVIDENCE_DIR / "deployment-plan.json", plan)

    if not args.apply:
        print(json.dumps(plan, indent=2))
        return 0

    if args.logo_reset_only:
        mutations = {
            "upsertNewTracker": upsert_file(NEW_TRACKER, tracker_content),
            "setBlockHtml": set_block_html(next_html),
            "publishNewTracker": publish(NEW_TRACKER, subtree=True),
            "versionBlock": graphql("""
              mutation VersionBlock {
                jcr(workspace: EDIT) {
                  block: mutateNode(pathOrId: "/sites/www/home/drift/custom-code-block") {
                    createVersion
                    node { path }
                  }
                }
              }
            """),
            "publishBlock": publish(BLOCK_PATH, subtree=True),
        }
        write_json(EVIDENCE_DIR / "mutation-results.json", mutations)
        after = snapshot()
        checks = validate_logo_reset(after, tracker_content)
        for _ in range(8):
            if checks["pass"]:
                break
            time.sleep(2)
            after = snapshot()
            checks = validate_logo_reset(after, tracker_content)
        write_json(EVIDENCE_DIR / "after-readback.json", after)
        write_json(EVIDENCE_DIR / "deployment-validation.json", checks)
        print(json.dumps(checks, indent=2))
        return 0 if checks["pass"] else 1

    mutations = {
        "upsertChat": upsert_file(CHAT, chat_content),
        "upsertNewTracker": upsert_file(NEW_TRACKER, tracker_content),
        "upsertContextCompiler": upsert_file(CONTEXT_COMPILER, context_compiler_content),
        "upsertProactiveController": upsert_file(PROACTIVE_CONTROLLER, proactive_controller_content),
        "upsertHandoffToOrchestrator": upsert_file(HANDOFF_TO_ORCHESTRATOR, handoff_content),
        "upsertEngage": upsert_file(ENGAGE, engage_content),
        "upsertTheme": upsert_file(THEME, theme_content),
        "setBlockHtml": set_block_html(next_html),
        "deleteOldTrackerEdit": delete_old_tracker(),
        "publishChat": publish(CHAT),
        "publishNewTracker": publish(NEW_TRACKER),
        "publishContextCompiler": publish(CONTEXT_COMPILER),
        "publishProactiveController": publish(PROACTIVE_CONTROLLER),
        "publishHandoffToOrchestrator": publish(HANDOFF_TO_ORCHESTRATOR),
        "publishEngage": publish(ENGAGE),
        "publishTheme": publish(THEME),
        "publishFilesSubtree": publish(FILES_PATH, subtree=True),
        "publishDriftSubtree": publish("/sites/www/home/drift", subtree=True),
        "versionBlock": graphql("""
          mutation VersionBlock {
            jcr(workspace: EDIT) {
              block: mutateNode(pathOrId: "/sites/www/home/drift/custom-code-block") {
                createVersion
                node { path }
              }
            }
          }
        """),
        "publishBlock": publish(BLOCK_PATH, subtree=True),
    }
    write_json(EVIDENCE_DIR / "mutation-results.json", mutations)
    after = snapshot()
    checks = validate(after)
    if not checks["pass"] and edit_has_expected_html(after):
        mutations["republishDriftSubtreeAfterStaleLiveReadback"] = publish(
            "/sites/www/home/drift", subtree=True
        )
        mutations["republishBlockAfterStaleLiveReadback"] = publish(BLOCK_PATH, subtree=True)
        after = snapshot()
        checks = validate(after)
    after, checks = wait_for_live_validation(after, checks)
    write_json(EVIDENCE_DIR / "mutation-results.json", mutations)
    write_json(EVIDENCE_DIR / "after-readback.json", after)
    write_json(EVIDENCE_DIR / "deployment-validation.json", checks)
    print(json.dumps(checks, indent=2))
    return 0 if checks["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
