#!/usr/bin/env python3
"""
pool_gates — turn the post-selection gates into PRE-selection bans.

WHY THIS EXISTS -- 2026-08-10, the 589 quarantined blog records
  The gates in span_gate.py run AFTER the model has picked. When one fires, the whole record is
  quarantined, even though the thing that failed was a single sentence and the page had forty
  others. 589 of 2,800 blog records died that way, and the census says every single failure class
  was decidable from the page alone, with no model involved:

      REVERSAL          364   the page contradicts the span in its NEXT sentence
      MISSING_SUBJECT    80   the abstract's first span opens with "It"/"They"/"We"
      SELF_REFERENCE     71   "in this article", "in this post", "this page"
      SPANS_TOO_FAR      56   picks stitched from opposite ends of the document
      EXCLUDED_SECTION   45   "Next Steps", "Common mistakes", "Further reading"
      CHROME             19   cookie/consent/newsletter text
      INCOMPLETE_SPAN     3   mid-sentence cut with no grounded completion

  `followed_by`, `section`, and the span text are all properties of the CANDIDATE. None of them
  needs the selection to exist. So the gate is being asked the question too late.

THE FIX, AND IT IS THE SAME ONE THE PROJECT ALREADY MADE ONCE
  `candidates.py` made fabrication unrepresentable by having the model return integers instead of
  text. `pool_filters.py` made furniture unpickable by deleting it from the menu. This module
  extends that to the remaining gates: a candidate that WILL fail a gate is removed from the menu,
  so the model cannot pick it, so the gate cannot fire.

  The bans are computed by calling span_gate's own predicates -- not by re-implementing them.
  A second copy of a rule is a rule that drifts, and this repo has already paid for that twice
  (`run_gates()` vs the inline path). If a gate changes, this module changes with it.

REVERSAL IS REPAIRED BEFORE IT IS BANNED
  Arijit's standing ruling: repair before quarantine. A span whose next sentence reverses it is a
  bad CUT -- the page states the contrast and the selection stopped one sentence short. So the
  first response is to EXTEND the span over the contradiction, `canon.text[a:b]`, one contiguous
  slice, and keep both halves. Banning is what happens when the extension is not available or runs
  too long. Nothing is written; no punctuation is added; the extension is page text or it does not
  happen.

WHAT IS DELIBERATELY *NOT* PRE-BANNED
  MISSING_SUBJECT. "It reorders them in real time" is a perfectly good abstract span 2 and a bad
  abstract span 1 -- the defect is positional, not intrinsic. Banning it from the pool would delete
  legitimate sentences. Instead the candidate is FLAGGED, the flag is shown in the menu, and the
  ban is applied only on the retry that a subject failure triggers. See `opener_ineligible`.

  SPANS_TOO_FAR and the language/section-count checks. Those are properties of the SET, not of any
  one candidate, so no per-candidate ban can express them. They are handled by the retry ladder in
  enrich_run.process(), which narrows the pool to a window and asks again.
"""

from __future__ import annotations

import re
from dataclasses import replace

from pool_filters import drop_reason
from span_gate import (_REVERSAL, _SECTION_DENY, check_blacklists,  # noqa: F401
                       check_subject_present, is_speech)
from span_repair import _adjacent_after

# Sections the brief names explicitly and `_SECTION_DENY` does not already cover. Kept SEPARATE
# from span_gate's list on purpose: `_SECTION_DENY` is the gate, and widening the gate would
# retroactively change the verdict on the 2,026 accepted records. This list only narrows the MENU,
# which can never turn a good record bad -- the worst it can do is cost a candidate.
_EXTRA_SECTION_DENY = re.compile(
    r"sign[ -]?up|register (now|today|for)|free trial|webinar|"
    r"contact (us|sales|support)|customer support|support (cent(er|re)|portal)|help cent(er|re)|"
    r"navigation|table of contents|on this page|share this|about the author|"
    r"subscribe|stay (up to date|informed)|get started today",
    re.I,
)

# An extension that swallows this much text is no longer "the sentence plus its contrast", it is a
# paragraph. Chosen so the common two-sentence contrast fits and a runaway merge does not.
_MAX_EXTENDED_CHARS = 600

BAN_REVERSAL = "REVERSAL_UNREPAIRABLE"
BAN_SECTION = "EXCLUDED_SECTION"
BAN_SECTION_EXTRA = "EXCLUDED_SECTION_EXTRA"
BAN_BLACKLIST = "BLACKLIST"          # self-reference, chrome, dominant CTA -- span_gate's own rule
BAN_SPEECH = "SPEECH_QUOTE"

FIX_REVERSAL_EXTENDED = "REVERSAL_EXTENDED"


def opener_ineligible(cand, title: str) -> bool:
    """True when this candidate cannot legally OPEN an abstract.

    Positional, not intrinsic -- see the module note. Uses span_gate's own G4 so the flag and the
    gate cannot disagree.
    """
    return bool(check_subject_present(cand.text, title or ""))


def _static_ban(cand, family: str) -> str | None:
    """A reason this candidate must never be picked, independent of the selection.

    Reversal is excluded here because it is repairable; see `resolve_reversal`.
    """
    if check_blacklists([cand.text]):
        return BAN_BLACKLIST
    section = getattr(cand, "section", "") or ""
    if section and _SECTION_DENY.search(section):
        return BAN_SECTION
    if section and _EXTRA_SECTION_DENY.search(section):
        return BAN_SECTION_EXTRA
    if (getattr(cand, "is_quoted", False) and family != "evidence"
            and is_speech(getattr(cand, "original", "") or cand.text, cand.text)):
        return BAN_SPEECH
    return None


def resolve_reversal(cand, pool: list, canon, max_extensions: int = 2):
    """Extend a reversed span over its own contradiction, or report that it cannot be.

    Returns (candidate_or_None, trace). The returned candidate's text is
    `canon.text[cand.canon_start:end]` -- ONE contiguous slice of the page. Same-block only: the
    contradiction that G10 detects is the next sentence, and a cross-block jump would be the false
    adjacency that spans are stored as arrays to avoid.
    """
    trace: list[str] = []
    if not _REVERSAL.match(getattr(cand, "followed_by", "") or ""):
        return cand, trace

    cur = cand
    for _ in range(max_extensions):
        nxt = _adjacent_after(cur, pool, allow_cross_block=False)
        if nxt is None:
            trace.append(f"candidate {cand.index}: reversal follows and no adjacent page text "
                         f"continues it -- banned")
            return None, trace
        end = nxt.canon_end
        merged = canon.text[cand.canon_start:end]
        if len(merged) > _MAX_EXTENDED_CHARS:
            trace.append(f"candidate {cand.index}: contrast would need {len(merged)} chars "
                         f"(limit {_MAX_EXTENDED_CHARS}) -- banned")
            return None, trace
        following = canon.text[end:end + 140].lstrip()
        fixed = replace(cand, text=merged, canon_end=end, end=nxt.end,
                        original=canon.original[cand.start:nxt.end],
                        followed_by=following, sentence_complete=True)
        if not _REVERSAL.match(following):
            trace.append(f"candidate {cand.index}: extended over candidate {nxt.index} to include "
                         f"the contrast (+{len(merged) - len(cand.text)} chars)")
            return fixed, trace
        cur = fixed
    trace.append(f"candidate {cand.index}: still reversed after {max_extensions} extensions -- banned")
    return None, trace


def apply_pool_gates(cands: list, canon, family: str, title: str,
                     unfiltered: list | None = None, description: str = ""):
    """(kept, counts_by_reason, trace, opener_ineligible_indices).

    `unfiltered` is the pre-pool-filter candidate list and is what adjacency is measured against:
    the filter leaves holes in page order, and the sentence that completes a contrast may well be
    one the filter dropped. Same reasoning as `span_repair`'s two-pool rule.

    Candidates keep their ORIGINAL `.index`. `render_menu` prints `c.index` and `resolve_selection`
    keys on it, so a sparse index set stays correctly addressed. Renumbering here would break the
    one guarantee the pipeline has.
    """
    adjacency_pool = unfiltered if unfiltered is not None else cands
    kept, counts, trace = [], {}, []

    def bump(reason: str) -> None:
        counts[reason] = counts.get(reason, 0) + 1

    for cand in cands:
        reason = _static_ban(cand, family)
        if reason is not None:
            bump(reason)
            continue
        fixed, t = resolve_reversal(cand, adjacency_pool, canon)
        trace += t
        if fixed is None:
            bump(BAN_REVERSAL)
            continue
        if fixed is not cand:
            # RE-FILTER THE EXTENSION. `filter_pool` ran on the ORIGINAL candidate, and an
            # extension is a different sentence -- longer, and carrying words the short version
            # did not. Two abstracts in the 2026-08-10 repair run grew far enough to restate the
            # record's own title, which is the exact thing `filter_pool` exists to prevent and
            # which it had no chance to see. Anything a fresh candidate would be dropped for, an
            # extended one is dropped for too.
            after = drop_reason(fixed, description, title)
            if after is not None:
                bump(f"EXTENSION_{after}")
                continue
            bump(FIX_REVERSAL_EXTENDED)
        kept.append(fixed)

    ineligible = {c.index for c in kept if opener_ineligible(c, title)}
    return kept, counts, trace, ineligible


# --- the retry ladder's half: failures -> what to change about the pool --------------------
#
# A gate failure names WHY the selection was wrong. That is enough to narrow the menu and ask
# again, which is what a person would do. Quarantining on the first refusal throws the page away
# to punish one sentence.

_SPREAD_LIMIT = 20_000


def retry_constraints(failures: list[str], sel, cands: list, title: str,
                      ineligible: set[int]) -> tuple[set[int], str]:
    """(indices to ban on the retry, a human reason) -- empty set means retry cannot help.

    Matching on the failure STRING is deliberate and is the reason each gate message is a stable
    sentence. The alternative -- structured codes -- is the better design and is a bigger change
    than a repair run should carry; the strings are asserted in tests so a reword cannot silently
    turn the ladder off.
    """
    ban: set[int] = set()
    reasons: list[str] = []

    if any("names no subject" in f for f in failures):
        ban |= ineligible
        reasons.append(f"{len(ineligible)} subject-less candidates banned from the menu")

    if any("characters of the original page" in f for f in failures):
        # Keep the page's own opening region and drop everything beyond a window from the FIRST
        # abstract pick. A tighter section is what the brief asks for, and page order is the only
        # locality signal that does not require re-reading the document.
        if sel.abstract:
            anchor = min(c.start for c in sel.abstract)
            far = {c.index for c in cands if abs(c.start - anchor) > _SPREAD_LIMIT // 2}
            ban |= far
            reasons.append(f"{len(far)} candidates outside a {_SPREAD_LIMIT // 2}-char window "
                           f"around offset {anchor} banned")

    if any("mixes languages" in f for f in failures):
        from span_gate import detect_language
        langs = [detect_language(c.text) for c in sel.abstract]
        majority = max(set(l for l in langs if l != "?"), key=langs.count, default="?")
        odd = {c.index for c in sel.abstract if detect_language(c.text) not in (majority, "?")}
        ban |= odd
        reasons.append(f"{len(odd)} off-language spans banned (majority {majority!r})")

    if any("different sections" in f for f in failures):
        keep_section = sel.abstract[0].section_index if sel.abstract else None
        far = {c.index for c in cands
               if keep_section is not None and abs(c.section_index - keep_section) > 2}
        ban |= far
        reasons.append(f"{len(far)} candidates more than 2 sections away banned")

    if any("information gain" in f for f in failures):
        picked = {c.index for c in sel.abstract}
        ban |= picked
        reasons.append(f"{len(picked)} low-information abstract picks banned")

    # Anything else that still fired -- a residual reversal, chrome or section hit introduced by a
    # repair extension -- is answered by banning exactly the spans that carry it.
    for f in failures:
        for c in list(sel.abstract) + list(sel.highlights):
            snippet = c.text[:50]
            if snippet and snippet in f:
                ban.add(c.index)
                reasons.append(f"span {c.index} banned: {f[:60]}")

    return ban, "; ".join(reasons)
