#!/usr/bin/env python3
"""
Split a page into NUMBERED candidate sentences, so the model never types content.

WHY THIS EXISTS -- Arijit, 2026-08-08
  The previous design asked the model to COPY text verbatim, then checked the copy against the
  page. That is a transcription task, and LLMs are bad at transcription: GLM-5.2 wrote
  "10. August 2026" where the page said "August 2026", reworded a Walgreens sentence, and
  reformatted a CLI list. Each near-miss cost us the span, and my first response was to drop the
  span and move on.
  He rejected that, correctly: "just throwing away page because GLM is adding a word or two...
  does not solve our problem... I need every single record to be enriched."

  He is right. Dropping is a workaround. The ROOT CAUSE is asking a language model to retype text.

THE FIX
  A script splits the page into numbered candidates. The model sees:
      [12] The Algolia CLI lets you work with Algolia's APIs from your terminal.
  and returns ONLY numbers:
      {"abstract": [12, 15], "highlights": [18, 22]}
  The script then takes candidate 12 from ITS OWN list.

  The model emits no content whatsoever. Fabrication is not detected, it is UNREPRESENTABLE:
  an integer either indexes a real sentence from this page or it is out of range.

WHAT THIS ALSO KILLS
  Every false-rejection class we spent the session fighting, all at once -- curly apostrophes,
  a space before a comma, link labels wrapped across newlines, MDX props mid-sentence, missing
  spaces in the source HTML, invisible Unicode direction marks. None of it can matter any more,
  because nothing is being matched. Those records now succeed instead of being quarantined.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from span_gate import canonicalise, Canon  # noqa: E402

# Sentence end: . ! ? followed by whitespace and a capital/digit/quote. Abbreviations that must
# NOT end a sentence -- "Algolia vs. Coveo" split wrongly during an earlier bug.
_ABBREV = re.compile(
    r"(?:\b(?:vs|e\.g|i\.e|etc|approx|no|fig|vol|ch|sec|inc|ltd|corp|dept|st|mr|mrs|ms|dr|prof"
    r"|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.)$", re.I)
_SENT_END = re.compile(r"(?<=[.!?])\s+(?=[\"'“‘(\[]?[A-Z0-9])")

MIN_CHARS = 25          # shorter than this is a fragment, not a candidate
MAX_CHARS = 400         # longer than this is a run-on / un-split block


@dataclass
class Candidate:
    index: int
    text: str            # canonical text, sliced from the page. THE value that gets stored.
    original: str        # exact original substring
    start: int           # offset into the ORIGINAL markdown
    end: int
    section: str = ""
    section_index: int = 0
    is_quoted: bool = False
    followed_by: str = ""
    occurrences: int = 1

    # The existing gates (check_context etc.) were written against span_gate.Located. Exposing the
    # same two names here means they work unchanged on candidates -- no duplicated gate logic,
    # which is what would rot.
    @property
    def stored_text(self) -> str:
        return self.text

    @property
    def original_text(self) -> str:
        return self.original


# Two things that end in a period but are NOT sentence ends:
#   * abbreviations -- "Algolia vs. Coveo" was being cut in half
#   * a digit and a period -- list numbering, and German dates: "12. August 2026" was cut at "12."
# Both bugs appeared within a minute of writing the splitter, on the first real example.
# NOTE the .rstrip(): the lookbehind window ends AFTER the whitespace that triggered the match, so
# without stripping it the `$` anchor never matches and both guards silently do nothing.
_NUMBERED = re.compile(r"\d{1,4}\.$")


def _is_sentence_boundary(canon_text: str, pos: int) -> bool:
    tail = canon_text[max(0, pos - 14): pos].rstrip()
    return not _ABBREV.search(tail) and not _NUMBERED.search(tail)


MIN_CHARS = 25          # shorter than this is a fragment, not a candidate
MAX_CHARS = 400         # longer than this is a run-on / un-split block


@dataclass
class Candidate:
    index: int
    text: str            # canonical text, sliced from the page. THE value that gets stored.
    original: str        # exact original substring
    start: int           # offset into the ORIGINAL markdown
    end: int
    section: str = ""
    section_index: int = 0
    is_quoted: bool = False
    followed_by: str = ""
    occurrences: int = 1

    # The existing gates (check_context etc.) were written against span_gate.Located. Exposing the
    # same two names here means they work unchanged on candidates -- no duplicated gate logic,
    # which is what would rot.
    @property
    def stored_text(self) -> str:
        return self.text

    @property
    def original_text(self) -> str:
        return self.original


# A digit followed by a period is list numbering or a German date ("12. August 2026"), never the
# end of a sentence. Caught immediately: the splitter cut "12. | August 2026" in half.
_NUMBERED = re.compile(r"\b\d{1,4}\.$")


def _is_sentence_boundary(canon_text: str, pos: int) -> bool:
    tail = canon_text[max(0, pos - 12): pos]
    return not _ABBREV.search(tail) and not _NUMBERED.search(tail)


def split_candidates(markdown: str, max_candidates: int = 400) -> tuple[list[Candidate], Canon]:
    """Every selectable unit of the page, numbered. Offsets map back to the original markdown."""
    canon = canonicalise(markdown)
    text = canon.text
    cuts = [0]
    for m in _SENT_END.finditer(text):
        if _is_sentence_boundary(text, m.start()):
            cuts.append(m.end())
    cuts.append(len(text))

    out: list[Candidate] = []
    for a, b in zip(cuts, cuts[1:]):
        chunk = text[a:b].strip()
        if not chunk:
            continue
        # trim to the exact canonical span so offsets stay true
        lead = len(text[a:b]) - len(text[a:b].lstrip())
        c_start, c_end = a + lead, a + lead + len(chunk)
        if len(chunk) < MIN_CHARS:
            continue
        # Over-long chunks are SPLIT, never discarded. Dropping them lost most of the text on
        # link-heavy pages -- one 5,273-char page yielded only 4 candidates and the model then
        # correctly called it THIN, because everything real had been filtered away before it
        # could be chosen. Arijit: "I need every single record to be enriched."
        pieces: list[tuple[int, int]] = []
        if len(chunk) <= MAX_CHARS:
            pieces.append((c_start, c_end))
        else:
            s = c_start
            while s < c_end:
                e = min(s + MAX_CHARS, c_end)
                if e < c_end:                        # back off to a word boundary
                    cut = text.rfind(" ", s + MIN_CHARS, e)
                    if cut > s:
                        e = cut
                pieces.append((s, e))
                s = e + 1 if text[e:e + 1] == " " else e
        for ps, pe in pieces:
            piece = text[ps:pe].strip()
            if len(piece) < MIN_CHARS:
                continue
            lead2 = len(text[ps:pe]) - len(text[ps:pe].lstrip())
            a2, b2 = ps + lead2, ps + lead2 + len(piece)
            try:
                original, o_start, o_end = canon.slice_original(a2, b2)
            except (ValueError, IndexError):
                continue
            out.append(Candidate(
                index=len(out) + 1, text=piece, original=original, start=o_start, end=o_end,
                section=canon.section_title(a2),
                section_index=canon.section[a2] if canon.section else 0,
                is_quoted=any(canon.quoted[a2:b2]) if canon.quoted else False,
                followed_by=text[b2:b2 + 140].lstrip(),
            ))
            if len(out) >= max_candidates:
                break
        if len(out) >= max_candidates:
            break
    return out, canon


def render_menu(cands: list[Candidate]) -> str:
    """The numbered list the model chooses from. Section headers included so it has context."""
    lines: list[str] = []
    last_section = None
    for c in cands:
        if c.section != last_section:
            lines.append(f"\n--- section: {c.section or '(top of page)'} ---")
            last_section = c.section
        mark = " [QUOTED]" if c.is_quoted else ""
        lines.append(f"[{c.index}]{mark} {c.text}")
    return "\n".join(lines)


if __name__ == "__main__":
    import json
    md = Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else sys.stdin.read()
    cands, _ = split_candidates(md)
    print(f"{len(cands)} candidates")
    print(render_menu(cands)[:3000])


# ---------------------------------------------------------------------------
# selection gate: resolve model-returned NUMBERS into our own candidate text
# ---------------------------------------------------------------------------

@dataclass
class Selection:
    passed: bool
    abstract: list[Candidate] = field(default_factory=list)
    highlights: list[Candidate] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    out_of_range: list[int] = field(default_factory=list)


def resolve_selection(
    picked_abstract: list, picked_highlights: list, cands: list[Candidate],
    span_range: tuple[int, int] = (1, 4),
) -> Selection:
    """Turn integers into Candidates. THE guarantee, and it is now trivial.

    There is no text to verify. The model returned numbers; we look them up in the list WE built
    from the page. An out-of-range or non-integer index is a protocol error, not a fabrication --
    and it cannot put a single invented word anywhere near the output.
    """
    sel = Selection(passed=False)
    by_index = {c.index: c for c in cands}

    def take(picked, label) -> list[Candidate]:
        got: list[Candidate] = []
        seen: set[int] = set()
        for raw in picked or []:
            try:
                i = int(raw)
            except (TypeError, ValueError):
                sel.failures.append(f"{label} index {raw!r} is not an integer")
                continue
            if i not in by_index:
                sel.out_of_range.append(i)
                sel.failures.append(f"{label} index {i} is not on this page (1-{len(cands)})")
                continue
            if i in seen:
                continue
            seen.add(i)
            got.append(by_index[i])
        return got

    sel.abstract = take(picked_abstract, "abstract")
    sel.highlights = take(picked_highlights, "highlight")

    lo, hi = span_range
    if not (lo <= len(sel.abstract) <= hi):
        sel.failures.append(
            f"abstract has {len(sel.abstract)} valid picks, family needs {lo}-{hi}")
        return sel
    # a highlight that repeats an abstract pick adds nothing
    abstract_ids = {c.index for c in sel.abstract}
    sel.highlights = [c for c in sel.highlights if c.index not in abstract_ids][:8]
    sel.passed = True
    return sel
