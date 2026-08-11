#!/usr/bin/env python3
"""WU-06 — produce ANNOTATED screenshots of the five overlay states.

Re-drives the live overlay, and for each state captures the screenshot together
with the bounding boxes of the elements the teardown talks about. Boxes and
screenshot come from the same page render, so the callouts cannot drift.

Output: screenshots/overlay-<state>-annotated.png — each is the raw capture with
numbered callout boxes plus a legend band underneath.

Read-only against the site. Headless.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

ACCENT = (0, 60, 255)      # callout stroke
BADGE = (255, 255, 255)
INK = (17, 20, 45)
BAND = (247, 248, 252)
RULE = (214, 219, 235)

# state -> list of (css selector, caption). First visible match is used.
TARGETS = {
    "pre-query": [
        ("#source-filter", "Source filter rail — 8 facets with counts. An infrastructure taxonomy: 4 labels name a system, 3 a content type, 1 is leftovers."),
        ("#agenticAiModeButton", "AI mode toggle."),
        (".agentic-search-ai-prompt", "Prompt chips — all four are vendor-voiced sales questions, not visitor questions."),
        (".agentic-search-suggestion-button", "Suggestions — generic in the empty state. No recent or popular searches, no personalisation."),
        (".agentic-search-hit", "Default hits. hitsPerPage is 3."),
    ],
    "autocomplete": [
        (".agentic-search-hit", "Query-as-you-type results, still 3."),
        ("#source-filter", "Facet counts recompute per keystroke. At 'ecom' this reads Support 1,695 and Academy 142 — every record in both sources."),
        (".agentic-search-suggestion-button", "Suggestions switch from generic to query-derived."),
    ],
    "post-query": [
        (".agentic-search-hit", "Hit card: thumbnail, title, 'Source • category', 'Learn more →'. No breadcrumb, no snippet, no date, no highlighting."),
        ("#source-filter", "Facets recomputed for the query — sums to the stated result count."),
    ],
    "ai-mode": [
        ("#agentic-search-chat-mode", "Algolia Assist, triggered by Enter — no AI-mode click needed. The answer is generative and carries no citations, and never links to the results retrieved directly above it."),
        (".agentic-search-hit", "Retrieved results stay on screen, above the answer, unconnected to it."),
        ("#source-filter", "Filter rail still live behind the chat."),
    ],
    "zero-result": [
        (".ais-Stats, .agentic-search-stats", "'No results'. No did-you-mean, no spelling correction, no query relaxation — the keyword-search recovery affordances are absent."),
        (".agentic-search-facets", "The filter rail EMPTIES — 0 facet items. The left column goes blank."),
        (".agentic-search-suggestion-button", "Suggestions revert to the generic four, unrelated to what was typed."),
        ("#agentic-search-chat-mode", "But it is not a dead end: pressing Enter auto-engages Algolia Assist, which answers the failed query with a structured recovery menu. The AI is the fallback."),
    ],
}


def font(sz, bold=False):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
              else "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def annotate(png, boxes, out, title):
    """boxes: [{'n':1,'box':[x,y,w,h],'caption':str}]"""
    img = Image.open(png).convert("RGB")
    W, H = img.size
    f_badge, f_leg, f_title = font(19, True), font(15), font(21, True)

    d = ImageDraw.Draw(img)
    for b in boxes:
        x, y, w, h = b["box"]
        d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], outline=ACCENT, width=3)
        # prefer the left margin so the badge never covers a section heading;
        # only fall back to sitting above the box when there is no room
        if x >= 40:
            bx, by = x - 38, y - 2
        else:
            bx, by = max(x - 2, 4), max(y - 32, 4)
        d.rounded_rectangle([bx, by, bx + 30, by + 28], 6, fill=ACCENT)
        d.text((bx + 11, by + 4), str(b["n"]), font=f_badge, fill=BADGE)

    # legend band
    pad, lw = 22, W - 44
    lines = []
    for b in boxes:
        lines.append((b["n"], wrap(d, b["caption"], f_leg, lw - 34)))
    band_h = 58 + sum(len(l) * 21 + 10 for _, l in lines)
    out_img = Image.new("RGB", (W, H + band_h), BAND)
    out_img.paste(img, (0, 0))
    d2 = ImageDraw.Draw(out_img)
    d2.line([(0, H), (W, H)], fill=RULE, width=2)
    d2.text((pad, H + 16), title, font=f_title, fill=INK)
    y = H + 50
    for n, ls in lines:
        d2.rounded_rectangle([pad, y, pad + 26, y + 24], 6, fill=ACCENT)
        d2.text((pad + 9, y + 3), str(n), font=f_badge, fill=BADGE)
        for i, line in enumerate(ls):
            d2.text((pad + 36, y + 3 + i * 21), line, font=f_leg, fill=INK)
        y += len(ls) * 21 + 10
    out_img.save(out)
    print(f"  wrote {out.name}  ({len(boxes)} callouts)")


# Boxes are measured relative to the overlay shell, and the screenshot is of that
# same shell element, so scroll position cannot put a callout in the wrong place.
# Union of every visible match, so a caption that says "all four" is boxed around
# all four rather than around the first one.
JS_BOX = """(sel) => {
  const shell = document.querySelector('.agentic-search-shell');
  if (!shell) return null;
  const s = shell.getBoundingClientRect();
  let x0=1e9, y0=1e9, x1=-1e9, y1=-1e9, found=false;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    found = true;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
  }
  if (!found) return null;
  return [Math.round(x0 - s.x), Math.round(y0 - s.y),
          Math.round(x1 - x0), Math.round(y1 - y0)];
}"""


def capture(page, state, shot):
    shell = page.query_selector(".agentic-search-shell")
    if not shell:
        raise RuntimeError(f"{state}: overlay shell not found")
    # Grow the viewport until the whole shell fits. Otherwise Playwright stitches a
    # scrolling element screenshot while getBoundingClientRect still reports pre-scroll
    # positions, and every callout lands in the wrong place — which is exactly what the
    # first AI-mode annotation did.
    h = page.evaluate(
        "() => Math.ceil(document.querySelector('.agentic-search-shell').getBoundingClientRect().height)")
    page.set_viewport_size({"width": 1440, "height": max(1000, min(h + 140, 7000))})
    page.wait_for_timeout(1500)
    shell = page.query_selector(".agentic-search-shell")
    shell.screenshot(path=str(shot))
    boxes, n = [], 0
    for sel, caption in TARGETS[state]:
        box = page.evaluate(JS_BOX, sel)
        if not box:
            print(f"  ! {state}: no match for {sel}")
            continue
        n += 1
        boxes.append({"n": n, "box": box, "caption": caption})
    return boxes


def main():
    manifest = {}
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(user_agent=UA, viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()

        # A FRESH CONTEXT PER STATE. Driving all five through one context put the
        # zero-result capture downstream of AI mode, and the leftover chat made two
        # claims in the teardown wrong. Isolation is not optional here.
        holder = {}

        def open_overlay():
            if holder.get("ctx"):
                holder["ctx"].close()
            holder["ctx"] = b.new_context(user_agent=UA, viewport={"width": 1440, "height": 1000})
            pg = holder["ctx"].new_page()
            holder["page"] = pg
            pg.goto("https://www.algolia.com/", wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(3500)
            pg.click("#globalSearchButton")
            pg.wait_for_timeout(2200)
            return pg.query_selector(".agentic-search-shell input")

        def run(state, title, setup):
            nonlocal page
            print(f"[{state}]")
            inp = open_overlay()
            page = holder["page"]
            setup(inp)
            raw = SHOTS / f"overlay-{state}-annotated-src.png"
            boxes = capture(page, state, raw)
            annotate(raw, boxes, SHOTS / f"overlay-{state}-annotated.png", title)
            raw.unlink()
            manifest[state] = boxes

        run("pre-query", "Pre-query — the overlay opens onto a populated panel", lambda i: None)

        def typ(i, q, enter=False):
            i.click(); i.type(q, delay=90); page.wait_for_timeout(1500)
            if enter:
                page.keyboard.press("Enter"); page.wait_for_timeout(3000)

        run("autocomplete", "Autocomplete — 'ecom' returns 1,942 results, 94.6% of them whole sources",
            lambda i: typ(i, "ecom"))
        run("post-query", "Post-query — 'ecommerce search', 371 results, 3 shown",
            lambda i: typ(i, "ecommerce search", enter=True))

        def ai(i):
            typ(i, "ecommerce search", enter=True)
            btn = page.query_selector("#agenticAiModeButton")
            if btn and btn.is_visible():
                btn.click()
                last, stable = 0, 0
                for _ in range(16):
                    page.wait_for_timeout(2500)
                    cur = page.evaluate("() => ((document.querySelector('.agentic-search-shell')||{}).textContent||'').length")
                    stable = stable + 1 if cur == last else 0
                    if stable >= 2:
                        break
                    last = cur
        run("ai-mode", "AI mode — a generative, uncited answer below results it never links to", ai)

        run("zero-result", "Zero-result — 'zzqqxwvplump'. Keyword search dead-ends; the AI catches the fall",
            lambda i: typ(i, "zzqqxwvplump", enter=True))

        b.close()
    (ROOT / "overlay-annotations.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
