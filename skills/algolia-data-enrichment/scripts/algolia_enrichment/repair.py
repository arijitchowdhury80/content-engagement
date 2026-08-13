"""Detect incomplete spans and repair them WITH THE PAGE'S OWN WORDS.

THE RULE THIS MODULE MUST NOT BREAK
  Repair means SELECTING MORE PAGE TEXT. It never means writing text.

  A repaired span is `canon.text[a:b]` -- one contiguous slice of the canonicalised page. Not a
  concatenation of two distant sentences, not a span with a full stop appended, not a paraphrase.
  If the page does not contain a grounded completion, there is no repair and the caller falls
  back to re-selection and then to the human-review queue.

  Adding a "." to "...update your product set" would read perfectly and would be a fabrication:
  the page does not end that sentence there, and live verification re-slices from the page and
  would not find it. Every fix here is extending-or-nothing, never additive.

WHY REPAIR AT ALL, INSTEAD OF QUARANTINING
  Arijit, 2026-08-10: "Do not quarantine as the first response. Fix the selection problem."
  A colon lead-in is not a bad page, it is a bad CUT. The sentence the model wanted is usually
  right there, one candidate further on. Repair recovered 310 of 349 affected Blog records.

WHAT COUNTS AS INCOMPLETE
  1. LIST_LEAD_IN     ends in ':' -- promises a list the span does not contain
  2. DANGLING_BRACKET unbalanced '[' or ']', from a markdown link cut in half
  3. MID_SENTENCE_CUT sentence-like prose with no terminal punctuation

  (3) applies to ABSTRACT spans always, and to HIGHLIGHT spans only when the text is
  sentence-like. A bullet is allowed to lack a full stop -- 350 highlight spans in the Blog run
  were period-less and every one was a legitimate bullet. Treating those as defects would have
  replaced 304 good records to fix 20 bad ones.
"""

from __future__ import annotations

from dataclasses import replace

from .candidates import Candidate, has_broken_brackets

LIST_LEAD_IN = "LIST_LEAD_IN"
DANGLING_BRACKET = "DANGLING_BRACKET"
MID_SENTENCE_CUT = "MID_SENTENCE_CUT"

_TERMINAL = ".!?"
_CLOSERS = "\"'’”)]»"

# A gap of at most this many canonical characters between two candidates still counts as
# "adjacent". One space is the normal case; canonicalisation collapses runs of whitespace, so a
# larger gap means something was skipped and merging would fabricate adjacency.
MAX_ADJACENCY_GAP = 1

# Across a block boundary the canonical text still runs together with a single separator, but a
# little slack is allowed for a list marker that canonicalisation stripped. Kept tight: a wide
# window would let the merge jump over content and fabricate adjacency.
MAX_CROSS_BLOCK_GAP = 2

# Below this, a period-less highlight is a label or a table cell, not a sentence. At or above it,
# it is prose that was cut. Chosen from the Blog distribution, not tuned.
_SENTENCE_LIKE_WORDS = 6


def _strip_closers(text: str) -> str:
    t = text.rstrip()
    while t and t[-1] in _CLOSERS:
        t = t[:-1]
    return t


def ends_sentence(text: str) -> bool:
    t = _strip_closers(text)
    return bool(t) and t[-1] in _TERMINAL


def is_sentence_like(text: str) -> bool:
    """Long enough to be prose rather than a label."""
    return len(text.split()) >= _SENTENCE_LIKE_WORDS


def incomplete_reason(text: str, *, is_abstract: bool) -> str | None:
    """Why this span is not a finished thought, or None if it is.

    `is_abstract` matters for one rule only: abstract spans are read as one paragraph, so a
    missing full stop runs one span into the next and asserts a link neither makes. Highlights
    render as a list, where a period-less bullet is ordinary.
    """
    t = text.strip()
    if not t:
        return MID_SENTENCE_CUT
    if has_broken_brackets(t):
        return DANGLING_BRACKET
    if _strip_closers(t).endswith(":"):
        return LIST_LEAD_IN
    if not ends_sentence(t) and (is_abstract or is_sentence_like(t)):
        return MID_SENTENCE_CUT
    return None


# A colon lead-in is the ONE case where crossing a block boundary is not false adjacency, because
# the page itself signalled the continuation: "There are several benefits:" followed by a bullet
# list puts the list in a different block by construction. A strict same-block rule would make
# every colon lead-in permanently unrepairable, and that was the largest single defect bucket
# (47 of 67 abstract defects in the Blog run).
#
# A mid-sentence cut or a dangling bracket gets no such licence: there the page gave no signal,
# and joining across a block is precisely the false adjacency that spans are stored as arrays to
# avoid.
def _adjacent_after(cand: Candidate, pool: list[Candidate], *,
                    allow_cross_block: bool = False) -> Candidate | None:
    """The candidate that continues `cand` on the page, or None.

    Adjacency is decided on CANONICAL offsets, not on menu order: the menu is filtered upstream,
    so "the next index" is not "the next words on the page".
    """
    best = None
    for other in pool:
        if other.canon_start < 0 or cand.canon_end < 0:
            continue
        if other is cand:
            continue
        same_block = other.block == cand.block
        if not same_block and not allow_cross_block:
            continue
        gap = other.canon_start - cand.canon_end
        limit = MAX_ADJACENCY_GAP if same_block else MAX_CROSS_BLOCK_GAP
        if 0 <= gap <= limit:
            if best is None or other.canon_start < best.canon_start:
                best = other
    return best


def repair_span(cand: Candidate, pool: list[Candidate], canon, *, is_abstract: bool,
                max_extensions: int = 3) -> tuple[Candidate | None, list[str]]:
    """Extend `cand` over following page text until it is a finished thought.

    Returns (repaired candidate, trace). The repaired candidate's `text` is
    `canon.text[cand.canon_start:end]` -- a single contiguous slice, so every character came off
    the page in the order the page has it. Returns (None, trace) when the page offers no grounded
    completion within `max_extensions` steps.
    """
    trace: list[str] = []
    reason = incomplete_reason(cand.text, is_abstract=is_abstract)
    if reason is None:
        return cand, trace

    cross = reason == LIST_LEAD_IN
    cur = cand
    end = cand.canon_end
    for _ in range(max_extensions):
        nxt = _adjacent_after(cur, pool, allow_cross_block=cross)
        if nxt is None:
            trace.append(f"no adjacent page text after offset {end}; cannot repair {reason}")
            return None, trace
        end = nxt.canon_end
        merged_text = canon.text[cand.canon_start:end]
        trace.append(
            f"extended over candidate {nxt.index} (+{len(merged_text) - len(cand.text)} chars)")
        if incomplete_reason(merged_text, is_abstract=is_abstract) is None:
            # Original-markdown offsets must cover the same ground, because verification
            # re-slices the ORIGINAL page, not the canonical projection.
            #
            # `followed_by` is recomputed from the NEW end. The reversal check reads it to ask
            # "does the page contradict this span immediately after it?" -- left stale it would
            # answer that question about the wrong position, which is how a gate quietly stops
            # gating.
            return replace(cand, text=merged_text, canon_end=end,
                           original=canon.original[cand.start:nxt.end],
                           end=nxt.end, sentence_complete=True,
                           followed_by=canon.text[end:end + 140].lstrip()), trace
        cur = nxt
    trace.append(f"still incomplete after {max_extensions} extensions; abandoning repair")
    return None, trace


def repair_or_drop_highlights(highs: list[Candidate], pool: list[Candidate], canon,
                              used: set[int], min_clean: int = 3,
                              replacement_pool: list[Candidate] | None = None
                              ) -> tuple[list[Candidate], list[str], bool]:
    """(kept highlights, trace, enough).

    Order of preference, per Arijit 2026-08-10: repair from the page, then replace with a clean
    unused candidate, then drop. `enough` is False only when fewer than `min_clean` survive,
    which is the sole condition under which highlights send a record to human review.

    TWO POOLS, DELIBERATELY.
      `pool` answers "what does the page say next" and must be the UNFILTERED candidate list --
      the pool filter removes chrome and boilerplate, leaving holes in page order that would make
      a repairable span look unrepairable.
      `replacement_pool` answers "what else could we say instead" and must be the FILTERED list,
      because a replacement is a free choice and there is no reason to choose furniture. Passing
      the unfiltered list here would let a cookie banner become a key highlight.
    """
    replacements = replacement_pool if replacement_pool is not None else pool
    trace: list[str] = []
    kept: list[Candidate] = []
    taken = set(used)

    for h in highs:
        reason = incomplete_reason(h.text, is_abstract=False)
        if reason is None:
            kept.append(h); taken.add(h.index); continue

        fixed, t = repair_span(h, pool, canon, is_abstract=False)
        trace += [f"highlight {h.index} {reason}: {x}" for x in t]
        if fixed is not None:
            kept.append(fixed); taken.add(h.index); continue

        repl = next((c for c in replacements
                     if c.index not in taken
                     and incomplete_reason(c.text, is_abstract=False) is None
                     and len(c.text) <= 300
                     and (len(c.text.split()) >= 6 or any(ch.isdigit() for ch in c.text))), None)
        if repl is not None:
            kept.append(repl); taken.add(repl.index)
            trace.append(
                f"highlight {h.index} {reason}: replaced with clean candidate {repl.index}")
        else:
            trace.append(f"highlight {h.index} {reason}: no repair, no replacement -- dropped")

    return kept, trace, len(kept) >= min_clean
