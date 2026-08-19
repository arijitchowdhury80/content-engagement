#!/usr/bin/env python3
"""Headless browser validation for the Jahia engagement tracker deployment."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/evidence/visitor-intelligence/jahia-deploy-20260814/live-browser-validation.json"
URL = (
    "https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html"
    "?engagementTracker=20260814&algoliaChatDebug=1&algoliaEngagementDebug=1"
)
TRACKER_SCRIPT = "algolia-engagement-tracker.js"
ENGAGE_SCRIPT = "algolia-chat-engage.js"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        console_messages = []
        page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text[:500]}))
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("window.algoliaEngagementTracker && window.__algoliaEngagementTrackerInstalled", timeout=30000)
        page.evaluate(
            """
            () => {
              const chat = document.querySelector('algolia-chat');
              window.__algoliaAnalyzingCalls = [];
              if (chat && typeof chat.setAnalyzing === 'function' && !chat.__pulseValidationWrapped) {
                const original = chat.setAnalyzing.bind(chat);
                chat.setAnalyzing = (value) => {
                  window.__algoliaAnalyzingCalls.push({ value: Boolean(value), ts: Date.now() });
                  return original(value);
                };
                chat.__pulseValidationWrapped = true;
              }
            }
            """
        )
        page.evaluate(
            """
            () => {
              window.algoliaEngagementTracker.setPersona('developer', 'demo_selector');
              window.algoliaEngagementTracker.track('site_search', {
                query: 'instantsearch implementation',
                source: 'live_validation'
              });
              window.algoliaEngagementTracker.recordEngagement({
                messageGoal: 'live_validation',
                status: 'shown_no_action'
              });
              document.dispatchEvent(new CustomEvent('algolia-chat-open-change', {
                detail: { open: true }
              }));
              document.dispatchEvent(new CustomEvent('algolia-chat-question', {
                detail: { source: 'live_validation' }
              }));
              window.algoliaEngagementTracker.track('nav_click', {
                label: 'Pulse validation',
                source: 'live_validation'
              });
              window.scrollTo(0, Math.max(0, document.body.scrollHeight));
            }
            """
        )
        page.wait_for_function(
            "window.__algoliaAnalyzingCalls && window.__algoliaAnalyzingCalls.some((entry) => entry.value === true)",
            timeout=10000,
        )
        page.wait_for_timeout(11000)
        state = page.evaluate(
            """
            () => {
              const read = (store, key) => {
                try {
                  const raw = store.getItem(key);
                  return raw ? JSON.parse(raw) : null;
                } catch (error) {
                  return { parseError: String(error) };
                }
              };
              const scripts = [...document.scripts].map((script) => script.src).filter(Boolean);
              const profile = read(localStorage, 'algolia_profile');
              const session = read(sessionStorage, 'algolia_session');
              const eventsEnvelope = read(sessionStorage, 'algolia_events');
              const events = Array.isArray(eventsEnvelope?.events) ? eventsEnvelope.events : [];
              return {
                href: location.href,
                releaseMarkers: [...document.querySelectorAll('[data-release]')].map((el) => el.getAttribute('data-release')),
                scripts,
                installed: Boolean(window.__algoliaEngagementTrackerInstalled),
                oldTrackerInstalled: Boolean(window.__algoliaChat_trackerInstalled),
                apiPresent: Boolean(window.algoliaEngagementTracker && window.algoliaTracker),
                localStorageKeys: Object.keys(localStorage).filter((key) => key.startsWith('algolia') || key.startsWith('acs')),
                sessionStorageKeys: Object.keys(sessionStorage).filter((key) => key.startsWith('algolia') || key.startsWith('acs')),
                profile,
                session,
                eventNames: events.map((event) => event.name),
                eventCount: events.length,
                analyzingCalls: window.__algoliaAnalyzingCalls || [],
                engagementHistoryCount: Array.isArray(session?.engagementHistory) ? session.engagementHistory.length : 0,
                pageCount: Array.isArray(session?.pages) ? session.pages.length : 0
              };
            }
            """
        )
        browser.close()

    checks = {
        # Cache-busting tokens change on every release. The deployment contract is
        # the canonical script path; the captured script URL preserves the token.
        "newTrackerScriptLoaded": any(TRACKER_SCRIPT in src for src in state["scripts"]),
        "engageScriptLoaded": any(ENGAGE_SCRIPT in src for src in state["scripts"]),
        "oldTrackerScriptAbsent": not any("algolia-chat-tracker.js" in src for src in state["scripts"]),
        "trackerInstalled": state["installed"] is True,
        "oldTrackerNotInstalled": state["oldTrackerInstalled"] is False,
        "profileInLocalStorage": "algolia_profile" in state["localStorageKeys"],
        "sessionInSessionStorage": "algolia_session" in state["sessionStorageKeys"],
        "eventsInSessionStorage": "algolia_events" in state["sessionStorageKeys"],
        "noAcsKeys": not any(key.startswith("acs") for key in state["localStorageKeys"] + state["sessionStorageKeys"]),
        "capturedPageView": "page_view" in state["eventNames"],
        "capturedSiteSearch": "site_search" in state["eventNames"],
        "capturedChatOpen": "chat_open" in state["eventNames"],
        "capturedChatQuestion": "chat_question" in state["eventNames"],
        "capturedDwell": "page_dwell" in state["eventNames"],
        "capturedEngagementHistory": state["engagementHistoryCount"] >= 1,
        "capturedAnalyzingPulse": any(call.get("value") is True for call in state.get("analyzingCalls", [])),
    }
    checks["pass"] = all(checks.values())
    payload = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "url": URL,
        "checks": checks,
        "state": state,
        "console": console_messages[-50:],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(checks, indent=2))
    return 0 if checks["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
