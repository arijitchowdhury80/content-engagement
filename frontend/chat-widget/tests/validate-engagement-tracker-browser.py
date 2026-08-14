from __future__ import annotations

import json
import re
import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_server(port: int) -> ThreadingHTTPServer:
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, format, *args):  # noqa: A002
            return

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def read_storage(page):
    return page.evaluate(
        """() => ({
          profile: JSON.parse(localStorage.getItem('algolia_profile')),
          localSession: localStorage.getItem('algolia_session'),
          localEvents: localStorage.getItem('algolia_events'),
          session: JSON.parse(sessionStorage.getItem('algolia_session')),
          eventsEnvelope: JSON.parse(sessionStorage.getItem('algolia_events')),
          serializedStorage: JSON.stringify({
            localStorage: {...localStorage},
            sessionStorage: {...sessionStorage}
          })
        })"""
    )


def assert_event(events, name: str):
    matches = [event for event in events if event["name"] == name]
    assert matches, f"missing event: {name}"
    return matches


def main() -> None:
    port = free_port()
    server = start_server(port)
    base = f"http://127.0.0.1:{port}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 720})

            page.goto(f"{base}/tests/fixtures/engagement-tracker-referrer.html")
            page.click("#to-tracker")
            page.wait_for_load_state("networkidle")

            page.click("#persona-developer")
            page.click("#nav-products")
            page.click("#subnav-fashion")
            page.fill("#site-search", "api calls pricing person@example.com")
            page.press("#site-search", "Enter")
            page.click("#search-result")
            page.click("#demo-cta")
            page.click("#manual-engagement")

            page.focus("#work-email")
            page.click("#submit-form")
            page.fill("#work-email", "person@example.com")
            page.click("#submit-form")
            page.evaluate(
                """() => document.dispatchEvent(new CustomEvent('algolia-chat:lead', {
                  detail: { email: 'person@example.com', name: 'Jane Buyer', company: 'SecretCo' },
                  bubbles: true
                }))"""
            )
            page.evaluate(
                """() => document.dispatchEvent(new CustomEvent('algolia-chat-open-change', {
                  detail: { open: true },
                  bubbles: true
                }))"""
            )
            page.evaluate(
                """() => document.dispatchEvent(new CustomEvent('algolia-chat-question', {
                  detail: { question: 'Do not store this raw question', source: 'visitor' },
                  bubbles: true
                }))"""
            )

            page.evaluate(
                "window.scrollTo(0, document.body.scrollHeight * 0.55); window.dispatchEvent(new Event('scroll'))"
            )
            page.wait_for_timeout(100)
            page.evaluate(
                "window.scrollTo(0, document.body.scrollHeight * 0.80); window.dispatchEvent(new Event('scroll'))"
            )
            page.wait_for_timeout(100)
            page.evaluate(
                "window.scrollTo(0, document.body.scrollHeight); window.dispatchEvent(new Event('scroll'))"
            )
            page.wait_for_timeout(10300)

            scroll_geometry = page.evaluate(
                """() => ({
                  scrollY: window.scrollY,
                  innerHeight: window.innerHeight,
                  bodyHeight: document.body.scrollHeight,
                  docHeight: document.documentElement.scrollHeight
                })"""
            )
            data = read_storage(page)
            data["scrollGeometry"] = scroll_geometry
            browser.close()
    finally:
        server.shutdown()

    profile = data["profile"]
    session = data["session"]
    events = data["eventsEnvelope"]["events"]
    names = [event["name"] for event in events]

    assert profile["schema"] == "AlgoliaEngagementProfile.v1"
    assert profile["persona"]["value"] == "developer"
    assert data["localSession"] is None
    assert data["localEvents"] is None

    assert session["schema"] == "AlgoliaEngagementSession.v1"
    assert session["pages"], "expected at least one session page"
    assert session["engagementHistory"], "expected concierge engagement history"
    page_depths = [page.get("maxScrollDepth", 0) for page in session["pages"]]
    assert max(page_depths) == 100, (
        f"expected a 100% page depth, got {page_depths}; "
        f"geometry={data['scrollGeometry']}; events={names}"
    )

    page_views = assert_event(events, "page_view")
    assert page_views[0]["props"]["url"].endswith("/tests/fixtures/engagement-tracker-browser.html")
    assert page_views[0]["props"]["referrer"].endswith(
        "/tests/fixtures/engagement-tracker-referrer.html"
    )
    assert page_views[0]["props"]["utm"] == {"utm_source": "browser_test"}

    assert_event(events, "persona_select")
    assert_event(events, "nav_click")
    assert_event(events, "cta_click")
    assert_event(events, "site_search")
    assert_event(events, "search_result_click")
    assert_event(events, "form_view")
    assert_event(events, "form_start")
    assert_event(events, "form_error")
    assert_event(events, "form_success")
    assert_event(events, "chat_open")
    assert_event(events, "chat_question")
    assert_event(events, "engagement_exposed")

    scroll_depths = {event["props"]["depth"] for event in assert_event(events, "scroll_depth")}
    assert {50, 75, 100}.issubset(scroll_depths)

    dwell_seconds = {
        event["props"]["dwellSeconds"] for event in assert_event(events, "page_dwell")
    }
    assert {5, 10}.issubset(dwell_seconds)

    serialized = data["serializedStorage"]
    forbidden = [
        "person@example.com",
        "leak@example.com",
        "Jane Buyer",
        "SecretCo",
        "Do not store this raw question",
    ]
    for value in forbidden:
        assert value not in serialized, f"sensitive value leaked to storage: {value}"

    summary = {
        "profileSchema": profile["schema"],
        "persona": profile["persona"],
        "sessionPageCount": len(session["pages"]),
        "engagementHistoryCount": len(session["engagementHistory"]),
        "eventCount": len(events),
        "events": names,
        "scrollDepths": sorted(scroll_depths),
        "dwellSeconds": sorted(dwell_seconds),
        "localStorageKeys": ["algolia_profile"],
        "sessionStorageKeys": ["algolia_session", "algolia_events"],
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
