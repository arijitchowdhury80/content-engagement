"""Split a page into NUMBERED candidate sentences, so the model never types content.

THE CONTRACT
  The script splits the page into numbered candidates. The model sees

      [12] The Algolia CLI lets you work with Algolia's APIs from your terminal.

  and returns ONLY numbers: {"abstract": [12, 15], "highlights": [18, 22]}. The script then
  takes candidate 12 from ITS OWN list.

  The model emits no content whatsoever. Fabrication is not detected, it is UNREPRESENTABLE:
  an integer either indexes a real sentence from this page or it is out of range. This replaced
  a copy-the-text design that lost whole records to transcription slips.

WHY THE MENU IS BUILT FROM BLOCKS
  `canonicalise()` collapses every newline to a space. Given the page as one flat string, the
  splitter can only cut at sentence-ending punctuation -- and a nav bar, a language switcher, a
  cookie banner and a "00 TAGE 00 STUNDEN" timer contain none. They merged into one giant chunk
  which then hit MAX_CHARS and was chopped at an arbitrary word boundary: 31.6% of all candidates
  were mid-sentence fragments and the model had no way to tell any of them from a thesis sentence.

  So the menu is built from `Canon.block` and every candidate is CLASSIFIED. Nothing is silently
  deleted for being ugly: a candidate is labelled, and the label is shown to the model.

  Zero invention is a GUARANTEE, enforced by integer lookup. Selection quality is a JUDGEMENT,
  and a clean menu is how we improve the odds. Do not confuse the two, and do not let a passing
  gate be read as a good abstract.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .canonical import Canon, canonicalise, is_speech

# Sentence end: . ! ? followed by whitespace and a capital/digit/quote. Abbreviations that must
# NOT end a sentence.
#
# The list was English-only, and the corpus is not. It cut "3,1 Mio. US-Dollar" in half on a
# German page and the back half was stored as a highlight. It starts with a capital and ends with
# a period, so neither shape check catches it; only knowing the abbreviation does. Fixing the one
# German word would have fixed one record -- the CLASS is "the splitter only speaks English", so
# the fix is the whole set, per language, plus single-letter initials (M. Dupont).
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

# The sibling of the _ABBREV bug, and the same class: the splitter only spoke English.
# [A-Z0-9] is ASCII-only, so a sentence starting with an accented capital was never recognised as
# a sentence start and the two sentences were kept as one over-long span -- which MAX_CHARS then
# discarded. 154 of the 237 case-study records (65%) are de/fr and that path had never run,
# because Blog served English on /de/ and /fr/.
#
# Build the class from unicodedata rather than hand-listing: hand-listing is how the abbreviation
# set got it wrong the first time. Latin-1 Supplement + Latin Extended-A/B.
_UPPER = "".join(c for c in map(chr, range(0x20, 0x0250)) if c.isupper())
_SENT_END = re.compile(
    r"(?<=[.!?])\s+(?=[\"'“‘(\[]?[" + re.escape(_UPPER) + r"0-9])")

MIN_CHARS = 25          # shorter than this is a fragment, not a candidate
MAX_CHARS = 400         # longer than this is a run-on / un-split block

# Two things that end in a period but are NOT sentence ends: abbreviations, and a digit plus a
# period -- list numbering, and German dates ("12. August 2026" was cut at "12.").
_NUMBERED = re.compile(r"\b\d{1,4}\.$")

_TERMINAL = '.!?:'
_CLOSERS = "\"'’”)]»"

KIND_PROSE = "prose"
KIND_HEADING = "heading"
KIND_UI = "ui"
KIND_NONPROSE = "nonprose"
KIND_FRAGMENT = "fragment"
KIND_BOILERPLATE = "boilerplate"

# --- non-prose detection: markup and data that survived into the text ----------------------
#
# One academy page's whole candidate list was <meta> attributes and a JSON feature-flag blob.
# Every slice of it was verbatim, offset-verified and gate-passing, and every slice was garbage:
# verbatim-does-not-mean-truthful, one layer earlier than we usually meet it.
_JSON_ISH = re.compile(r'"\s*:\s*(?:true|false|null|\d|["{\[])|"\s*\}|\}\s*,\s*\{')
_ATTR_ISH = re.compile(r"""[\w:-]+\s*=\s*['"]|</?\s*[a-zA-Z][\w-]*[\s/>]|&[a-z]{2,6};""")
_CODE_ISH = re.compile(r"=>|\bfunction\s*\(|\bvar\s+\w+\s*=|\bconst\s+\w+\s*=|\)\s*\{|;\s*$")
_SCHEME = re.compile(r"https?://")

# A line that OPENS with a URL is an endpoint row, not a sentence about anything.
_LEADING_URL = re.compile(r"^\s*(?:https?://|https?//|www\.)", re.I)

# The blockquote directly under the page's H1 -- where a page states what it is.
_PAGE_LEDE_QUOTE = re.compile(r"^#[ \t]+\S.*\n+((?:[ \t]*>.*(?:\n|$))+)", re.M)


def page_lede_quote_range(markdown: str) -> tuple[int, int] | None:
    """Character range of the page's own description, or None.

    POSITIONAL ON PURPOSE, and the position is the whole point. A doc page wraps two unrelated
    things in blockquotes: site-wide furniture ABOVE the H1, and the page's own description
    BELOW it. Labelling by speech-shape instead would release that furniture into the abstract
    pool on every doc page.
    """
    m = _PAGE_LEDE_QUOTE.search(markdown)
    return (m.start(1), m.end(1)) if m else None


# Punctuation that says the clause continues past where the text stops. Kept to punctuation on
# purpose -- a conjunction word list would be English-only, and the corpus is en/de/fr/es/it/pt.
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
    is_page_lede: bool = False   # ...and that blockquote is the page's own description
    is_already_indexed: bool = False  # byte-equal to a field the record already stores
    followed_by: str = ""
    occurrences: int = 1
    kind: str = KIND_PROSE
    sentence_complete: bool = True
    block: int = 0

    # Offsets into the CANONICAL text. `start`/`end` above point into the ORIGINAL markdown and
    # are what verification re-slices.
    #
    # These exist so an incomplete span can be repaired by EXTENDING it over the page's own
    # following words: `canon.text[a.canon_start:b.canon_end]` is one contiguous slice of the
    # page, so the repaired value contains no character the page does not contain, in the order
    # the page has them. That is the only repair this pipeline is allowed to perform -- adding a
    # full stop the page does not have would be writing text.
    canon_start: int = -1
    canon_end: int = -1

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
    """Sentence identity for the boilerplate map. Must match filters.norm_key exactly."""
    return " ".join((text or "").lower().split())


def _is_whole_unit(text: str, complete: bool, standalone: bool) -> bool:
    """Is this a finished thought?

    Terminal punctuation is one way to know. It is not the only way, and treating it as the only
    way cost the reference family 18 of its 50 calibration pages: a markdown lede -- the API's own
    one-line statement of what it does -- is its whole block and carries no full stop, so it was
    labelled [FRAGMENT] and the prompt forbids picking marked entries. The family instruction asks
    the abstract to lead with exactly that sentence, so the model had nothing legal to pick.

    `standalone` is the structural evidence: the block produced exactly ONE chunk, so the text
    begins where the block begins and ends where it ends. That holds in every language, which a
    punctuation or capitalisation shape test does not.

    The uppercase test is a DISQUALIFIER on the standalone path only -- it can never promote
    anything. Releasing standalone blocks without it let six lines into the prose pool, five of
    them code the _CODE_ISH pattern misses and one a truncated clause. All six begin lowercase;
    published prose in en/de/fr/es/it/pt does not. Capital-start is useless as proof that
    something IS a sentence, and reliable as proof that a lone block is NOT one.
    """
    # BEFORE the `complete` shortcut, not after. `_TERMINAL` is ".!?:" -- a colon counts as
    # sentence-ending punctuation for the splitter, so `complete` arrives here True for
    # "...benefits:". A colon check placed after the shortcut is dead code, which is how the first
    # version of this fix passed its own unit test while changing nothing about the real records.
    if text.rstrip().endswith(":"):
        return False
    if complete:
        return True
    return standalone and not _dangles(text) and text[:1].isupper()


def has_broken_brackets(text: str) -> bool:
    """True when a square bracket in this span is unmatched, in order.

    NOT `"[" in text`. `canonicalise` unwraps `[label](url)` to `label`; if the label contains a
    full stop the splitter cuts inside it and the `[` is orphaned -- real leakage. But square
    brackets are also ordinary prose: `--admin-api-key [string]`, `range of [0,1]`. A naive
    detector produced 17 hits on the Blog output of which 11 were legitimate. Balance is the
    signal, and it has to respect order -- one orphaned `]` early and one orphaned `[` late
    makes the totals match while both halves are damaged.
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
    # Corpus evidence beats shape. A site-wide promo block IS well-formed prose, so every shape
    # test correctly calls it prose and only "it is on 11 other pages" refutes that.
    if boilerplate and norm_key(text) in boilerplate:
        return KIND_BOILERPLATE
    if _is_nonprose(text):
        return KIND_NONPROSE
    if section_title and text.strip() == section_title.strip():
        return KIND_HEADING
    # _is_ui keeps the punctuation-only `complete`, deliberately. Its prose proxy is "few words
    # AND no sentence punctuation", and a nav label is a standalone block too -- passing the
    # relaxed fact in here would leak "Get started with the Algolia Crawler" into the pool.
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
    with the headline after it; the sentence step is the splitter; the MAX_CHARS step records
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
            # link-heavy pages -- one 5,273-char page yielded 4 candidates and the model then
            # correctly called it THIN, because everything real had been filtered away before it
            # could be chosen.
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
                # sentence began, only the last ends where one ended, the middle does neither.
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
# subject. 0.5 is the measured line: an awards page lost 87% of its prose and went THIN, while a
# normal page carrying the same footer loses a handful of sentences out of dozens.
G8_MAX_PROSE_SHARE = 0.5


def _guard_boilerplate(cands: list[Candidate]) -> list[Candidate]:
    """Undo the boilerplate mark on a page where the boilerplate IS the page's own content.

    A sentence can be furniture on ten pages and be the CONTENT on the eleventh -- the page it is
    actually about. The share of a page's prose that the map claims is the signal: a normal page
    loses a footer, an awards page loses itself.
    """
    marked = [c for c in cands if c.kind == KIND_BOILERPLATE]
    if not marked:
        return cands
    prose_if_kept = sum(1 for c in cands if c.kind == KIND_PROSE)
    total_prose = prose_if_kept + len(marked)
    if total_prose and len(marked) / total_prose > G8_MAX_PROSE_SHARE:
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
    """The numbered list the model chooses from. Section headers included for context.

    Prose is shown bare. Everything else carries its label, because the model previously could
    not tell a CTA button from a thesis sentence -- and picked the button.

    `no_open` marks candidates that cannot legally be the abstract's FIRST span. The defect is
    positional, not intrinsic: the same sentence is a fine span 2. So it is LABELLED and only
    banned outright on the retry that a subject failure triggers.
    """
    no_open = no_open or set()
    lines: list[str] = []
    last_section = None
    for c in cands:
        if c.section != last_section:
            lines.append(f"\n--- section: {c.section or '(top of page)'} ---")
            last_section = c.section
        mark = _LABEL.get(c.kind, "")
        # [QUOTED] tells the model "someone else is speaking". The page's own description under
        # the H1 is not that, and the quotation gate agrees -- is_speech() is the one definition
        # both use. Two opinions about one word cost the reference family its lede on 49 of 50
        # calibration pages.
        if c.is_quoted and not (c.is_page_lede and not is_speech(c.original, c.text)):
            mark += " [QUOTED]"
        if c.is_already_indexed:
            mark += " [ALREADY INDEXED]"
        if c.index in no_open:
            mark += " [NOT-FIRST]"
        lines.append(f"[{c.index}]{mark} {c.text}")
    return "\n".join(lines)


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
    free_text: list[str] = field(default_factory=list)


def resolve_selection(
    picked_abstract: list, picked_highlights: list, cands: list[Candidate],
    span_range: tuple[int, int] = (1, 4),
) -> Selection:
    """Turn integers into Candidates. THE guarantee, and it is trivial.

    There is no text to verify. The model returned numbers; we look them up in the list WE built
    from the page. A non-integer is a PROTOCOL error -- the writer contract says IDs only -- and
    it is recorded in `free_text` so `enrich` can refuse the record loudly rather than parse
    around a model that returned prose.
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
                sel.free_text.append(str(raw)[:120])
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

    # PAGE ORDER, not the order the model happened to return. The abstract is read as one
    # paragraph, so the order is part of the text; nothing sorted it and a reviewer caught an
    # abstract whose sentences appeared in reverse page order. Sorting here keeps the stored
    # spans and their offsets aligned, because both are derived from this list downstream.
    sel.abstract.sort(key=lambda c: c.start)
    sel.highlights.sort(key=lambda c: c.start)

    lo, hi = span_range
    if not (lo <= len(sel.abstract) <= hi):
        sel.failures.append(
            f"abstract has {len(sel.abstract)} valid picks, profile needs {lo}-{hi}")
        return sel
    # a highlight that repeats an abstract pick adds nothing
    abstract_ids = {c.index for c in sel.abstract}
    sel.highlights = [c for c in sel.highlights if c.index not in abstract_ids][:8]
    sel.passed = True
    return sel
