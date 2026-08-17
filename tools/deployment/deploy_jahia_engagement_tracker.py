#!/usr/bin/env python3
"""Deploy the visitor intelligence assets to the Jahia dev surface.

This is intentionally narrow: it updates only the visitor-intelligence assets
and the Drift custom-code block script references.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path.home() / ".codex" / "config.toml"
ENDPOINT = "https://tmp-content-eng-algolia.cloud.jahia.com/modules/graphql"
BLOCK_PATH = "/sites/www/home/drift/custom-code-block"
FILES_PATH = "/sites/www/files"
OLD_TRACKER = "/sites/www/files/algolia-chat-tracker.js"
CHAT = "/sites/www/files/algolia-chat.js"
NEW_TRACKER = "/sites/www/files/algolia-engagement-tracker.js"
CONTEXT_COMPILER = "/sites/www/files/algolia-context-compiler.js"
PROACTIVE_CONTROLLER = "/sites/www/files/algolia-proactive-controller.js"
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
CHAT_VERSION = "20260815-answer-rhythm-balanced-a"
TRACKER_VERSION = "20260817-visitor-reset-c"
CONTEXT_COMPILER_VERSION = "20260815b"
PROACTIVE_CONTROLLER_VERSION = "20260815g"
HANDOFF_TO_ORCHESTRATOR_VERSION = "20260814b"
ENGAGE_VERSION = "20260814d"
THEME_VERSION = "20260815-answer-rhythm-balanced-a"


def load_token() -> str:
    text = CONFIG.read_text(encoding="utf-8")
    match = re.search(
        r"\[mcp_servers\.jahia\][\s\S]*?authorization = \"([^\"]+)\"", text
    )
    if not match:
        raise RuntimeError("Jahia authorization header not found in Codex config")
    return match.group(1)


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


def main() -> int:
    global EVIDENCE_DIR
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--logo-reset-only",
        action="store_true",
        help="Deploy only the engagement tracker and logo-reset markup.",
    )
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()
    if args.evidence_dir:
        EVIDENCE_DIR = (
            args.evidence_dir
            if args.evidence_dir.is_absolute()
            else ROOT / args.evidence_dir
        )

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
