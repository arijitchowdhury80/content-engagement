#!/usr/bin/env python3
"""WU-06 step 1 — recon the live algolia.com search overlay.

Read-only. Loads the homepage headless, finds the search trigger, opens the
overlay, and dumps the DOM structure + any Algolia API traffic so the teardown
can be written from observed evidence rather than guesses.
"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

api_calls = []


def record(request):
    url = request.url
    if re.search(r"algolia(net)?\.(com|net)/1/indexes|/1/indexes/|insights\.algolia", url):
        entry = {"method": request.method, "url": url}
        try:
            entry["post"] = request.post_data
        except Exception:
            entry["post"] = None
        api_calls.append(entry)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("request", record)

        page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(SHOTS / "recon-00-homepage.png"))

        # What could open the overlay?
        candidates = page.evaluate(
            """() => {
                const out = [];
                const sel = [
                  'input[type=search]', 'input[name*=search i]', 'input[placeholder*=search i]',
                  '[role=search]', 'button', 'a[href*="search" i]', '[class*="search" i]',
                  '[id*="search" i]', '[data-testid*="search" i]', '[aria-label*="search" i]'
                ];
                const seen = new Set();
                for (const s of sel) {
                  for (const el of document.querySelectorAll(s)) {
                    const key = el.tagName + '|' + (el.className||'') + '|' + (el.getAttribute('aria-label')||'') + '|' + (el.textContent||'').trim().slice(0,40);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const r = el.getBoundingClientRect();
                    out.push({
                      matched: s,
                      tag: el.tagName,
                      cls: (typeof el.className === 'string' ? el.className : '').slice(0,160),
                      id: el.id || null,
                      aria: el.getAttribute('aria-label'),
                      testid: el.getAttribute('data-testid'),
                      text: (el.textContent||'').trim().slice(0,60),
                      visible: r.width > 0 && r.height > 0,
                      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
                    });
                  }
                }
                return out;
            }"""
        )
        visible = [c for c in candidates if c["visible"]]

        # Overlay markers named in the brief — are any already in the DOM pre-open?
        markers = page.evaluate(
            """() => {
                const want = ['AI mode','Suggestions','Products & Resources','Algolia Assist',
                              'New chat','Back to results','Clear All Filters'];
                const html = document.documentElement.innerHTML;
                const out = {};
                for (const w of want) out[w] = html.includes(w);
                return out;
            }"""
        )

        report = {
            "url": page.url,
            "title": page.title(),
            "visible_search_candidates": visible[:60],
            "total_candidates": len(candidates),
            "overlay_strings_in_dom_preopen": markers,
            "algolia_api_calls_on_load": api_calls,
        }
        (ROOT / "overlay-recon.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({
            "title": report["title"],
            "visible_candidates": len(visible),
            "markers": markers,
            "api_calls_on_load": len(api_calls),
        }, indent=2))
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
