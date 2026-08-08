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

WHAT IT DID NOT KILL -- 2026-08-08, second pass
  Zero invention was never the whole job. The two baseline runs (`reports/fresh50-run1`,
  `run2`) both scored judge coherence at **2.88 / 2.85 out of 5**, with REVISE on 19 of 34
  records, and the notes said the same thing over and over: the abstract is a CTA button welded
  to a subheading, or a countdown timer welded to a headline, or a sentence cut in half.

  Root cause, and it was one thing: `canonicalise()` collapses every newline to a space, so this
  file used to receive the page as one flat string and could only cut it at sentence-ending
  punctuation. A nav bar, a language switcher, a cookie banner and a "00 TAGE 00 STUNDEN" timer
  contain no such punctuation -- so they were never cut. They merged into one giant chunk, which
  then hit the MAX_CHARS branch and was chopped at an arbitrary word boundary. Measured across the
  50 cached pages: **715 of 2,264 candidates (31.6%) were mid-sentence fragments**, and the model
  had no way to tell any of them from a thesis sentence.

  So the menu is now built from BLOCKS (`Canon.block`) and every candidate is CLASSIFIED. Nothing
  is silently deleted for being ugly: a candidate is labelled, and the label is shown to the model.

  The distinction that matters: zero invention is a GUARANTEE, enforced by integer lookup.
  Selection quality is a JUDGEMENT, and a clean menu is how we improve the odds. Do not confuse
  the two, and do not let a passing gate be read as a good abstract.
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
# The list was English-only. The corpus is not: 3,887 records are de/fr, and the sources also
# carry es/it/pt. It cut "3,1 Mio. US-Dollar" in half on /de/competitors/compare-algolia-vs-
# constructor, and the back half -- "US-Dollar erzielte und E-Commerce-Teams dabei unterstützte,
# ..." -- was stored as a highlight and drew a judge REVISE. It starts with a capital and ends with
# a period, so neither shape check catches it; only knowing the abbreviation does.
#
# Fixing the one German word would have fixed one record. The class is "the splitter only speaks
# English", so the fix is the whole set, per language, plus single-letter initials (M. Dupont).
_ABBREV = re.compile(
    r"(?:\b(?:"
    # en
    r"vs|e\.g|i\.e|etc|approx|no|fig|vol|ch|sec|inc|ltd|corp|dept|st|mr|mrs|ms|dr|prof"
    r"|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
    # de -- Mio./Mrd. are the expensive ones, they appear in every revenue figure
    r"|mio|mrd|bzw|ca|evtl|ggf|inkl|exkl|max|min|z\.b|u\.a|d\.h|usw|nr|abb|bspw|sog|zzgl"
    # fr
    r"|env|cf|p\.ex|c\.-à-d|réf|éd|av|apr|boul|tél|M|Mme|Mlle"
    # es / it / pt
    r"|ej|pág|núm|sig|aprox|ecc|pag|num|sig\.ra|av\.da|obs"
    r")\.)$"
    # a single capital letter plus a period is an initial, never a sentence end
    r"|(?:\b[A-Z]\.)$", re.I)
_SENT_END = re.compile(r"(?<=[.!?])\s+(?=[\"'“‘(\[]?[A-Z0-9])")

MIN_CHARS = 25          # shorter than this is a fragment, not a candidate
MAX_CHARS = 400         # longer than this is a run-on / un-split block

# Two things that end in a period but are NOT sentence ends:
#   * abbreviations -- "Algolia vs. Coveo" was being cut in half
#   * a digit and a period -- list numbering, and German dates: "12. August 2026" was cut at "12."
# Both bugs appeared within a minute of writing the splitter, on the first real example.
#
# There were TWO copies of this guard, and of MIN_CHARS/MAX_CHARS/Candidate, in this file. The
# second won. One copy carried a `.rstrip()` and a comment insisting it was load-bearing; the other
# did not. Neither is: split_candidates passes `m.start()`, which sits BEFORE the whitespace that
# triggered the match, so `$` anchors correctly either way. Checked before deleting rather than
# after -- the dead copy is gone, the live one is this.
_NUMBERED = re.compile(r"\b\d{1,4}\.$")

_TERMINAL = '.!?:'
_CLOSERS = "\"'’”)]»"

KIND_PROSE = "prose"
KIND_HEADING = "heading"
KIND_UI = "ui"
KIND_NONPROSE = "nonprose"
KIND_FRAGMENT = "fragment"
KIND_BOILERPLATE = "boilerplate"   # G8; needs corpus evidence, see boilerplate.py

# --- non-prose detection: markup and data that survived into the text -----------------------
#
# The `auth-wall` fetch path stores RAW HTML in the `markdown` field -- 5 of the 50 cached pages.
# One academy page's whole candidate list was <meta> attributes and a JSON feature-flag blob. Every
# slice of it was verbatim, offset-verified and gate-passing, and every slice was garbage. That is
# `verbatim-does-not-mean-truthful` reappearing one layer earlier than we met it last time.
_JSON_ISH = re.compile(r'"\s*:\s*(?:true|false|null|\d|["{\[])|"\s*\}|\}\s*,\s*\{')
_ATTR_ISH = re.compile(r"""[\w:-]+\s*=\s*['"]|</?\s*[a-zA-Z][\w-]*[\s/>]|&[a-z]{2,6};""")
_CODE_ISH = re.compile(r"=>|\bfunction\s*\(|\bvar\s+\w+\s*=|\bconst\s+\w+\s*=|\)\s*\{|;\s*$")
_SCHEME = re.compile(r"https?://")


def _letter_ratio(s: str) -> float:
    if not s:
        return 0.0
    return sum(1 for ch in s if ch.isalpha() or ch.isspace()) / len(s)


def _ends_sentence(s: str) -> bool:
    t = s.rstrip()
    while t and t[-1] in _CLOSERS:
        t = t[:-1]
    return bool(t) and t[-1] in _TERMINAL


def _is_nonprose(s: str) -> bool:
    if _JSON_ISH.search(s) or _ATTR_ISH.search(s) or _CODE_ISH.search(s):
        return True
    if len(_SCHEME.findall(s)) >= 2:
        return True
    return _letter_ratio(s) < 0.72


def _is_ui(s: str, complete: bool) -> bool:
    """Chrome. Deliberately structural, never a word list -- the corpus is en/de/fr/es/it/pt.

    A CTA, a nav label, an all-caps banner and a timer segment share a shape: few words, no
    sentence punctuation. 'Loslegen Demo buchen', 'CLAIM YOUR SPOT', 'Fermer', 'Merci!' and
    '00 TAGE 00 STUNDEN' all match on shape alone, in five languages, with no vocabulary.
    """
    words = s.split()
    letters = [ch for ch in s if ch.isalpha()]
    if letters and sum(1 for ch in letters if ch.isupper()) / len(letters) > 0.8 and len(s) < 80:
        return True                                        # WILLKOMMEN BEI / CLAIM YOUR SPOT
    if re.match(r"^\d{1,4}\b", s) and len(words) <= 6 and not complete:
        return True                                        # 00 TAGE 00 STUNDEN 00 Sekunden
    return len(words) <= 8 and not complete


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
    # Set by classify(). `kind` is advice to the model, shown in the menu; `sentence_complete` is
    # the fact it is derived from. Neither restricts what can be picked -- see the module note on
    # guarantee vs judgement.
    kind: str = KIND_PROSE
    sentence_complete: bool = True
    block: int = 0

    # The existing gates (check_context etc.) were written against span_gate.Located. Exposing the
    # same two names here means they work unchanged on candidates -- no duplicated gate logic,
    # which is what would rot.
    @property
    def stored_text(self) -> str:
        return self.text

    @property
    def original_text(self) -> str:
        return self.original


def _is_sentence_boundary(canon_text: str, pos: int) -> bool:
    tail = canon_text[max(0, pos - 12): pos]
    return not _ABBREV.search(tail) and not _NUMBERED.search(tail)


def _block_ranges(canon: Canon) -> list[tuple[int, int]]:
    """Contiguous runs of equal Canon.block. One source block, one range."""
    n = len(canon.text)
    if not canon.block or len(canon.block) < n:
        return [(0, n)] if n else []
    out: list[tuple[int, int]] = []
    start = 0
    for i in range(1, n):
        if canon.block[i] != canon.block[i - 1]:
            out.append((start, i))
            start = i
    if start < n:
        out.append((start, n))
    return out


def norm_key(text: str) -> str:
    """Sentence identity for the G8 map. Must match boilerplate.norm_key exactly."""
    return " ".join((text or "").lower().split())


def classify(text: str, complete: bool, section_title: str,
             boilerplate: set[str] | None = None) -> str:
    # G8 first: corpus evidence beats shape. A site-wide promo block IS well-formed prose, so
    # every shape test correctly calls it prose and only "it is on 11 other pages" refutes that.
    if boilerplate and norm_key(text) in boilerplate:
        return KIND_BOILERPLATE
    if _is_nonprose(text):
        return KIND_NONPROSE
    if section_title and text.strip() == section_title.strip():
        return KIND_HEADING
    if _is_ui(text, complete):
        return KIND_UI
    if not complete:
        return KIND_FRAGMENT
    return KIND_PROSE


def split_candidates(markdown: str, max_candidates: int = 400,
                     boilerplate: set[str] | None = None) -> tuple[list[Candidate], Canon]:
    """Every selectable unit of the page, numbered. Offsets map back to the original markdown.

    Order: BLOCK -> sentence -> MAX_CHARS piece. The block step is what stops a timer merging
    with the headline after it; the sentence step is unchanged; the MAX_CHARS step now records
    that it produced a fragment instead of leaving it indistinguishable from a real sentence.
    """
    canon = canonicalise(markdown)
    text = canon.text
    out: list[Candidate] = []

    for b_start, b_end in _block_ranges(canon):
        if b_end - b_start < MIN_CHARS:
            continue
        cuts = [b_start]
        for m in _SENT_END.finditer(text, b_start, b_end):
            if _is_sentence_boundary(text, m.start()):
                cuts.append(m.end())
        cuts.append(b_end)

        for a, b in zip(cuts, cuts[1:]):
            chunk = text[a:b].strip()
            if not chunk:
                continue
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

            was_chopped = len(pieces) > 1
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
                # A chop is a fragment by construction: only the first piece begins where a
                # sentence began, only the last ends where one ended, and the middle does neither.
                complete = (not was_chopped) and _ends_sentence(piece)
                section = canon.section_title(a2)
                out.append(Candidate(
                    index=len(out) + 1, text=piece, original=original, start=o_start, end=o_end,
                    section=section,
                    section_index=canon.section[a2] if canon.section else 0,
                    is_quoted=any(canon.quoted[a2:b2]) if canon.quoted else False,
                    followed_by=text[b2:b2 + 140].lstrip(),
                    kind=classify(piece, complete, section, boilerplate),
                    sentence_complete=complete,
                    block=canon.block[a2] if canon.block else 0,
                ))
                if len(out) >= max_candidates:
                    return out, canon
    return out, canon


_LABEL = {
    KIND_UI: " [UI]",
    KIND_NONPROSE: " [NONPROSE]",
    KIND_FRAGMENT: " [FRAGMENT]",
    KIND_HEADING: " [HEADING]",
    KIND_BOILERPLATE: " [BOILERPLATE]",
    KIND_PROSE: "",
}


def render_menu(cands: list[Candidate]) -> str:
    """The numbered list the model chooses from. Section headers included so it has context.

    Prose is shown bare. Everything else carries its label, because the model previously could
    not tell a CTA button from a thesis sentence -- and picked the button.
    """
    lines: list[str] = []
    last_section = None
    for c in cands:
        if c.section != last_section:
            lines.append(f"\n--- section: {c.section or '(top of page)'} ---")
            last_section = c.section
        mark = _LABEL.get(c.kind, "")
        if c.is_quoted:
            mark += " [QUOTED]"
        lines.append(f"[{c.index}]{mark} {c.text}")
    return "\n".join(lines)


if __name__ == "__main__":
    import json
    md = Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else sys.stdin.read()
    cands, _ = split_candidates(md)
    counts: dict[str, int] = {}
    for c in cands:
        counts[c.kind] = counts.get(c.kind, 0) + 1
    print(f"{len(cands)} candidates  {json.dumps(counts, sort_keys=True)}")
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
