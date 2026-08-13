#!/usr/bin/env python3
"""WU-06 — score the 8 non-negotiable journeys against the CURRENT algolia.com overlay.

Rubric agreed with Arijit 2026-08-07 (docs/briefs/WU-06.md § journey scoring rubric):
    PASS    canonical destination is result #1
    PARTIAL canonical destination is in the top 5
    FAIL    anything else, including not in the index at all

The overlay renders 3 hits by default, so reaching rank 4-5 needs one
"Show more results" click. We click once and read ranks 1..6, then score on
rank <= 5. The click cost is recorded separately.

Read-only. Headless. Writes 20-research/overlay-journeys.json + screenshots.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# journey, query (the nav label — the concept claims search replaces the nav),
# accepted canonical destinations.
#
# Destinations are matched by EXACT path, never by substring. The first version of
# this file used `dest in href`, which scored Pricing as PASS because rank 1 was
# /doc/integration/salesforce-commerce-cloud-b2c/guides/pricing-and-promotions. The
# real /pricing page was rank 2. Substring matching fails in the flattering direction,
# so it does not announce itself.
#
# Every path below was confirmed HTTP 200 on 2026-08-07. Do not add one without
# checking it: /customer-stories was in the original list and is a 404, which would
# have produced a FAIL that meant nothing.
JOURNEYS = [
    ("Products",          "products",         ["/products"]),
    ("Solutions",         "solutions",        ["/solutions", "/search-solutions"]),
    ("Pricing",           "pricing",          ["/pricing"]),
    ("Developers/Docs",   "developers",       ["/developers", "/doc"]),
    ("Resources",         "resources",        ["/resources"]),
    ("Customer Stories",  "customer stories", ["/customers"]),
    ("Contact Sales",     "contact sales",    ["/demorequest", "/contactus"]),
    ("Login",             "login",            ["dashboard.algolia.com"]),
]

JS_HITS = """() => [...document.querySelectorAll('.agentic-search-hit')].map(h => ({
  href: h.getAttribute('href'),
  title: (h.querySelector('.agentic-search-hit__title')||{}).textContent?.trim() || null,
  meta: (h.querySelector('.agentic-search-hit__meta')||{}).textContent?.replace(/\\s+/g,' ').trim() || null,
}))"""

JS_STATS = """() => {
  const s = document.querySelector('.ais-Stats, .agentic-search-stats');
  return s ? s.textContent.replace(/\\s+/g,' ').trim() : null;
}"""


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def reaches(href, accepted):
    """Exact-path match. A deeper page that merely contains the segment is NOT the
    destination — see the note on JOURNEYS."""
    if href.startswith("http"):
        parsed = urlparse(href)
        host, path = parsed.netloc, parsed.path.rstrip("/") or "/"
    else:
        host, path = "", href.rstrip("/") or "/"
    for a in accepted:
        if a.startswith("dashboard"):
            if a in host:
                return True
        elif path == a:
            return True
    return False


def score(hits, accepted):
    """Return (verdict, rank_or_None). rank is 1-indexed."""
    for i, h in enumerate(hits, start=1):
        if reaches(h.get("href") or "", accepted):
            if i == 1:
                return "PASS", i
            if i <= 5:
                return "PARTIAL", i
            return "FAIL", i
    return "FAIL", None


def probe(page, journey, query, accepted):
    page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    page.click("#globalSearchButton")
    page.wait_for_timeout(2000)

    inp = page.query_selector(".agentic-search-shell input")
    if not inp:
        return {"journey": journey, "query": query, "error": "search input not found"}
    inp.click()
    inp.type(query, delay=90)
    page.wait_for_timeout(1200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(3000)

    default_hits = page.evaluate(JS_HITS)
    stats = page.evaluate(JS_STATS)
    page.screenshot(path=str(SHOTS / f"journey-{slug(journey)}-default.png"))

    # one "Show more results" click to expose ranks 4-6
    clicks = 0
    more = page.query_selector("button:has-text('Show more results'), .agentic-search-show-more")
    if more and more.is_visible():
        more.click()
        clicks = 1
        page.wait_for_timeout(2500)
    expanded = page.evaluate(JS_HITS)

    verdict, rank = score(expanded, accepted)
    row = {
        "journey": journey,
        "query": query,
        "accepted_destinations": accepted,
        "stats": stats,
        "hits_visible_by_default": len(default_hits),
        "show_more_clicks": clicks,
        "ranked": [{"rank": i, "href": h["href"], "title": h["title"], "meta": h["meta"]}
                   for i, h in enumerate(expanded, start=1)],
        "verdict": verdict,
        "rank_of_destination": rank,
    }
    print(f"{verdict:8} rank={rank} | {journey:18} q={query!r:20} {stats}")
    return row


def main():
    rows = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 1000})
            page = ctx.new_page()
            for journey, query, accepted in JOURNEYS:
                try:
                    rows.append(probe(page, journey, query, accepted))
                except Exception as e:  # one bad journey must not lose the rest
                    rows.append({"journey": journey, "query": query, "error": str(e)[:300]})
                    print(f"ERROR    | {journey}: {e}")
                (ROOT / "overlay-journeys.json").write_text(json.dumps(rows, indent=2))
            browser.close()
    finally:
        (ROOT / "overlay-journeys.json").write_text(json.dumps(rows, indent=2))
        ok = [r for r in rows if "verdict" in r]
        tally = {v: sum(1 for r in ok if r["verdict"] == v) for v in ("PASS", "PARTIAL", "FAIL")}
        print(f"\nscored {len(ok)}/8 — {tally}")


if __name__ == "__main__":
    sys.exit(main())
