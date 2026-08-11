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
from span_gate import canonicalise, Canon, is_speech  # noqa: E402

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
# The sibling of the _ABBREV bug above, and the same class: the splitter only spoke English.
# [A-Z0-9] is ASCII-only, so a sentence starting with an accented capital was never recognised
# as a sentence start and the two sentences were kept as one over-long span -- which MAX_CHARS
# then discarded. Measured 2026-08-10 on the case-study slice: 154 of 237 records (65%) are
# de/fr, and this path had never run, because Blog served English on /de/ and /fr/.
# Build the class from unicodedata rather than hand-listing: hand-listing is how the
# abbreviation set got it wrong the first time. Latin-1 Supplement + Latin Extended-A/B.
_UPPER = "".join(c for c in map(chr, range(0x20, 0x0250)) if c.isupper())
_SENT_END = re.compile(
    r"(?<=[.!?])\s+(?=[\"'“‘(\[]?[" + re.escape(_UPPER) + r"0-9])")

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

# A line that OPENS with a URL is an endpoint row, not a sentence about anything. Until the lede
# fix below, the only thing keeping these out of abstracts was the [FRAGMENT] label they earned
# for having no full stop -- "https://analytics.algolia.com (routes requests to the closest of the
# above servers)" carries one scheme, so the >=2 test misses it, and enough words in the
# parenthetical to clear the letter-ratio floor. Unlocking fragments without this would have
# promoted every base-URL row in the reference family straight into the candidate pool.
_LEADING_URL = re.compile(r"^\s*(?:https?://|https?//|www\.)", re.I)

# The blockquote directly under the page's H1. On the `doc-md-twin` path -- 4,337 of the 10,198
# enrichable records -- that is where the page states what it is, and it is the sentence the
# `reference` family instruction asks the abstract to lead with.
_PAGE_LEDE_QUOTE = re.compile(r"^#[ \t]+\S.*\n+((?:[ \t]*>.*(?:\n|$))+)", re.M)


def page_lede_quote_range(markdown: str) -> tuple[int, int] | None:
    """Character range of the page's own description, or None.

    POSITIONAL ON PURPOSE, and the position is the whole point. A doc-md-twin page wraps two
    unrelated things in blockquotes:

        > ## Documentation Index          <- site-wide furniture, ABOVE the H1
        > Use this file to discover all available pages before exploring further.

        # API clients                     <- the page

        > The API client libraries let you use Algolia's APIs ...   <- its own description, BELOW

    The obvious fix -- label [QUOTED] only when the span is real speech, matching what G10 already
    does -- was measured before being written and would have released that furniture into the
    abstract pool on all 4,337 pages. G8 corpus-wide boilerplate detection is currently OFF, so
    nothing downstream would have caught it, and pages described in terms of furniture is exactly
    the /fr/awards failure. Only what follows the H1 is the page talking about itself.

    Verified on the 50-page calibration cache: matches 50 of 50 pages, captures the Documentation
    Index block 0 times.
    """
    m = _PAGE_LEDE_QUOTE.search(markdown)
    return (m.start(1), m.end(1)) if m else None

# Punctuation that says the clause continues past where the text stops. Trailing ',' is the
# glossary case: "...such as NeuralSearch," is a genuinely truncated definition that happens to be
# the only chunk in its block. Kept to punctuation on purpose -- a conjunction word list would be
# English-only, and the corpus is en/de/fr/es/it/pt.
_DANGLING = ",;-–—/&+"


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
    if _LEADING_URL.match(s):
        return True
    if len(_SCHEME.findall(s)) >= 2:
        return True
    return _letter_ratio(s) < 0.72


def _dangles(s: str) -> bool:
    """The text stops mid-clause. Structural, punctuation-only, language-independent."""
    t = s.rstrip()
    return bool(t) and t[-1] in _DANGLING


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
    is_quoted: bool = False      # came from a blockquote
    is_page_lede: bool = False   # ...and that blockquote is the page's own description, under the H1
    is_already_indexed: bool = False  # byte-equal to a field the record already stores
    followed_by: str = ""
    occurrences: int = 1
    # Set by classify(). `kind` is advice to the model, shown in the menu; `sentence_complete` is
    # the fact it is derived from. Neither restricts what can be picked -- see the module note on
    # guarantee vs judgement.
    kind: str = KIND_PROSE
    sentence_complete: bool = True
    block: int = 0

    # Offsets into the CANONICAL text, i.e. into `Canon.text`, which is the space `text` lives in.
    # `start`/`end` above point into the ORIGINAL markdown and are what verification re-slices.
    #
    # These exist so an incomplete span can be repaired by EXTENDING it over the page's own
    # following words: `canon.text[a.canon_start:b.canon_end]` is one contiguous slice of the page,
    # so the repaired value contains no character the page does not contain, in the order the page
    # has them. That is the only repair this pipeline is allowed to perform -- adding a full stop
    # the page does not have would be writing text, which is the thing the whole design forbids.
    canon_start: int = -1
    canon_end: int = -1

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


def _is_whole_unit(text: str, complete: bool, standalone: bool) -> bool:
    """Is this a finished thought?

    Terminal punctuation is one way to know. It is not the only way, and treating it as the only
    way cost the `reference` family 18 of its 50 calibration pages: a markdown lede -- the API's
    own one-line statement of what it does -- is its whole block and carries no full stop, so it
    was labelled [FRAGMENT] and the prompt forbids picking marked entries. The family instruction
    asks the abstract to lead with exactly that sentence, so the model had nothing legal to pick
    and returned THIN.

    `standalone` is the structural evidence: the block produced exactly ONE chunk, so the text
    begins where the block begins and ends where it ends. Nothing was cut. That holds in every
    language, which a punctuation or capitalisation shape test does not.

    The uppercase test is a DISQUALIFIER on the new path only -- it can never promote anything,
    it can only hold something back. Measured: releasing standalone blocks without it let six
    lines into the prose pool, five of them code the _CODE_ISH pattern misses
    ("client.execute { index into ... }", "algolia objects update INDEX_NAME --dry-run") and one a
    truncated clause ending in "that". All six begin lowercase; published prose in en/de/fr/es/it/pt
    does not. This is the inverse of the monolingual-regex trap: capital-start is useless as proof
    that something IS a sentence, and reliable as proof that a lone block is NOT one. A rare lede
    like "iOS clients support..." stays a fragment, which costs a candidate rather than corrupting
    an abstract.

    A trailing COLON is excluded from the standalone path, added 2026-08-09. A colon promises a
    list, and the block that follows is a different block, so the promise never arrives in the
    span. "There are several additional benefits:" is structurally a whole block and semantically
    half a thought; joined into a multi-span abstract it reads as a run-on. Measured on the blog
    run: 64 of 2,065 writable rows (3.1%) carried an unterminated span, colon lead-ins being the
    larger half. It is checked here rather than in `_dangles` because `_dangles` describes
    punctuation that says the CLAUSE continues, and a colon ends its clause perfectly well.
    """
    # BEFORE the `complete` shortcut, not after. `_TERMINAL` is ".!?:" -- a colon counts as
    # sentence-ending punctuation for the splitter, so `_ends_sentence("...benefits:")` is True and
    # `complete` arrives here True. A colon check placed after the shortcut is dead code, which is
    # how the first version of this fix passed its own unit test (it was handed complete=False)
    # while changing nothing about the 47 real records.
    if text.rstrip().endswith(":"):
        return False
    if complete:
        return True
    return standalone and not _dangles(text) and text[:1].isupper()


# Brackets that a markdown link uses. Tracked as a stack rather than a count: the blog run threw
# up a span with one orphaned `]` early and one orphaned `[` late, so the totals matched while
# both halves were damaged.
def has_broken_brackets(text: str) -> bool:
    """True when a square bracket in this span is unmatched, in order.

    WHY THIS IS NOT `"[" in text`
      `canonicalise` unwraps `[label](url)` to `label`. If the label contains a full stop the
      sentence splitter cuts inside it and the `[` is orphaned -- "in this [new episode of the AI
      Today podcast." That is real leakage: a stray bracket in user-facing text, and a sentence
      truncated at a link boundary.

      But square brackets are also ordinary prose. Codex's detector was
      `"[" in text and "](" not in text`, and on the blog output it produced 17 hits of which 11
      were legitimate: `--admin-api-key [string]`, `range of [0,1]`, `["ignorePlurals", ...]`, and
      an editorial `[with enterprise search are]` inside a quotation. Quarantining those would
      have discarded correct enrichment on the strength of a punctuation mark.

      Balance is the signal, and it has to respect order.
    """
    depth = 0
    for ch in text:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth < 0:          # a closer with nothing open before it
                return True
    return depth != 0


def classify(text: str, complete: bool, section_title: str,
             boilerplate: set[str] | None = None, standalone: bool = False) -> str:
    # G8 first: corpus evidence beats shape. A site-wide promo block IS well-formed prose, so
    # every shape test correctly calls it prose and only "it is on 11 other pages" refutes that.
    if boilerplate and norm_key(text) in boilerplate:
        return KIND_BOILERPLATE
    if _is_nonprose(text):
        return KIND_NONPROSE
    if section_title and text.strip() == section_title.strip():
        return KIND_HEADING
    # _is_ui keeps the punctuation-only `complete`, deliberately. Its prose proxy is
    # "few words AND no sentence punctuation", and a nav label is a standalone block too --
    # passing the relaxed fact in here would leak "Get started with the Algolia Crawler"
    # into the abstract pool. Chrome is caught first, then the lede is released.
    if _is_ui(text, complete):
        return KIND_UI
    # A span cut inside a markdown link is not a unit of anything. Marked FRAGMENT rather than
    # given its own kind so the existing prompt rule -- "do not pick marked entries" -- applies
    # without a prompt change, and so no gate has to learn a new label.
    if has_broken_brackets(text):
        return KIND_FRAGMENT
    if not _is_whole_unit(text, complete, standalone):
        return KIND_FRAGMENT
    return KIND_PROSE


def split_candidates(markdown: str, max_candidates: int = 400,
                     boilerplate: set[str] | None = None,
                     already_indexed: str | None = None) -> tuple[list[Candidate], Canon]:
    """Every selectable unit of the page, numbered. Offsets map back to the original markdown.

    Order: BLOCK -> sentence -> MAX_CHARS piece. The block step is what stops a timer merging
    with the headline after it; the sentence step is unchanged; the MAX_CHARS step now records
    that it produced a fragment instead of leaving it indistinguishable from a real sentence.
    """
    canon = canonicalise(markdown)
    text = canon.text
    out: list[Candidate] = []
    lede_range = page_lede_quote_range(markdown)
    # Compared on norm_key so a missing full stop or different casing cannot hide the duplicate:
    # the page lede carries no terminal period and the stored `description` often does.
    indexed_key = norm_key((already_indexed or "").rstrip(".")) if already_indexed else ""

    for b_start, b_end in _block_ranges(canon):
        if b_end - b_start < MIN_CHARS:
            continue
        cuts = [b_start]
        for m in _SENT_END.finditer(text, b_start, b_end):
            if _is_sentence_boundary(text, m.start()):
                cuts.append(m.end())
        cuts.append(b_end)

        # Exactly one chunk means this block was never divided: no internal sentence end, so the
        # chunk spans the block edge to edge. That is what licenses a period-less lede as prose.
        sole_chunk_in_block = len(cuts) == 2

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
                standalone = (not was_chopped) and sole_chunk_in_block
                whole = _is_whole_unit(piece, complete, standalone)
                section = canon.section_title(a2)
                out.append(Candidate(
                    index=len(out) + 1, text=piece, original=original, start=o_start, end=o_end,
                    section=section,
                    section_index=canon.section[a2] if canon.section else 0,
                    is_quoted=any(canon.quoted[a2:b2]) if canon.quoted else False,
                    # offsets are into the ORIGINAL markdown, which is what lede_range measures
                    is_page_lede=bool(lede_range and lede_range[0] <= o_start < lede_range[1]),
                    is_already_indexed=bool(indexed_key
                                            and norm_key(piece.rstrip(".")) == indexed_key),
                    followed_by=text[b2:b2 + 140].lstrip(),
                    kind=classify(piece, complete, section, boilerplate, standalone),
                    sentence_complete=whole,
                    block=canon.block[a2] if canon.block else 0,
                    canon_start=a2, canon_end=b2,
                ))
                if len(out) >= max_candidates:
                    return _guard_boilerplate(out), canon
    return _guard_boilerplate(out), canon


# A page may exceed this share of its prose being boilerplate only if the boilerplate IS its
# subject. 0.5 is the measured line: /fr/awards lost 87% of its prose to G8 and went THIN, while
# a normal page carrying the same footer loses a handful of sentences out of dozens.
G8_MAX_PROSE_SHARE = 0.5


def _guard_boilerplate(cands: list[Candidate]) -> list[Candidate]:
    """Undo G8 on a page where the boilerplate is the page's own content.

    THE BUG THIS FIXES, measured 2026-08-08 and confirmed by Arijit's review:
      A sentence can be furniture on ten pages and be the CONTENT on the eleventh -- the page it
      is actually about. `/fr/awards` is a page about Algolia's awards. Its award sentences also
      sit in ten other pages' footers, so G8 marked them boilerplate; the page fell from 8 prose
      candidates to 1 and the model correctly called it THIN. Four records were lost that way and
      the run scored WORSE than no G8 at all (coherence 4.21 vs 4.62, PASS 20 vs 25).

      G8 was right about the sentences and wrong about the page. The share of a page's prose that
      the map claims is the signal: a normal page loses a footer, an awards page loses itself.
    """
    marked = [c for c in cands if c.kind == KIND_BOILERPLATE]
    if not marked:
        return cands
    prose_if_kept = sum(1 for c in cands if c.kind == KIND_PROSE)
    total_prose = prose_if_kept + len(marked)
    if total_prose and len(marked) / total_prose > G8_MAX_PROSE_SHARE:
        # This page IS the boilerplate's home. Hand its sentences back as ordinary prose.
        for c in marked:
            c.kind = KIND_PROSE if c.sentence_complete else KIND_FRAGMENT
    return cands


_LABEL = {
    KIND_UI: " [UI]",
    KIND_NONPROSE: " [NONPROSE]",
    KIND_FRAGMENT: " [FRAGMENT]",
    KIND_HEADING: " [HEADING]",
    KIND_BOILERPLATE: " [BOILERPLATE]",
    KIND_PROSE: "",
}


def render_menu(cands: list[Candidate], no_open: set[int] | None = None) -> str:
    """The numbered list the model chooses from. Section headers included so it has context.

    Prose is shown bare. Everything else carries its label, because the model previously could
    not tell a CTA button from a thesis sentence -- and picked the button.

    `no_open` marks candidates that cannot legally be the abstract's FIRST span -- they open with
    "It"/"They"/"This" and name no subject, so they say nothing in a result list. The defect is
    positional, not intrinsic: the same sentence is a fine span 2. So it is LABELLED here and only
    banned outright on the retry that a subject failure triggers. Deleting it from the menu
    outright would throw away legitimate sentences to prevent one bad opening.
    """
    no_open = no_open or set()
    lines: list[str] = []
    last_section = None
    for c in cands:
        if c.section != last_section:
            lines.append(f"\n--- section: {c.section or '(top of page)'} ---")
            last_section = c.section
        mark = _LABEL.get(c.kind, "")
        # [QUOTED] tells the model "someone else is speaking, do not pick this". The page's own
        # description under the H1 is not that, and G10 already agrees -- is_speech() is the one
        # definition both use. Real speech keeps the label even in the lede slot.
        if c.is_quoted and not (c.is_page_lede and not is_speech(c.original, c.text)):
            mark += " [QUOTED]"
        # The record already stores this sentence, so selecting it enriches nothing. Marked rather
        # than dropped: the model should see that the page said it and that it is spoken for.
        if c.is_already_indexed:
            mark += " [ALREADY INDEXED]"
        if c.index in no_open:
            mark += " [NOT-FIRST]"
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

    # PAGE ORDER, not the order the model happened to return.
    #
    # The abstract is joined with spaces and read as one paragraph, so the order is part of the
    # text. Nothing sorted it: `take` appended in the model's pick order and span_gate joined that
    # straight through. Arijit caught it on the DevCon record in the first human review -- "the
    # summary's sentences appear in reverse page order" -- and he was right; the prompt has always
    # asked for page order and nothing enforced it. Sorting here keeps the stored spans and
    # `span_offsets` aligned, because both are derived from this list downstream.
    #
    # Highlights are sorted too. Each is read alone so it matters less, but a stable page-ordered
    # list is one fewer thing that varies between two runs of a model that is only 19/50
    # reproducible.
    sel.abstract.sort(key=lambda c: c.start)
    sel.highlights.sort(key=lambda c: c.start)

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
