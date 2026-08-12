#!/usr/bin/env python3
"""WU-06 — capture the five states of the live algolia.com search overlay.

Read-only. Headless. For each state it saves a screenshot to
20-research/screenshots/overlay-<state>.png and appends structured observations
to 20-research/overlay-observations.json, including the Algolia API request and
response behind each state.

States: pre-query | autocomplete | post-query | ai-mode | zero-result
"""
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

QUERY_PARTIAL = "ecom"
QUERY_FULL = "ecommerce search"
QUERY_ZERO = "zzqqxwvplump"

SEARCH_RE = re.compile(r"algolia(net)?\.(com|net)/1/indexes|/1/indexes/\*/queries")

net = []  # every Algolia search request/response seen, tagged with the current state
state_label = {"v": "load"}


# ---------------------------------------------------------------- DOM readers

JS_FACETS = """() => {
  const out = [];
  for (const li of document.querySelectorAll('#source-filter .ais-RefinementList-item')) {
    const t = li.querySelector('.ais-RefinementList-labelText');
    const c = li.querySelector('.ais-RefinementList-count');
    const cb = li.querySelector('input[type=checkbox]');
    out.push({
      source: t ? t.textContent.trim() : null,
      count: c ? c.textContent.trim() : null,
      checked: cb ? cb.checked : null,
    });
  }
  return out;
}"""

JS_HITS = """() => {
  const hits = [...document.querySelectorAll('.agentic-search-hit')].map(h => {
    const txt = (h.textContent || '').replace(/\\s+/g,' ').trim();
    const cls = [...h.querySelectorAll('*')].map(e =>
      (typeof e.className === 'string' ? e.className : '')).join(' ');
    return {
      href: h.getAttribute('href'),
      text: txt.slice(0, 220),
      child_classes: [...new Set(cls.split(/\\s+/).filter(c => c.startsWith('agentic-')))],
    };
  });
  return hits;
}"""

JS_STRUCTURE = """() => {
  const pick = s => [...document.querySelectorAll(s)]
    .filter(e => e.getBoundingClientRect().width > 0)
    .map(e => (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120));
  const shell = document.querySelector('.agentic-search-shell');
  return {
    section_titles: pick('.agentic-search-section-title'),
    toolbar: pick('.agentic-search-toolbar__mode'),
    ai_prompts: pick('.agentic-search-ai-prompt'),
    suggestions: pick('.agentic-search-suggestion-button'),
    views_present: [...document.querySelectorAll('.agentic-search-view')].map(v => ({
      id: v.id, visible: v.getBoundingClientRect().width > 0
    })),
    stats: pick('.ais-Stats, .agentic-search-stats'),
    show_more: pick('.ais-InfiniteHits-loadMore, .agentic-search-show-more, [class*="load-more"], [class*="show-all"], [class*="view-all"]'),
    footer_links: [...document.querySelectorAll('.agentic-search-shell a')]
      .filter(a => e_visible(a))
      .map(a => ({text: (a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80), href: a.getAttribute('href')}))
      .filter(a => a.href && !a.href.startsWith('http') === false ? true : true)
      .slice(0, 40),
    shell_text: shell ? (shell.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 1200) : null,
  };
  function e_visible(e){ const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; }
}"""


def snap(page, name, obs, extra=None):
    """Screenshot + structured read of the current overlay state."""
    path = SHOTS / f"overlay-{name}.png"
    page.screenshot(path=str(path))
    entry = {
        "state": name,
        "screenshot": str(path.relative_to(ROOT.parent.parent)),
        "url": page.url,
        "facets": page.evaluate(JS_FACETS),
        "hits": page.evaluate(JS_HITS),
        "structure": page.evaluate(JS_STRUCTURE),
    }
    if extra:
        entry.update(extra)
    obs.append(entry)
    flush(obs)
    print(f"[{name}] hits={len(entry['hits'])} facets={len(entry['facets'])} -> {path.name}")
    return entry


def flush(obs):
    """Persist after every state so a mid-run failure still leaves evidence."""
    (ROOT / "overlay-observations.json").write_text(json.dumps(obs, indent=2))
    (ROOT / "overlay-network.json").write_text(json.dumps(net, indent=2))


def main():
    obs = []
    try:
        return run(obs)
    finally:
        flush(obs)


def run(obs):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()

        def on_response(resp):
            if SEARCH_RE.search(resp.url) and resp.request.method == "POST":
                item = {"state": state_label["v"], "url": resp.url.split("?")[0],
                        "request": None, "response": None}
                try:
                    item["request"] = json.loads(resp.request.post_data)
                except Exception:
                    item["request"] = resp.request.post_data
                try:
                    item["response"] = resp.json()
                except Exception:
                    pass
                net.append(item)

        page.on("response", on_response)

        # ---- load
        page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)

        # ---- 1. pre-query (overlay opened, empty input)
        state_label["v"] = "pre-query"
        page.click("#globalSearchButton")
        page.wait_for_timeout(2500)
        inp = page.query_selector(
            ".agentic-search-shell input[type=text], .agentic-search-shell input[type=search], "
            ".agentic-search-shell input"
        )
        snap(page, "pre-query", obs, {"input_found": inp is not None,
                                      "input_placeholder": inp.get_attribute("placeholder") if inp else None})

        # ---- 2. autocomplete (partial typing)
        state_label["v"] = "autocomplete"
        if inp:
            inp.click()
            inp.type(QUERY_PARTIAL, delay=120)
            page.wait_for_timeout(2500)
        snap(page, "autocomplete", obs, {"query": QUERY_PARTIAL})

        # ---- 3. post-query results
        state_label["v"] = "post-query"
        if inp:
            for _ in range(len(QUERY_PARTIAL)):
                page.keyboard.press("Backspace")
            inp.type(QUERY_FULL, delay=90)
            page.wait_for_timeout(1200)
            page.keyboard.press("Enter")
            page.wait_for_timeout(3500)
        snap(page, "post-query", obs, {"query": QUERY_FULL})

        # per-source counts after a real query
        state_label["v"] = "post-query-facets"
        obs.append({"state": "post-query-facet-counts", "query": QUERY_FULL,
                    "facets": page.evaluate(JS_FACETS)})

        # ---- 3b. expansion path: "Show more results"
        state_label["v"] = "show-more"
        before = len(page.evaluate(JS_HITS))
        more = page.query_selector(
            "button:has-text('Show more results'), .agentic-search-show-more")
        if more and more.is_visible():
            more.click()
            page.wait_for_timeout(3000)
            after = len(page.evaluate(JS_HITS))
            obs.append({"state": "expansion-show-more", "hits_before": before,
                        "hits_after": after, "url_after": page.url})
            page.screenshot(path=str(SHOTS / "overlay-show-more.png"))
            print(f"[show-more] {before} -> {after} hits, url={page.url}")
        else:
            obs.append({"state": "expansion-show-more", "found": False})

        # ---- 4. AI mode. Clicking the toggle with a query already typed runs
        # Algolia Assist directly; the prompt chips only exist in the empty state.
        state_label["v"] = "ai-mode"
        ai = page.query_selector("#agenticAiModeButton")
        if ai and ai.is_visible():
            ai.click()
            page.wait_for_timeout(2500)
            page.screenshot(path=str(SHOTS / "overlay-ai-mode-entry.png"))
            # generative answers stream; wait for growth to stop
            last, stable = 0, 0
            for _ in range(20):
                page.wait_for_timeout(2500)
                cur = page.evaluate(
                    "() => ((document.querySelector('.agentic-search-shell')||{}).textContent||'').length")
                if cur == last:
                    stable += 1
                    if stable >= 2:
                        break
                else:
                    stable = 0
                last = cur
            ai_detail = page.evaluate(
                """() => {
                    const shell = document.querySelector('.agentic-search-shell');
                    const txt = shell ? shell.innerText : '';
                    const links = [...document.querySelectorAll(
                        '[class*="assist"] a, [class*="chat"] a, [class*="citation"] a, [class*="source"] a')]
                        .map(a => ({t:(a.textContent||'').trim().slice(0,80), h:a.getAttribute('href')}));
                    return {
                      answer_text: txt.slice(0, 6000),
                      answer_len: txt.length,
                      citation_like_links: links.slice(0, 30),
                      controls: [...document.querySelectorAll('button')]
                        .filter(b => b.getBoundingClientRect().width > 0)
                        .map(b => (b.textContent||'').replace(/\\s+/g,' ').trim())
                        .filter(t => t && t.length < 40),
                      raw_markdown_leak: /\\*\\*\\w/.test(txt),
                    };
                }"""
            )
            snap(page, "ai-mode", obs, {"ai": ai_detail})
            print(f"[ai-mode] answer_len={ai_detail['answer_len']} "
                  f"citations={len(ai_detail['citation_like_links'])} "
                  f"md_leak={ai_detail['raw_markdown_leak']}")
        else:
            print("!! AI mode button not found/visible")
            obs.append({"state": "ai-mode", "found": False})

        # ---- 5. zero-result
        state_label["v"] = "zero-result"
        page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3500)
        page.click("#globalSearchButton")
        page.wait_for_timeout(2000)
        inp2 = page.query_selector(".agentic-search-shell input")
        if inp2:
            inp2.click()
            inp2.type(QUERY_ZERO, delay=100)
            page.wait_for_timeout(1200)
            page.keyboard.press("Enter")
            page.wait_for_timeout(3500)
        snap(page, "zero-result", obs, {"query": QUERY_ZERO})

        (ROOT / "overlay-observations.json").write_text(json.dumps(obs, indent=2))
        (ROOT / "overlay-network.json").write_text(json.dumps(net, indent=2))
        print(f"\nstates captured: {[o['state'] for o in obs]}")
        print(f"algolia search calls captured: {len(net)}")
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
