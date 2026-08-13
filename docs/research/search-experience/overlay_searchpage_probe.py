#!/usr/bin/env python3
"""WU-06 — does the overlay lead anywhere, and what is /search?

Two questions the teardown needs answered on the surface, not by inference:
  1. does the open overlay contain any link to the full /search page?
  2. is /search a working results page, and does it accept a query from the URL?
Read-only. Headless.
"""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

JS_HITS = """() => [...document.querySelectorAll('.agentic-search-hit')].map(h => ({
  href: h.getAttribute('href'),
  title: (h.querySelector('.agentic-search-hit__title')||{}).textContent?.trim() || null,
}))"""

out = {}

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(user_agent=UA, viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()

    # --- Q1: open the overlay, hunt for a link to a full results page
    page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    page.click("#globalSearchButton")
    page.wait_for_timeout(1500)
    inp = page.query_selector(".agentic-search-shell input")
    inp.click(); inp.type("pricing", delay=90)
    page.wait_for_timeout(1200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(3000)

    out["overlay_links_to_search_page"] = page.evaluate(
        """() => [...document.querySelectorAll('.agentic-search-shell a, .agentic-search-shell button')]
              .map(e => ({tag: e.tagName, text: (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60),
                          href: e.getAttribute('href')}))
              .filter(e => e.href && e.href.includes('/search'))"""
    )
    # click Show more twice and watch the URL
    urls = [page.url]
    for _ in range(2):
        m = page.query_selector("button:has-text('Show more results')")
        if not (m and m.is_visible()):
            break
        m.click(); page.wait_for_timeout(2500)
        urls.append(page.url)
    out["url_after_show_more_clicks"] = urls
    out["hits_after_two_more_clicks"] = len(page.evaluate(JS_HITS))

    # --- Q2: what is /search, and does it take a query from the URL?
    page.goto("https://www.algolia.com/search?query=pricing", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(5000)
    page.screenshot(path=str(SHOTS / "search-page-query-pricing.png"), full_page=False)
    out["search_page"] = {
        "final_url": page.url,
        "title": page.title(),
        "hits": page.evaluate(JS_HITS)[:10],
        "input_value": page.evaluate(
            "() => { const i = document.querySelector('input[type=text],input[type=search]'); return i ? i.value : null; }"),
        "visible_text_head": page.evaluate(
            "() => document.body.innerText.replace(/\\s+/g,' ').trim().slice(0, 600)"),
    }

    # --- Q3: does the Assist chat survive a reload? (observed in the zero-result capture)
    page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    page.click("#globalSearchButton")
    page.wait_for_timeout(2000)
    out["chat_history_present_on_fresh_load"] = page.evaluate(
        """() => {
            const shell = document.querySelector('.agentic-search-shell');
            const t = shell ? shell.innerText : '';
            return {has_assist_transcript: /Algolia Assist/.test(t) && /New chat/.test(t),
                    storage_keys: Object.keys(window.localStorage).concat(Object.keys(window.sessionStorage))};
        }"""
    )
    b.close()

(ROOT / "overlay-searchpage.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2)[:3000])
