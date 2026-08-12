#!/usr/bin/env python3
"""WU-06 correction — two claims re-tested in isolation.

The first teardown run drove all five states through ONE browser context in
order, so the zero-result state was entered after AI mode had been used. Two
claims in the doc may therefore be artifacts of chat mode rather than of the
zero-result state:

  A. "the filter rail empties on zero results"
  B. "chat history is not persisted across a reload"

Each is re-tested in a FRESH browser context that has done nothing else.
Read-only. Headless.
"""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

JS_STATE = """() => {
  const q = s => [...document.querySelectorAll(s)].filter(e => e.getBoundingClientRect().width > 0);
  const chat = document.querySelector('#agentic-search-chat-mode');
  const search = document.querySelector('#agentic-search-search-mode');
  return {
    facet_items: q('#source-filter .ais-RefinementList-item').length,
    facet_rail_present: !!document.querySelector('#source-filter'),
    hits: q('.agentic-search-hit').length,
    stats: (q('.ais-Stats, .agentic-search-stats')[0]||{}).textContent?.replace(/\\s+/g,' ').trim() || null,
    suggestions: q('.agentic-search-suggestion-button').map(e => e.textContent.trim()),
    ai_prompts: q('.agentic-search-ai-prompt').length,
    show_more: q("button").some(b => /Show more/i.test(b.textContent||'')),
    search_view_visible: search ? search.getBoundingClientRect().width > 0 : null,
    chat_view_visible: chat ? chat.getBoundingClientRect().width > 0 : null,
    assist_transcript: /Algolia Assist/.test(document.body.innerText),
  };
}"""


def fresh(b):
    ctx = b.new_context(user_agent=UA, viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3500)
    page.click("#globalSearchButton")
    page.wait_for_timeout(2200)
    return ctx, page


out = {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)

    # ---- A. zero-result, in a context that has never touched AI mode
    ctx, page = fresh(b)
    inp = page.query_selector(".agentic-search-shell input")
    inp.click(); inp.type("zzqqxwvplump", delay=100)
    page.wait_for_timeout(1500)
    page.keyboard.press("Enter")
    page.wait_for_timeout(3500)
    out["A_zero_result_clean_context"] = page.evaluate(JS_STATE)
    shell = page.query_selector(".agentic-search-shell")
    shell.screenshot(path=str(SHOTS / "overlay-zero-result-clean.png"))

    # control: same context, a query that DOES return results
    for _ in range(len("zzqqxwvplump")):
        page.keyboard.press("Backspace")
    inp.type("pricing", delay=90)
    page.wait_for_timeout(1200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(3000)
    out["A_control_query_with_results"] = page.evaluate(JS_STATE)
    ctx.close()

    # ---- B. chat persistence, tested the only way that means anything:
    #         start a chat, then reload, then look.
    ctx, page = fresh(b)
    inp = page.query_selector(".agentic-search-shell input")
    inp.click(); inp.type("ecommerce search", delay=90)
    page.wait_for_timeout(1200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    btn = page.query_selector("#agenticAiModeButton")
    if btn and btn.is_visible():
        btn.click()
        for _ in range(10):
            page.wait_for_timeout(2500)
            if page.evaluate("() => /Algolia Assist/.test(document.body.innerText)"):
                break
    out["B_before_reload"] = page.evaluate(JS_STATE)
    out["B_storage_key_written"] = page.evaluate(
        "() => localStorage.getItem('algolia.agenticChat.v1') ? 'present' : 'absent'")

    page.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3500)
    page.click("#globalSearchButton")
    page.wait_for_timeout(2500)
    out["B_after_reload_same_context"] = page.evaluate(JS_STATE)
    ctx.close()

    b.close()

(ROOT / "overlay-zero-persistence-recheck.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
