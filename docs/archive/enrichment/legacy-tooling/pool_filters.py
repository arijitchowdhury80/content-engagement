#!/usr/bin/env python3
"""
pool_filters — remove from the candidate pool everything that is not this page's own content.

WHY THIS IS A FILTER AND NOT A PROMPT INSTRUCTION
  The prompt already asks the model not to pick furniture. It picked furniture anyway, on 10 of 10
  pages in each Scout probe: "Use this file to discover all available pages before exploring
  further." is well-formed prose, it is 71 characters, and every shape test correctly calls it a
  sentence. Only "this text belongs to the site, not the page" refutes it, and that is a fact about
  provenance rather than about the sentence.

  So it is removed before the model sees it. A candidate that is not in the menu cannot be picked,
  cannot be resolved, and cannot reach the index. This is the same reasoning as the numbered-index
  contract: make the wrong answer unrepresentable rather than forbidden.

WHAT IS REMOVED, and why each one is not the page talking about itself
  DOC_INDEX     the `> ## Documentation Index` / llms.txt block. Site furniture, on every /doc page
                of both sources. Measured 10/10 and 10/10 in probe 1, 23/23 in probe 2.
  CHROME        skip-links, cookie/consent, legal footer, sign-up CTAs, breadcrumb rails. Present on
                Scout bodies because Scout scrapes the rendered page; the `.md` twin never had them.
  CODE_COMMENT  `// The client can fail to initialize...`. Inside a fenced example, so it documents
                the sample, not the page. Measured 6 on Scout, 3 on twin across 10 pages.
  BOILERPLATE   G8: the sentence appears on N other pages in the corpus. Corpus evidence, not shape.
  DUPLICATE_DESC exact OR near duplicate of the record's own `description`. An abstract that
                restates a field the index already stores adds nothing and burns the record.

WHAT IS DELIBERATELY NOT REMOVED
  Short prose, terse reference sentences, and anything the model might find thin. Under-filtering
  costs an abstract; over-filtering silently removes the only real sentence on a sparse page and the
  record then reports THIN for a reason that is not true. Every drop is counted and reported by
  reason so the balance is auditable rather than asserted.
"""

from __future__ import annotations

import re

MIN_CHARS = 25

DOC_INDEX_MARKERS = (
    "use this file to discover all available pages",
    "fetch the complete documentation index",
    "## documentation index",
)

CHROME_PATTERNS: tuple[tuple[str, re.Pattern], ...] = (
    ("skip-link",  re.compile(r"^\s*\[?skip to (main )?content", re.I)),
    ("cookie",     re.compile(r"cookie (policy|settings|preferences|banner)|accept all cookies", re.I)),
    ("legal",      re.compile(r"©\s*\d{4}|all rights reserved|privacy policy|terms of service", re.I)),
    ("cta",        re.compile(r"^\s*(start free|sign up for free|get started for free|book a demo|"
                              r"talk to an expert|contact sales)\b", re.I)),
    ("breadcrumb", re.compile(r"^\s*\[?(home|documentation|docs)\]?\s*[/>›»]")),
    ("newsletter", re.compile(r"subscribe to (our )?(the )?newsletter|get the latest .* in your inbox", re.I)),
)

# Leading comment markers. Anchored: a sentence merely CONTAINING "//" (a URL) is not a comment.
CODE_COMMENT = re.compile(r"^\s*(//|#\s|/\*|\*\s|--\s|<!--)")

NEAR_DUP_BAR = 0.70


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[\w']+", (text or "").lower()))


def overlap(a: str, b: str) -> float:
    """max(Jaccard, containment).

    Containment is the half that matters here: a candidate that is the description plus a trailing
    clause is a duplicate in substance, and Jaccard marks it down for length alone. Recorded in the
    dedup-paraphrase lesson after an earlier metric missed exactly this pair.
    """
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    return max(inter / len(ta | tb), inter / min(len(ta), len(tb)))


# Strings that are page furniture wherever they appear. THE SINGLE SOURCE OF TRUTH for this list:
# `validate_blog_outputs.py` imports it from here rather than keeping its own copy.
#
# It lived only in the validator until 2026-08-10, which meant the validator could NAME
# "Your browser does not support the audio element." as leakage while the pool filter happily left
# it in the menu. The blog repair run then promoted it into five highlights, because it is a
# complete eight-word sentence with balanced brackets and every shape test says it is prose. Only
# a corpus fact refutes it, and a corpus fact is useless if the stage that builds the menu cannot
# see it.
FORBIDDEN_TEXT: tuple[str, ...] = (
    "page not found",
    "brand guidelines",
    "download logo pack",
    "your browser does not support the audio element",
    "your browser does not support the video element",
    "allow functional cookies",
)


def drop_reason(cand, description: str = "", title: str = "") -> str | None:
    """Why this candidate is not the page's own content, or None to keep it.

    Order matters only for the reported reason, not for the outcome: the most specific and most
    defensible cause is checked first so the packet's histogram is readable.
    """
    text = (getattr(cand, "text", "") or "").strip()
    original = (getattr(cand, "original", "") or "").strip() or text
    low = text.lower()

    if not text or len(text) < MIN_CHARS:
        return "TOO_SHORT"
    if any(marker in low for marker in DOC_INDEX_MARKERS):
        return "DOC_INDEX"
    if any(marker in low for marker in FORBIDDEN_TEXT):
        return "FORBIDDEN_TEXT"
    if CODE_COMMENT.match(original):
        return "CODE_COMMENT"
    for name, pattern in CHROME_PATTERNS:
        if pattern.search(text):
            return f"CHROME_{name.upper().replace('-', '_')}"
    if getattr(cand, "kind", "") == "boilerplate":
        return "BOILERPLATE"
    if getattr(cand, "is_already_indexed", False):
        return "DUPLICATE_DESC_EXACT"
    if description and overlap(text, description) >= NEAR_DUP_BAR:
        return "DUPLICATE_DESC_NEAR"
    if title and overlap(text, title) >= NEAR_DUP_BAR:
        return "DUPLICATE_TITLE"
    return None


def filter_pool(cands: list, description: str = "", title: str = "") -> tuple[list, dict[str, int], list]:
    """(kept, dropped_counts_by_reason, dropped_candidates).

    Candidates keep their ORIGINAL `.index`. Renumbering would break the one guarantee this
    pipeline has: the model returns an index, and that index must address the same span the menu
    showed it. `render_menu` prints whatever list it is handed, so a sparse index set is fine.
    """
    kept, dropped, counts = [], [], {}
    for cand in cands:
        reason = drop_reason(cand, description, title)
        if reason is None:
            kept.append(cand)
        else:
            dropped.append((cand, reason))
            counts[reason] = counts.get(reason, 0) + 1
    return kept, counts, dropped
