#!/usr/bin/env python3
"""Probe live Jahia visitor-signal behavior for Workstream 1.1.1.

Read-only against Jahia/Agent Studio. The script only drives a browser session,
uses local/session storage in that browser context, and writes a local evidence
JSON artifact.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright


DEFAULT_URL = (
    "https://tmp-content-eng-algolia.cloud.jahia.com/cms/render/live/en/sites/www/home.html"
    "?widgetFinal=20260812&algoliaChatDebug=1&signalProbe=20260813"
)


def dump_json(data: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument(
        "--out",
        default="docs/evidence/visitor-intelligence/2026-08-13-1.1.1-live-signal-probe.json",
    )
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()

    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    console_messages: list[dict[str, str]] = []
    page_errors: list[str] = []
    network: list[dict[str, Any]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        page.on(
            "console",
            lambda msg: console_messages.append(
                {"type": msg.type, "text": msg.text[:1000]}
            ),
        )
        page.on("pageerror", lambda err: page_errors.append(str(err)[:2000]))
        page.on(
            "response",
            lambda resp: network.append(
                {
                    "url": resp.url,
                    "status": resp.status,
                    "contentType": resp.headers.get("content-type", ""),
                }
            )
            if any(token in resp.url for token in ("algolia-chat", "agent-studio", "jahia"))
            else None,
        )

        page.goto(args.url, wait_until="domcontentloaded", timeout=60_000)
        page.evaluate(
            """
            () => {
              localStorage.removeItem('acs_profile');
              localStorage.removeItem('acs_events');
              localStorage.removeItem('acs_session');
              localStorage.removeItem('acs_pending_greeting');
              sessionStorage.removeItem('acs_token');
            }
            """
        )
        page.reload(wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(2500)

        before = page.evaluate(
            """
            () => {
              const tracker = window.algoliaTracker || {};
              const chat = document.querySelector('algolia-chat');
              const engage = document.querySelector('algolia-chat-engage');
              const storage = {};
              for (const key of ['acs_profile', 'acs_events', 'acs_session', 'acs_pending_greeting']) {
                try { storage[key] = JSON.parse(localStorage.getItem(key) || 'null'); }
                catch { storage[key] = localStorage.getItem(key); }
              }
              const scripts = [...document.scripts]
                .map((s) => s.src || '')
                .filter((src) => src.includes('algolia') || src.includes('jahia'));
              return {
                href: location.href,
                title: document.title,
                trackerInstalled: Boolean(window.__algoliaChat_trackerInstalled),
                engageInstalled: Boolean(window.__algoliaChat_engageInstalled),
                trackerMethods: Object.keys(tracker).sort(),
                hasTrackSearch: typeof tracker.trackSearch === 'function',
                hasTrackEvent: typeof tracker.trackEvent === 'function',
                visitorConfig: window.ALGOLIA_VISITOR_CONFIG || null,
                contextEngineConfig: window.ALGOLIA_CONTEXT_ENGINE_CONFIG || null,
                consentGlobals: {
                  globalPrivacyControl: navigator.globalPrivacyControl === true,
                  OnetrustActiveGroups: window.OnetrustActiveGroups || null,
                  OptanonActiveGroups: window.OptanonActiveGroups || null,
                  hasOneTrust: typeof window.OneTrust === 'object',
                  hasAlgoliaCookieUtils: typeof window.AlgoliaCookieUtils === 'object',
                  hasAlgoliaCookieUtilsConsent:
                    typeof window.AlgoliaCookieUtils?.hasConsent === 'function'
                },
                chatAttributes: chat ? Object.fromEntries([...chat.attributes].map((a) => [a.name, a.value])) : null,
                engageAttributes: engage ? Object.fromEntries([...engage.attributes].map((a) => [a.name, a.value])) : null,
                scripts,
                storage,
                snapshot: typeof tracker.snapshot === 'function' ? tracker.snapshot() : null
              };
            }
            """
        )

        page.evaluate(
            """
            () => {
              window.algoliaTracker?.trackEvent?.('probe_custom_event', {
                source: 'workstream-1.1.1',
                harmless: true,
                email: 'must-not-be-stored@example.com',
                phone: '555-0100',
                password: 'must-not-be-stored'
              });
              window.algoliaTracker?.trackSearch?.('instantsearch implementation', {
                source: 'workstream-1.1.1',
                email: 'must-not-be-stored@example.com'
              });
              document.dispatchEvent(new CustomEvent('algolia:search', {
                detail: {
                  query: 'dynamic re-ranking',
                  source: 'probe-dispatch',
                  email: 'must-not-be-stored@example.com'
                }
              }));
              const cta = document.createElement('button');
              cta.textContent = 'Request demo probe';
              cta.setAttribute('data-cta', 'request-demo-probe');
              document.body.appendChild(cta);
              cta.click();
              const nav = document.createElement('a');
              nav.href = '#probe-navigation';
              nav.textContent = 'Docs probe navigation';
              document.body.appendChild(nav);
              nav.click();
              window.scrollTo(0, document.body.scrollHeight);
            }
            """
        )
        page.wait_for_timeout(1200)

        after = page.evaluate(
            """
            () => {
              const storage = {};
              for (const key of ['acs_profile', 'acs_events', 'acs_session', 'acs_pending_greeting']) {
                try { storage[key] = JSON.parse(localStorage.getItem(key) || 'null'); }
                catch { storage[key] = localStorage.getItem(key); }
              }
              return {
                href: location.href,
                storage,
                snapshot: typeof window.algoliaTracker?.snapshot === 'function'
                  ? window.algoliaTracker.snapshot()
                  : null
              };
            }
            """
        )

        browser.close()

    artifact = {
        "started_at": started_at,
        "url": args.url,
        "before": before,
        "after": after,
        "console": console_messages[-80:],
        "page_errors": page_errors,
        "network": network[-80:],
    }
    dump_json(artifact, Path(args.out))
    print(args.out)
    print(
        json.dumps(
            {
                "trackerInstalled": before.get("trackerInstalled"),
                "trackerMethods": before.get("trackerMethods"),
                "hasTrackSearch": before.get("hasTrackSearch"),
                "eventNamesAfter": [
                    event.get("name")
                    for event in (after.get("storage", {}).get("acs_events") or [])
                ],
                "hasConsentConfig": bool(
                    (before.get("visitorConfig") or {}).get("consentGroup")
                ),
                "pageErrors": len(page_errors),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
