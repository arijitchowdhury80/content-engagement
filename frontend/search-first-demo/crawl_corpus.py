#!/usr/bin/env python3
"""
WU-02 — Crawl algolia.com into a corpus.

Reads a newline-delimited URL list, fetches each page JS-rendered via crawl4ai,
and writes one JSON record per page to corpus/records.jsonl.

Per-record fields required by the WU-02 definition of done:
    url, title, page_type, body, breadcrumb, cta

Field notes, so the DoD is auditable rather than assumed:
  * breadcrumb is DERIVED FROM THE URL PATH. algolia.com ships no breadcrumb
    markup on any page (verified 2026-08-05: zero `breadcrumb` / `BreadcrumbList`
    occurrences, no <nav> and no <main> landmark anywhere in the DOM). Every
    record carries breadcrumb_source="derived-from-path" so no downstream unit
    mistakes this for scraped data.
  * page_type is derived from the URL path plus a small signal table. Also
    labelled, same reason.
  * body has the site chrome stripped. algolia.com renders its search overlay
    into the DOM of every page, so the raw markdown of any page begins with the
    overlay's AI-mode prompts and suggestion chips. Everything before the first
    H1 is chrome and is dropped.
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from urllib.parse import urlparse

from crawl4ai import (
    AsyncWebCrawler,
    BrowserConfig,
    CacheMode,
    CrawlerRunConfig,
    MemoryAdaptiveDispatcher,
    RateLimiter,
)

# --- chrome that algolia.com renders into every page -------------------------

# The search overlay is present in the DOM site-wide. These are its stable
# strings; they are used to confirm we are cutting overlay text and not real
# page copy.
OVERLAY_MARKERS = (
    "AI mode",
    "Suggestions",
    "Products & Resources",
    "Algolia Assist",
    "Back to results",
    "Clear All Filters",
)

FOOTER_MARKERS = (
    "Brand guidelines",
    "Download logo pack",
)

# --- CTA detection -----------------------------------------------------------

# Ordered by conversion intent: the first match found in the body wins, so a
# "Get a demo" outranks a "Read the docs" on the same page.
CTA_PATTERNS = [
    "get a demo",
    "request a demo",
    "book a demo",
    "contact sales",
    "talk to an expert",
    "talk to sales",
    "get started",
    "start free",
    "start building",
    "try it free",
    "sign up",
    "create an account",
    "read the docs",
    "view documentation",
    "download",
    "watch now",
    "register now",
    "read more",
]

MD_LINK = re.compile(r"\[([^\]]{1,120})\]\(([^)]+)\)")


def classify_page_type(path: str) -> str:
    """Derive a page type from the URL path. Labelled as derived, not scraped."""
    p = path.strip("/")
    if not p:
        return "homepage"
    seg = p.split("/")
    head = seg[0]

    table = {
        "blog": "blog-post",
        "resources": "resource",
        "developers": "developer",
        "customers": "customer-story",
        "about": "company",
        "products": "product",
        "industries": "industry",
        "use-cases": "use-case",
        "search-solutions": "solution",
        "competitors": "competitor-comparison",
        "pricing": "pricing",
        "policies": "legal",
        "partner-program": "partner",
        "partners": "partner",
        "careers": "careers",
        "events": "event",
        "webinars": "webinar",
        "lp": "landing-page",
        "exclusive": "landing-page",
        "department": "landing-page",
        "thank-you": "utility",
        "welcome": "utility",
    }

    if head in table:
        # A section root is a hub, not an instance of the section's leaf type.
        if len(seg) == 1:
            hub = {
                "blog": "blog-hub",
                "resources": "resource-hub",
                "developers": "developer-hub",
                "customers": "customer-story-hub",
                "products": "product-hub",
                "pricing": "pricing",
            }
            return hub.get(head, table[head])
        if head == "about" and len(seg) > 1 and seg[1] == "news":
            return "press-release"
        if head == "developers" and len(seg) > 1 and seg[1] == "code-exchange":
            return "code-exchange"
        return table[head]

    if head in ("contact", "contactus", "demorequest", "test-algolia-get-a-demo"):
        return "contact-sales"
    if head in ("dev", "devcon", "devcon-retired"):
        return "developer"
    if head == "search":
        return "search"
    if head == "error-404":
        return "utility"
    return "other"


def derive_breadcrumb(path: str) -> list:
    """
    Build a breadcrumb from the URL path.

    algolia.com has no breadcrumb markup, so this is the only breadcrumb
    available. Recorded with breadcrumb_source="derived-from-path".
    """
    p = path.strip("/")
    crumbs = ["Home"]
    if not p:
        return crumbs
    for seg in p.split("/"):
        if not seg:
            continue
        label = seg.replace("-", " ").replace("_", " ").strip()
        crumbs.append(label.title() if len(label) < 60 else label[:60])
    return crumbs


def strip_chrome(markdown: str) -> tuple:
    """
    Remove site chrome from a page's markdown.

    Returns (body, chrome_removed_chars, overlay_detected).
    """
    if not markdown:
        return "", 0, False

    original_len = len(markdown)

    # Everything before the page's own H1 is nav + search overlay.
    h1 = re.search(r"^#\s+(?!#)", markdown, re.M)
    body = markdown[h1.start():] if h1 else markdown

    # Look for the overlay in the chrome we actually cut, not in the whole page.
    # Scanning the raw markdown reports a false 0 because the overlay strings sit
    # past the first few KB on most pages.
    chrome = markdown[: h1.start()] if h1 else ""
    overlay_detected = any(m in chrome for m in OVERLAY_MARKERS)

    # Trim the footer brand block if it survived.
    for marker in FOOTER_MARKERS:
        idx = body.rfind(marker)
        if idx > len(body) * 0.5:
            body = body[:idx]

    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body, original_len - len(body), overlay_detected


def clean_title(raw: str) -> str:
    """Drop inline markdown images and links that leak into H1 text."""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", raw)      # images
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)    # links -> their text
    t = re.sub(r"[*_`]", "", t)
    return re.sub(r"\s{2,}", " ", t).strip()


def extract_title(markdown: str, meta: dict) -> str:
    m = re.search(r"^#\s+(.+)$", markdown or "", re.M)
    if m:
        cleaned = clean_title(m.group(1))
        if cleaned:
            return cleaned
    for key in ("title", "og:title"):
        if meta.get(key):
            return str(meta[key]).strip()
    return ""


def extract_cta(body: str) -> dict:
    """Pick the highest-intent CTA link in the body."""
    links = MD_LINK.findall(body or "")
    lowered = [(t.strip().lower(), t.strip(), h.strip()) for t, h in links]
    for pat in CTA_PATTERNS:
        for low, text, href in lowered:
            if pat in low:
                return {"text": text, "href": href, "matched": pat}
    return {"text": "", "href": "", "matched": ""}


async def run(urls, out_path, concurrency, timeout_ms, resume):
    done = set()
    if resume and os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    done.add(json.loads(line)["url"])
                except Exception:
                    continue
        print(f"[resume] {len(done)} records already on disk", flush=True)

    todo = [u for u in urls if u not in done]
    print(f"[plan] {len(todo)} pages to fetch (of {len(urls)} total)", flush=True)
    if not todo:
        return

    browser = BrowserConfig(headless=True, verbose=False)
    cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=timeout_ms,
        excluded_tags=["script", "style", "noscript", "svg"],
        remove_overlay_elements=False,  # we strip chrome ourselves, deterministically
        # stream=True is load-bearing, not a tuning knob. With the default
        # stream=False, arun_many buffers all 2300+ pages in memory and returns
        # one list at the end, so nothing reaches disk until the whole crawl
        # finishes — a crash at page 2300 would write zero records and --resume
        # would have nothing to resume from.
        stream=True,
        verbose=False,
    )
    dispatcher = MemoryAdaptiveDispatcher(
        memory_threshold_percent=80.0,
        max_session_permit=concurrency,
        rate_limiter=RateLimiter(base_delay=(0.4, 1.2), max_delay=20.0, max_retries=2),
    )

    started = time.time()
    written = 0
    failed = 0
    overlay_hits = 0

    with open(out_path, "a", encoding="utf-8") as out:
        async with AsyncWebCrawler(config=browser) as crawler:
            stream = await crawler.arun_many(
                urls=todo, config=cfg, dispatcher=dispatcher
            )
            async for res in stream:
                url = getattr(res, "url", "")
                if not getattr(res, "success", False):
                    failed += 1
                    out.write(
                        json.dumps(
                            {
                                "url": url,
                                "fetch_ok": False,
                                "error": str(getattr(res, "error_message", ""))[:400],
                                "status_code": getattr(res, "status_code", None),
                            }
                        )
                        + "\n"
                    )
                    continue

                md = ""
                mdobj = getattr(res, "markdown", None)
                if mdobj is not None:
                    md = getattr(mdobj, "raw_markdown", None) or str(mdobj)
                meta = getattr(res, "metadata", None) or {}
                path = urlparse(url).path

                body, chrome_removed, overlay = strip_chrome(md)
                if overlay:
                    overlay_hits += 1

                rec = {
                    "url": url,
                    "fetch_ok": True,
                    "status_code": getattr(res, "status_code", None),
                    "title": extract_title(md, meta),
                    "meta_title": meta.get("title", ""),
                    "meta_description": meta.get("description", ""),
                    "page_type": classify_page_type(path),
                    "page_type_source": "derived-from-path",
                    "breadcrumb": derive_breadcrumb(path),
                    "breadcrumb_source": "derived-from-path",
                    "cta": extract_cta(body),
                    "body": body,
                    "body_chars": len(body),
                    "chrome_removed_chars": chrome_removed,
                    "search_overlay_present": overlay,
                }
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                out.flush()  # every record, so --resume is accurate after any crash
                written += 1

                if (written + failed) % 25 == 0:
                    el = time.time() - started
                    print(
                        f"[{written + failed}/{len(todo)}] ok={written} fail={failed} "
                        f"{el:.0f}s ({(written + failed) / max(el, 1):.2f} pg/s)",
                        flush=True,
                    )

    el = time.time() - started
    print(
        f"[done] written={written} failed={failed} overlay_present={overlay_hits} "
        f"elapsed={el:.0f}s",
        flush=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls", required=True, help="newline-delimited URL file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--timeout-ms", type=int, default=45000)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    with open(args.urls, encoding="utf-8") as fh:
        urls = [l.strip() for l in fh if l.strip() and not l.startswith("#")]
    if args.limit:
        urls = urls[: args.limit]

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    asyncio.run(run(urls, args.out, args.concurrency, args.timeout_ms, args.resume))


if __name__ == "__main__":
    sys.exit(main())
