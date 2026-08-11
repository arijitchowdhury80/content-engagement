#!/usr/bin/env python3
"""
Span gate — the zero-hallucination guarantee for Chapter 3 content enrichment.

THE ONE IDEA
  An LLM tells us WHERE the good text is. This module then cuts that text out of the
  source page itself. The model's own string is used to locate and is then discarded.

  So the value written to the index is, by construction, text that came off the page.
  Hallucination is not "checked for", it is unrepresentable: there is no code path by
  which a word the model invented reaches the output.

WHY LOCATE-AND-SLICE INSTEAD OF STRING COMPARISON
  A naive `source.find(model_span) != -1` fails constantly for reasons that have nothing
  to do with hallucination:
    * markdown hard-wraps sentences, so the source has a newline where the model wrote a space
    * the source says `**NeuralSearch** is [fast](/doc)`, the model writes `NeuralSearch is fast`
  Both are faithful. Both fail an exact match. Rejecting them would quarantine most of the
  corpus for a formatting reason.

  So both sides are canonicalised (whitespace collapsed, markdown emphasis and link syntax
  removed) and matched on the canonical form. Canonicalisation only ever DELETES formatting
  characters and collapses whitespace -- it can never introduce a word. A canonical match
  therefore still proves every word came from the page.

  Every canonical character keeps a pointer back to its original offset, so a canonical hit
  yields the exact original span, which is what gets stored and what Chapter 4 re-verifies.

NOT IN THIS MODULE
  G5 language match, G8 whole-corpus template collision (needs every record), the judge.
  Those live in the runner. This file is only the part that carries the guarantee.

  python3 -m pytest docs/70-enrichment/tests/test_span_gate.py -q
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# canonicalisation
# ---------------------------------------------------------------------------

# Emphasis and code markers that carry no words. `_` is deliberately NOT here:
# stripping it would corrupt snake_case identifiers, which are the substance of
# the 4,392 `reference` records.
_DROP_CHARS = set("*`~")

# Table cell separators. Stripping these only at line start is not enough -- a markdown
# table puts them BETWEEN cells, so `| name | required |` kept its inner pipes. Treated as
# whitespace rather than deleted, so two cells never fuse into one false word.
# The 4,392 `reference` records are largely parameter tables, so this is the common case.
_SPACEY = set("|")

# Typographic variants folded to their ASCII equivalent FOR MATCHING ONLY.
#
# This is the single largest source of false rejections found in the 30-record pilot. Every LLM
# normalises typography when it copies: the page says `Algolia’s` with U+2019 and the model
# writes `Algolia's` with U+0027. The span is perfectly faithful and was being rejected over an
# apostrophe -- one page lost all three of its spans this way.
#
# Safe because the STORED text is sliced out of the source, so it keeps the page's original
# characters. Only the lookup key is folded. And every mapping is strictly 1:1, so the
# canonical->original offset map stays exact. `…` is deliberately NOT mapped: it would need
# 1->3 characters and break that invariant.
_FOLD = {
    "‘": "'", "’": "'", "‛": "'", "ʼ": "'", "´": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "«": '"', "»": '"',
    "–": "-", "—": "-", "‑": "-", "−": "-",
    " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
}

# A space before closing punctuation. algolia.com's own prose contains `percentage points , with`
# and every model silently corrects it while copying. Dropping the space on BOTH sides makes the
# faithful copy match. Subtractive, so it cannot introduce a word.
_SPACE_BEFORE_PUNCT = set(",.;:!?")

# An HTML/JSX tag. Length-bounded and newline-free on purpose: a comparison in prose
# ("if count < 5 and total > 3") must not be swallowed as a tag.
# Must open with a letter, `/` or `!` -- otherwise `count < 5 and total > 3` in prose
# matches as a tag and the comparison is silently eaten. Caught by test, not by review.
_TAG = re.compile(r"</?[A-Za-z!][^<>\n]{0,300}>")

# Line-leading markdown furniture: headings, blockquotes, list bullets, table pipes.
#
# NOTE, and this cost a real bug: no `^` anchor, and consumed in a LOOP.
# `pattern.match(text, i)` already anchors at i, whereas `^` only matches at the true
# start of the string unless re.MULTILINE is set -- so an anchored version fired on the
# first line of a document and silently never again. A live algolia.com page caught it:
# `> ## Documentation Index` kept its `>` and `##`. The loop is needed because real
# markdown stacks furniture, e.g. blockquoted headings and nested list bullets.
_LINE_LEAD = re.compile(r"[ \t]*(?:#{1,6}|>+|[-+*]|\d+\.|\|)[ \t]*")

# Block-boundary detection, used only to fill Canon.block.
#
# The ONE case where a source newline does NOT end a block is a hard-wrapped paragraph, and real
# markdown on algolia.com is full of them ("for qualifying Algolia\ncustomers."). A wrapped line is
# long by construction -- it ran out of width. A nav label, a CTA, an all-caps banner and a
# "00 TAGE" timer segment are short and unpunctuated. So: no terminal punctuation AND at least
# _WRAP_MIN characters means the sentence continues; anything else ends the block.
#
# Getting this backwards is the expensive direction: a false SOFT wrap re-merges a timer with the
# headline after it (judge REVISE #4), while a false HARD break only splits one sentence in two and
# both halves are then labelled sentence_complete=False rather than being sold as prose.
_WRAP_MIN = 60
_TERMINAL_PUNCT = frozenset(".!?:;")
_TRAILING_CLOSERS = "\"'’”)]»"


def _ends_a_sentence(emitted: list[str]) -> bool:
    """Did the line just ended finish a sentence? Ignores trailing quotes and brackets."""
    k = len(emitted) - 1
    while k >= 0 and emitted[k] in _TRAILING_CLOSERS:
        k -= 1
    return k >= 0 and emitted[k] in _TERMINAL_PUNCT


def _consume_line_lead(text: str, i: int) -> int:
    """Skip every stacked line-leading marker at i. Returns the new offset."""
    while True:
        m = _LINE_LEAD.match(text, i)
        if not m or m.end() == i:
            return i
        i = m.end()


# Headings whose content must NOT become an abstract: the page is not ABOUT these, and a
# sentence lifted out of them inverts or misattributes. Discovered by adversarial probe --
# a verbatim span from "Common mistakes" read as a recommendation. See build log D-011.
_SECTION_DENY = re.compile(
    r"common mistake|common error|troubleshoot|deprecat|legacy|no longer|changelog|"
    r"release note|what customers tell us|testimonial|in their words|related (article|read)|"
    r"further reading|next step|see also|anti-pattern|what not to",
    re.I,
)

# A span is a setup for its own contradiction when the text immediately after it reverses
# course. Selecting the setup and dropping the reversal is how verbatim text lies.
_REVERSAL = re.compile(
    r"^(it does not|it doesn't|it cannot|it can't|that is not|this is not|this is incorrect|"
    r"however|but |actually|in fact|wrong|incorrect|not true|avoid|do not|don't|"
    r"unfortunately|in reality)",
    re.I,
)


@dataclass
class Canon:
    """A canonical projection of a text, with a map back to original offsets."""

    text: str
    # origin[i] is the offset in the ORIGINAL string of canonical character i
    origin: list[int]
    original: str
    # section[i] indexes into `sections` -- which heading canonical char i sits under.
    # quoted[i] is True when char i came from a blockquote line.
    #
    # These exist because canonicalisation DESTROYS the signals needed to catch misleading
    # selection: it strips `>` so a customer quote becomes indistinguishable from Algolia's
    # own claim, and it strips `#` so a "Deprecated" heading vanishes. The structure has to
    # be captured while it is still visible.
    section: list[int] = field(default_factory=list)
    quoted: list[bool] = field(default_factory=list)
    sections: list[str] = field(default_factory=list)
    # block[i] is the id of the source BLOCK canonical char i came from. Same reason as the two
    # arrays above, and the one that cost the most: canonicalisation collapses every newline to a
    # space, so a nav bar, a countdown timer and an all-caps banner arrive at the splitter as one
    # unbroken string. Having no punctuation, they were never cut -- they merged into a single
    # chunk and were then chopped at MAX_CHARS on an arbitrary word boundary. Measured 2026-08-08:
    # 31.6% of all candidates were mid-sentence fragments, and the judge's top complaint was
    # coherence at 2.88/5. A block id restores the boundary without touching `text` by one byte.
    block: list[int] = field(default_factory=list)

    def slice_original(self, c_start: int, c_end: int) -> tuple[str, int, int]:
        """Given canonical [start, end), return the original substring and its offsets."""
        if c_start >= c_end:
            raise ValueError("empty canonical range")
        o_start = self.origin[c_start]
        o_end = self.origin[c_end - 1] + 1
        return self.original[o_start:o_end], o_start, o_end

    def section_title(self, c_index: int) -> str:
        if not self.section or c_index >= len(self.section):
            return ""
        idx = self.section[c_index]
        return self.sections[idx] if 0 <= idx < len(self.sections) else ""


def canonicalise(text: str) -> Canon:
    """
    Collapse whitespace, drop emphasis/code markers, unwrap markdown links, strip
    line-leading furniture. Purely subtractive: never adds or substitutes a word.
    """
    text = unicodedata.normalize("NFC", text)
    out: list[str] = []
    origin: list[int] = []
    sect: list[int] = []
    quoted: list[bool] = []
    blk: list[int] = []
    sections: list[str] = [""]  # index 0 = before any heading
    cur_section = 0
    cur_quoted = False
    cur_block = 0
    line_emitted = 0
    prev_heading = False
    i = 0
    n = len(text)
    at_line_start = True
    pending_space = False

    while i < n:
        if at_line_start:
            # Inspect this line's markers BEFORE consuming them: which one it is carries the
            # structure (heading = new section, `>` = quotation) and consuming loses that.
            j = i
            is_heading = False
            is_quote = False
            while True:
                m = _LINE_LEAD.match(text, j)
                if not m or m.end() == j:
                    break
                marker = text[j : m.end()].lstrip()
                if marker.startswith("#"):
                    is_heading = True
                elif marker.startswith(">"):
                    is_quote = True
                j = m.end()

            if is_heading:
                line_end = text.find("\n", j)
                line_end = n if line_end == -1 else line_end
                sections.append(text[j:line_end].strip())
                cur_section = len(sections) - 1
            cur_quoted = is_quote

            # Decide the block boundary HERE, while the markers and the previous line's shape are
            # both still visible. One line later, canonicalisation has erased both.
            if out:
                soft_wrap = (
                    not is_heading                  # a heading always OPENS a block...
                    and not prev_heading            # ...and always CLOSES the one before it
                    and j == i                      # no list/quote/table marker on this line
                    and line_emitted >= _WRAP_MIN
                    and not _ends_a_sentence(out)
                )
                if not soft_wrap:
                    cur_block += 1
            # prev_heading is not redundant with is_heading. The decision is taken at the START of
            # the FOLLOWING line, where `is_heading` describes that following line -- so without
            # remembering it, "the line I just left was a heading" is unknowable. A long unpunctuated
            # heading then looked exactly like a hard-wrapped paragraph and was merged with the prose
            # under it: '## Entwickeln Sie mit Algolia erstklassige...' + 'Algolia bietet Ihnen...'
            # arrived as ONE candidate and was scored coherence 1. My own bug, from this same change.
            prev_heading = is_heading
            line_emitted = 0

            at_line_start = False
            if j > i:
                i = j
                continue

        ch = _FOLD.get(text[i], text[i])

        # HTML / JSX tag -> separator. algolia.com's doc markdown embeds <section> and
        # <Card title="..." /> blocks; without this they survive canonicalisation and a
        # model can select a span full of markup. Bounded and newline-free so that a
        # literal "x < 5 and y > 3" in prose is untouched.
        if ch == "<":
            m = _TAG.match(text, i)
            if m:
                pending_space = True
                i = m.end()
                continue

        # markdown link / image:  [label](target)  ->  label
        if ch == "[":
            close = text.find("](", i)
            if close != -1:
                # A single newline INSIDE the label is normal -- real markdown hard-wraps, and
                # algolia.com's OpenAPI descriptions contain `[user\n  token](url)`. Rejecting
                # those left raw link syntax in the canonical text and falsely rejected a
                # faithful span. A blank line means it is not a link, and a very long label
                # means the `](` belongs to some later link.
                label_ok = (close - i) <= 300 and "\n\n" not in text[i:close]
                end_paren = text.find(")", close + 2)
                if label_ok and end_paren != -1 and "\n" not in text[close:end_paren]:
                    label = text[i + 1 : close]
                    for k, raw_lch in enumerate(label):
                        # FOLD HERE TOO. This loop emitted the label's characters raw while the
                        # main loop below folds them, which made canonicalise() non-idempotent:
                        # `don’t` inside a link label survived as U+2019 in the canonical BODY,
                        # while the same words canonicalised as a standalone SPAN became U+0027.
                        # `canon_contains` folds both sides and they took different paths, so a
                        # span sliced verbatim out of the page reported as ungrounded -- 3 records
                        # in the 2026-08-10 repair run, all on one article, all genuinely faithful.
                        # The fold is 1:1, so origin[] stays exact.
                        lch = _FOLD.get(raw_lch, raw_lch)
                        if lch.isspace():
                            pending_space = True
                            continue
                        if lch in _DROP_CHARS:
                            continue
                        # same clear-unconditionally rule as the main loop below, AND the same
                        # space-before-closing-punctuation rule. Any divergence between this loop
                        # and the main one makes canonicalise() non-idempotent, which breaks the
                        # only guarantee that matters: a span sliced from the page must be findable
                        # in the page. Both known divergences -- the fold and this -- produced
                        # false "not grounded" verdicts on genuinely faithful spans.
                        nxt_l = label[k + 1] if k + 1 < len(label) else ""
                        closing_l = (lch in _SPACE_BEFORE_PUNCT and not nxt_l.isalnum())
                        if pending_space and closing_l:
                            pending_space = False
                        if pending_space:
                            if out:
                                out.append(" ")
                                origin.append(i + 1 + k)
                                sect.append(cur_section)
                                quoted.append(cur_quoted)
                                blk.append(cur_block)
                                line_emitted += 1
                            pending_space = False
                        out.append(lch)
                        origin.append(i + 1 + k)
                        sect.append(cur_section)
                        quoted.append(cur_quoted)
                        blk.append(cur_block)
                        line_emitted += 1
                    i = end_paren + 1
                    continue

        if ch.isspace() or ch in _SPACEY:
            pending_space = True
            if ch == "\n":
                at_line_start = True
            i += 1
            continue

        if ch in _DROP_CHARS:
            i += 1
            continue

        # Clear the flag even when `out` is empty. Leaving it set meant leading markup
        # deferred a space onto the SECOND character of the first word -- "R eal prose".
        # Every /doc page opens with the llms.txt banner, so this would have corrupted
        # the first span of thousands of records.
        if pending_space:
            # ...unless the next character is CLOSING punctuation. `points , with` and
            # `points, with` must canonicalise identically; models fix that typo silently.
            #
            # "Closing" is load-bearing and was missing. The test was `ch in ",.;:!?"`, which also
            # fired on a LEADING dot: `Algolia has a .NET API Client` canonicalised to
            # `a.NET`. Inside a markdown link label the collapse did not happen -- that branch
            # has its own loop -- so the same words canonicalised two different ways and a span
            # sliced verbatim from the page could not be found in it. Two blog records,
            # 2026-08-10, same root as the `_FOLD` asymmetry above.
            #
            # A closing mark is followed by a space, another mark, or the end of the text. A mark
            # followed immediately by a letter or digit is opening something -- `.NET`, `:8080`,
            # `?q=1` -- and the space in front of it is real.
            closing_punct = (ch in _SPACE_BEFORE_PUNCT
                             and not (i + 1 < n and text[i + 1].isalnum()))
            if out and not closing_punct:
                out.append(" ")
                origin.append(i)
                sect.append(cur_section)
                quoted.append(cur_quoted)
                blk.append(cur_block)
                line_emitted += 1
            pending_space = False

        out.append(ch)
        origin.append(i)
        sect.append(cur_section)
        quoted.append(cur_quoted)
        blk.append(cur_block)
        line_emitted += 1
        i += 1

    return Canon(
        text="".join(out),
        origin=origin,
        original=text,
        section=sect,
        quoted=quoted,
        sections=sections,
        block=blk,
    )


# ---------------------------------------------------------------------------
# G1 — locate and slice
# ---------------------------------------------------------------------------

_TRIM = " \t\n\r\"'“”‘’.,;:!?…()[]"

# How far apart abstract spans may sit in the source. The `commercial` family runs to
# 278,634 characters, so without a bound an abstract can be stitched from the top and the
# bottom of a document that never relates them.
#
# Raised from 8,000 to 20,000 on pilot evidence. 8,000 was a guess and it rejected the best
# abstract in the pilot: a long-form blog post whose spans were title + thesis + conclusion,
# 13,545 apart. Abstracting a long article REQUIRES reaching across it. 20,000 still blocks
# stitching across a 60,000-character page. Kept mechanical rather than delegated to the judge,
# which has only 6 records of evidence behind it.
_MAX_SPAN_SPREAD = 20_000

# Raised from 2 to 4. Legitimate pilot cases used 3 and 4 sections (intro + a fact + a claim);
# 5+ still blocks. Same reasoning: loosen to what the data supports, do not remove.
_MAX_SPAN_SECTIONS = 4

# How many invented/edited spans a single record may lose before the whole record is quarantined.
# One slip is a slip. Two or more means the model was not reading this page.
MAX_FABRICATIONS = 1

# A blockquote is only SOMEONE ELSE'S words if it is punctuated as speech or carries an
# attribution. algolia.com blockquotes the page's OWN one-line summary right under the H1:
#     # Usage API
#     > The Usage API lets you retrieve various usage statistics...
# Treating every `>` as a quotation rejected the single best sentence on every /doc page --
# 4,392 records, 36% of the corpus. Measured on the pilot: 14 blockquotes, 12 ledes, 2 real
# quotes (German testimonials in „ "), zero misclassified.
# KNOWN LIMIT: an unquoted, unattributed testimonial on a non-case-study page would read as a
# lede. Not observed in 30 pages; not ruled out either. The `evidence` family allows quotes
# anyway, and the section deny-list still catches "What customers tell us" headings.
_SPEECH_MARK = re.compile(r'["“”„«»]')
_ATTRIBUTION = re.compile(r"[—–]\s*[A-Z]")


def is_speech(*texts: str) -> bool:
    """Is this someone else talking, rather than the page in its own voice?

    THE ONE DEFINITION. G10 below decides whether to quarantine a span with it, and
    candidates.render_menu decides whether to show the model a [QUOTED] label with it. Those two
    used to disagree: G10 already exempted blockquoted ledes -- "A blockquoted lede is the page's
    own voice" -- while the menu labelled every blockquote [QUOTED] and the prompt says never to
    pick one. So the gate accepted the sentence the menu had forbidden, and on `doc-md-twin` pages
    that sentence is the page's own description. Two opinions about one word cost the reference
    family its lede on 49 of 50 calibration pages.

    Pass every string that might carry the evidence -- typically original_text AND stored_text,
    because locate() may strip wrapping quotation marks via _TRIM when retrying a match, which
    erases the very proof the span is speech.
    """
    blob = " ".join(t for t in texts if t)
    return bool(_SPEECH_MARK.search(blob) or _ATTRIBUTION.search(blob))

# Stopword counting, deliberately crude: enough to FLAG a mixed-language abstract for
# quarantine, not to adjudicate language. Added because the pilot produced a German record whose
# first sentence was English -- both genuinely on the page, since algolia.com's localised pages
# carry untranslated English. No other gate catches this: G5 compares the model's reported
# language to the record's, never the spans to each other.
_LANG_STOPWORDS = {
    "en": (" the ", " and ", " you ", " with ", " that ", " for ", " your ", " this "),
    "de": (" der ", " die ", " das ", " und ", " mit ", " Sie ", " für ", " den ", " ihre "),
    "fr": (" le ", " la ", " les ", " des ", " vous ", " pour ", " avec ", " une "),
}


def detect_language(text: str) -> str:
    """Crude stopword vote. Returns 'en'/'de'/'fr', or '?' when there is no signal."""
    padded = f" {text} "
    scores = {lang: sum(padded.count(w) for w in words)
              for lang, words in _LANG_STOPWORDS.items()}
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else "?"


@dataclass
class Located:
    stored_text: str  # canonical text, sliced from the SOURCE. This is what is indexed.
    original_text: str  # exact original substring, for provenance
    start: int  # original offset
    end: int
    occurrences: int  # how many times it appears; >1 means the offset is one of several
    section: str = ""  # heading this span sits under
    section_index: int = 0
    is_quoted: bool = False  # came from a blockquote -- someone else's words
    followed_by: str = ""  # the next ~140 canonical chars, for the reversal check


class SpanRejected(Exception):
    """A span could not be located in the source. The record is quarantined."""

    def __init__(self, span: str, reason: str):
        super().__init__(f"{reason}: {span[:80]!r}")
        self.span = span
        self.reason = reason


def locate(model_span: str, source: Canon) -> Located:
    """
    Find the model's span in the source and return the SOURCE's own text for it.

    The returned stored_text is cut from the source, never from the model's string.
    Raises SpanRejected if it is not present. There is no fuzzy fallback: canonical
    exact match or nothing.
    """
    needle = canonicalise(model_span).text.strip()
    if not needle:
        raise SpanRejected(model_span, "empty after canonicalisation")

    hay = source.text
    pos = hay.find(needle)
    if pos == -1:
        # One bounded retry: the model may have added or dropped edge punctuation
        # or wrapping quotes. Still an exact match, just on a trimmed needle.
        trimmed = needle.strip(_TRIM)
        if len(trimmed) < 12:
            raise SpanRejected(model_span, "not found in source")
        pos = hay.find(trimmed)
        if pos == -1:
            raise SpanRejected(model_span, "not found in source")
        needle = trimmed

    occurrences = hay.count(needle)
    c_end = pos + len(needle)
    stored, o_start, o_end = source.slice_original(pos, c_end)
    sec_idx = source.section[pos] if source.section else 0
    return Located(
        stored_text=needle,
        original_text=stored,
        start=o_start,
        end=o_end,
        occurrences=occurrences,
        section=source.section_title(pos),
        section_index=sec_idx,
        is_quoted=any(source.quoted[pos:c_end]) if source.quoted else False,
        followed_by=hay[c_end : c_end + 140].lstrip(),
    )


# ---------------------------------------------------------------------------
# G2 — no fabricated numbers, dates, versions, entities
# ---------------------------------------------------------------------------

_NUMBERISH = re.compile(
    r"""(?:
          \d+(?:[.,]\d+)*\s*%          # 42%, 3.5 %
        | [$€£]\s*\d[\d.,]*            # $1,200
        | \bv?\d+(?:\.\d+)+\b          # 4.2.1, v1.0
        | \b\d[\d.,]*\b                # any bare number
    )""",
    re.VERBOSE,
)
_ENTITY = re.compile(r"\b[A-Z][A-Za-z0-9]*(?:[ -][A-Z][A-Za-z0-9]*)*\b")


def check_no_fabricated_tokens(stored_values: list[str], source: Canon) -> list[str]:
    """
    Belt-and-braces on G1. G1 already proves each span is present; this catches the
    contamination case G1 cannot -- a span that is real but came from a DIFFERENT page
    (stale cache, mis-threaded batch). Returns the offending tokens; empty means pass.
    """
    hay = source.text
    bad: list[str] = []
    for value in stored_values:
        for tok in _NUMBERISH.findall(value) + _ENTITY.findall(value):
            t = tok.strip()
            if len(t) < 2:
                continue
            if t not in hay:
                bad.append(t)
    return sorted(set(bad))


# ---------------------------------------------------------------------------
# G3 / G4 / G6 / G7
# ---------------------------------------------------------------------------

# Two kinds of chrome, and conflating them cost 6 good records.
#
# ALWAYS: a sentence mentioning these IS site furniture whatever else it says. A cookie banner is
# a cookie banner.
_CHROME_ALWAYS = [
    "cookie", "consent banner", "newsletter", "share this", "follow us",
    "all rights reserved", "privacy policy", "terms of service",
]
# CTA: these appear inside perfectly good prose -- "...or contact sales for volume pricing" is a
# real fact about how to buy. They only disqualify a span when the span IS the button, i.e. the
# phrase dominates it. Substring matching here rejected 6 legitimate commercial records.
_CHROME_CTA = [
    "contact sales", "book a demo", "sign up for", "subscribe to", "related article",
    "get started for free", "start free trial",
]
_CHROME = _CHROME_ALWAYS + _CHROME_CTA
_SELF_REF = [
    "in this guide", "in this article", "in this post", "this page",
    "this article will", "this guide will", "read on to", "we'll show you",
    "we will show you", "in this tutorial", "by the end of this",
]
_STOP = set(
    "a an the and or but if of to in on for with by is are was were be been being as at "
    "from that this these those it its you your we our they their he she his her not no "
    "can will would should could may might do does did have has had how what when where "
    "which who why into over under more most other some such than then them there".split()
)


# Families whose abstract spans must end a sentence.
#
# `reference` is EXCLUDED, and that exclusion is load-bearing. An API page's lede -- its one-line
# statement of what the endpoint does -- carries no full stop, and banning it cost the reference
# family 18 of its 50 calibration pages: the family instruction asks the abstract to lead with
# exactly that sentence, the prompt forbids picking marked entries, so the model had nothing legal
# to choose and returned THIN. Unbanning it is what made that family workable.
#
# Editorial prose has no such lede. Its period-less spans are cuts, not ledes -- 20 of them in the
# blog run, every one a run-on. So the rule is applied where it is true and withheld where it is
# not, per the 2026-08-09 finding that a source-specific ruling must not be generalised.
_ABSTRACT_MUST_TERMINATE = frozenset({"editorial", "commercial", "corporate", "instructional"})


def check_integrity(abstract: list[str], highlights: list[str], span_range: tuple[int, int],
                    family: str = "") -> list[str]:
    errs: list[str] = []
    lo, hi = span_range
    if not (lo <= len(abstract) <= hi):
        errs.append(f"abstract span count {len(abstract)} outside family range {lo}-{hi}")
    if len(highlights) > 8:
        errs.append(f"highlight count {len(highlights)} exceeds 8")

    allv = abstract + highlights
    for v in allv:
        if not v.strip():
            errs.append("empty span")
    # NOTE: over-long highlights are NOT a record failure. Length is a property of one span, so
    # the fix is to drop that span (see run_gates), not to quarantine a record whose abstract is
    # fine. The pilot lost a good customer-story record to a single long German testimonial.
    seen: set[str] = set()
    for v in allv:
        k = v.strip().lower()
        if k in seen:
            errs.append(f"duplicate span: {v[:40]!r}")
        seen.add(k)
    for i, a in enumerate(allv):
        for j, b in enumerate(allv):
            if i != j and a.strip() and a.strip() in b.strip() and a.strip() != b.strip():
                errs.append(f"span nested inside another: {a[:40]!r}")

    # ABSTRACT SPANS ONLY. The abstract is CONCATENATED into one paragraph, so a span with no
    # full stop runs into the next one and asserts a link neither span makes:
    #
    #   "...believe it's imperative to be able to do real-time course correcting"
    #   "Algolia, for example, is a search provider that offers near real-time analytics..."
    #
    # Highlights are deliberately exempt: they render as a list, and a bullet without a full stop
    # is normal prose, not a defect. Measured on the blog run -- 350 period-less highlight spans
    # were fine, while 20 period-less abstract spans were run-ons. Applying one rule to both
    # fields would have quarantined 304 good records to fix 20 bad ones.
    #
    # A trailing colon fails everywhere, abstract or highlight: it promises a list that the span
    # does not contain.
    for v in (abstract if family in _ABSTRACT_MUST_TERMINATE else []):
        t = v.rstrip()
        while t and t[-1] in _TRAILING_CLOSERS:
            t = t[:-1]
        if t and t[-1] not in ".!?":
            errs.append(f"abstract span does not end a sentence, so it runs into the next: "
                        f"...{v.rstrip()[-48:]!r}")
    for v in allv:
        if v.rstrip().endswith(":"):
            errs.append(f"span ends in a colon, promising a list it does not contain: "
                        f"{v.strip()[:48]!r}")
    return errs


def check_subject_present(first_span: str, title: str) -> list[str]:
    """G4 -- span 1 must name its own subject, or it is meaningless in a result list."""
    if not first_span.strip():
        return ["abstract span 1 is empty"]
    words = first_span.split()
    # words[1:] skipped word 0 on the theory that a leading capital is only sentence-start.
    # But on Algolia's own pages the subject usually IS the first word, so
    # "Algolia focuses on search speed." failed for "naming no subject". It names it.
    # Word 0 now counts when it is a known proper noun or any non-sentence-initial word is
    # capitalised. A bare "The" or "It" still fails, which is the case this gate exists for.
    _GENERIC_OPENERS = {"the", "it", "this", "that", "these", "those", "there", "they",
                        "we", "you", "our", "its", "a", "an", "and", "but", "if", "when"}
    has_proper = any(w[:1].isupper() for w in words[1:]) or (
        bool(words) and words[0][:1].isupper() and words[0].strip(".,;:").lower() not in _GENERIC_OPENERS
    )
    title_tokens = {t.lower().strip(".,;:") for t in title.split() if t.lower() not in _STOP}
    shares_title = any(w.lower().strip(".,;:") in title_tokens for w in words)
    has_digit = any(c.isdigit() for c in first_span)
    if has_proper or shares_title or has_digit:
        return []
    return [f"abstract span 1 names no subject: {first_span[:60]!r}"]


def check_blacklists(values: list[str]) -> list[str]:
    """A chrome phrase only disqualifies a span when the span IS chrome, not when it mentions it.

    Substring matching rejected 6 legitimate records because "contact sales" appears inside real
    sentences on commercial pages ("...or contact sales for volume pricing"). A call-to-action
    button is a SHORT span that is mostly the phrase; a sentence that happens to contain it is not.
    So: only fire when the phrase dominates the span.
    """
    errs: list[str] = []
    for v in values:
        low = v.lower()
        for phrase in _CHROME_ALWAYS:
            if phrase in low:
                errs.append(f"chrome phrase {phrase!r} in span: {v[:50]!r}")
        for phrase in _CHROME_CTA:
            if phrase in low and (len(low) < len(phrase) * 3 or len(low.split()) <= 6):
                errs.append(f"call-to-action {phrase!r} dominates span: {v[:50]!r}")
        for phrase in _SELF_REF:
            if phrase in low:
                errs.append(f"self-reference {phrase!r} in span")
    return errs


def check_context(
    abstract: list[Located],
    highlights: list[Located],
    family: str,
    original_length: int = 0,
    seen_length: int = 0,
) -> list[str]:
    """
    G10 -- misleading selection. This is the gate that catches IMAGINATION, which is a
    different failure from hallucination and is not prevented by verbatim copying.

    An adversarial probe (build log D-011) got four misleading-but-verbatim abstracts past
    G1-G7. Every word was on the page; the meaning was wrong anyway:

      1. a customer's quote about a COMPETITOR, stored as Algolia's own claim
      2. a sentence from "Common mistakes", stored as a recommendation -- the page's next
         sentence was "It does not.", so dropping it inverted the meaning
      3. a sentence from a "Deprecated" section, stored as current product fact
      4. two unrelated true sentences juxtaposed so the pair implies a link the page never made

    Verbatim means "these words are on the page". It does not mean "this is what the page
    says". Those are different claims and only the first one is free.
    """
    errs: list[str] = []

    for loc in abstract + highlights:
        where = "abstract" if loc in abstract else "highlight"

        # (1) someone else's words presented as the page's own -- but only when the blockquote
        # is actually speech. A blockquoted lede is the page's own voice. See _SPEECH_MARK.
        # Test against original_text, not stored_text: locate() may strip wrapping quotation
        # marks via _TRIM when retrying a match, which would erase the very evidence that this
        # span is speech. original_text is sliced from the page and keeps them.
        if (loc.is_quoted and family != "evidence"
                and is_speech(loc.original_text, loc.stored_text)):
            errs.append(
                f"G10 {where} span is a quotation attributed to someone else "
                f"under {loc.section!r}: {loc.stored_text[:60]!r}"
            )

        # (2) the page contradicts this sentence immediately afterwards
        if _REVERSAL.match(loc.followed_by):
            errs.append(
                f"G10 {where} span is followed by a reversal "
                f"({loc.followed_by[:30]!r}) -- selecting it inverts the meaning: "
                f"{loc.stored_text[:60]!r}"
            )

        # (3) a section whose content is not what the page is about
        if loc.section and _SECTION_DENY.search(loc.section):
            errs.append(
                f"G10 {where} span taken from excluded section {loc.section!r}: "
                f"{loc.stored_text[:60]!r}"
            )

    # (4) false juxtaposition -- PARTIAL. Two true sentences placed side by side can assert
    # something neither says. This is only partly mechanical: an abstract built from a page's
    # intro plus one key fact is legitimate and common, so "same section only" would reject
    # most good abstracts. Two bounds are enforced; the residual judgement is the LLM judge's
    # `juxtaposition` dimension, and it is NOT guaranteed. Stated honestly in the build log.
    if len(abstract) > 1:
        distinct = {l.section_index for l in abstract}
        if len(distinct) > _MAX_SPAN_SECTIONS:
            errs.append(
                f"G10 abstract spans drawn from {len(distinct)} different sections "
                f"(limit {_MAX_SPAN_SECTIONS}) -- juxtaposition implies a link "
                f"the page does not make"
            )
        # (5) mixed languages inside one abstract. Both sentences can be genuinely on the page
        # -- algolia.com's /de/ and /fr/ pages carry untranslated English -- and still be wrong
        # to store together on a localised record. 3,887 fr/de records are exposed to this.
        langs = {detect_language(l.stored_text) for l in abstract}
        langs.discard("?")
        if len(langs) > 1:
            errs.append(
                f"G10 abstract mixes languages {sorted(langs)} -- the page carries untranslated "
                f"text and the spans are not consistent with each other"
            )
        # Measured against the ORIGINAL page, not the string handed to the model. When a page was
        # truncated, offsets live in the truncated text and the true distance is larger, so the
        # gap is scaled back up.
        #
        # THE DENOMINATOR MUST BE HOW MUCH TEXT THE MODEL SAW. It used to be
        # `max(l.end for l in abstract)` -- the position of the LAST SELECTED SPAN -- which has
        # nothing to do with truncation and inverted the whole check: the tighter and higher up the
        # page a selection sat, the smaller the denominator and the bigger the multiplier.
        # /doc/rest-api/search/set-settings picked three CONSECUTIVE sentences 204 characters apart
        # on an 81,887-character page and was rejected for spanning "~37708 characters":
        # 204 * (81887 / 443). Run D lost 11 of 50 records to this, its single largest failure
        # bucket, every one of them a well-formed adjacent pick -- while a genuinely scattered
        # selection taken from the bottom of a page had a denominator so large it sailed through.
        #
        # No seen_length means no scaling. Silence must not invent a multiplier.
        spread = max(l.end for l in abstract) - min(l.start for l in abstract)
        if original_length and seen_length and original_length > seen_length:
            spread = int(spread * (original_length / seen_length))
        if spread > _MAX_SPAN_SPREAD:
            errs.append(
                f"G10 abstract spans span ~{spread} characters of the original page "
                f"(limit {_MAX_SPAN_SPREAD}) -- stitched from unrelated parts of the document"
            )

    return errs


# G7 threshold per family. Only `reference` differs, and only because its pages are terse by
# nature: the title is the endpoint name, the description is what it does, and the body is often a
# single sentence. Every other family has room to say something new and keeps the strict bar.
# Kept here rather than in shape-families.json because it is a GATE parameter, and the gates are
# the guarantee -- they should not be editable by whoever regenerates the family census.
INFO_GAIN_MINIMUM = {"reference": 3}


def check_information_gain(abstract_text: str, title: str, description: str,
                           minimum: int = 8) -> list[str]:
    """G7 -- must add content words absent from title+description. 3,340 records in this
    index already have abstract == description byte-for-byte, so this is a proven defect.

    THE THRESHOLD IS PER-FAMILY, and a flat 8 was wrong. The Phase 1 calibration batch failed at
    42% against a 60% bar, and **16 of the 19 quarantines were this gate**. On an API reference
    page the title IS the endpoint name and the description IS what it does, so a faithful
    abstract necessarily repeats them -- the whole page is often one or two sentences. A bar built
    for blog posts was rejecting correct work.

    Measured on those 16 failures, the gains were 0,0,0,1,1,2,3,3,3,4,4,6,6,6,7,7. A bar of 3
    recovers 10 of them and still rejects 0/1/2, which is the case this gate exists for: an
    abstract that restates the metadata. Lowering it to 1 would recover 3 more and gut the gate.
    """
    known = {
        w.lower().strip(".,;:!?()[]\"'")
        for w in f"{title} {description}".split()
    }
    new = {
        w.lower().strip(".,;:!?()[]\"'")
        for w in abstract_text.split()
        if w.lower().strip(".,;:!?()[]\"'") not in _STOP
    } - known
    new = {w for w in new if len(w) > 2}
    if len(new) < minimum:
        return [f"information gain {len(new)} < {minimum} new content tokens"]
    return []


# ---------------------------------------------------------------------------
# prose measurement — replaces asking the model to count characters (D5)
# ---------------------------------------------------------------------------

_FENCE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE = re.compile(r"`[^`]*`")
_HTML = re.compile(r"<[^>]+>")


def prose_chars(markdown: str) -> int:
    """
    Characters of actual prose: code fences, inline code, HTML tags, link targets and
    line-leading furniture removed. Computed by script BEFORE the LLM call, so the THIN
    decision never depends on a model counting characters -- which models cannot do.
    """
    t = _FENCE.sub(" ", markdown)
    t = _INLINE_CODE.sub(" ", t)
    t = _HTML.sub(" ", t)
    lines = []
    for line in t.split("\n"):
        stripped = _LINE_LEAD.sub("", line)
        # a line with no sentence-ending punctuation and few words is furniture
        if len(stripped.split()) >= 4:
            lines.append(stripped)
    return len(canonicalise(" ".join(lines)).text)


# ---------------------------------------------------------------------------
# the record-level gate
# ---------------------------------------------------------------------------

@dataclass
class GateResult:
    passed: bool
    abstract_enriched: str = ""
    keyhighlights_enriched: list[str] = field(default_factory=list)
    span_offsets: list[tuple[int, int]] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    content_hash: str = ""
    dropped_highlights: int = 0  # over-long spans removed, not a record failure
    # Spans REJECTED BY G1 -- i.e. the model invented or edited them. Counted, never written.
    # A per-record fabrication rate is a quality signal about the model and about the page.
    dropped_fabrications: int = 0
    fabricated_spans: list[str] = field(default_factory=list)
    # The component spans of the abstract, BEFORE they are joined by a space.
    # Stored because re-deriving them from the joined string is fragile and has now caused two
    # separate bugs: the verifier declared "THE GUARANTEE IS BROKEN" over 9 good records, and the
    # review pack printed "NOT FOUND ON PAGE" for 4 abstracts whose spans joined without a full
    # stop ("...for Scala, v1" + "Gives API access..."). Never guess at data you can just keep.
    abstract_spans: list[str] = field(default_factory=list)


def check_template_collision(abstracts: list[str], threshold: int = 20) -> dict[str, int]:
    """G8 -- whole-corpus sameness. Cannot be seen from inside a single record.

    Specified in the plan and never implemented until 2026-08-08. Hash the first 8 tokens of every
    stored abstract: any prefix appearing more than `threshold` times is a template, not an
    abstract, and the whole cluster should be quarantined rather than shipped.

    Returns {prefix: count} for every offending cluster. Empty dict means pass.
    """
    counts: dict[str, int] = {}
    for a in abstracts:
        if not a:
            continue
        prefix = " ".join(a.split()[:8]).lower()
        if prefix:
            counts[prefix] = counts.get(prefix, 0) + 1
    return {p: c for p, c in counts.items() if c > threshold}


def run_gates(
    *,
    llm_output: dict,
    page_markdown: str,
    title: str,
    description: str,
    family_span_range: tuple[int, int],
    family: str = "",
    original_length: int = 0,
) -> GateResult:
    """
    Run G1, G2, G3, G4, G6, G7 over one record. Any failure quarantines the record --
    nothing partial is ever written.

    The returned abstract_enriched is built from text SLICED OUT OF page_markdown.
    The model's strings are used only to locate and are discarded.
    """
    source = canonicalise(page_markdown)
    res = GateResult(passed=False)
    res.content_hash = hashlib.sha256(page_markdown.encode("utf-8")).hexdigest()

    verdict = llm_output.get("verdict")
    if verdict not in {"REAL", "DEAD", "THIN"}:
        res.failures.append(f"bad verdict {verdict!r}")
        return res

    if verdict in {"DEAD", "THIN"}:
        if llm_output.get("abstract_spans") or llm_output.get("keyhighlights_spans"):
            res.failures.append(f"{verdict} must return empty span arrays")
            return res
        reason = llm_output.get("insufficient_reason")
        allowed = {
            "ERROR_PAGE", "LOGIN_REQUIRED", "NO_PROSE", "LINKS_ONLY",
            "CODE_ONLY", "LANGUAGE_MISMATCH", "PAYWALL",
        }
        if reason not in allowed:
            res.failures.append(f"insufficient_reason {reason!r} not in closed list")
            return res
        res.passed = True  # a correctly-reported gap is a pass, not a failure
        return res

    # ---- G1: locate every span, slice from source -------------------------
    # G1 per span, NOT all-or-nothing.
    #
    # This used to abort the whole record on the first rejected span. That is safe but wasteful:
    # GLM-5.2 was caught inventing a date ("10. August 2026" where the page says "August 2026")
    # inside ONE highlight, and the record's perfectly good abstract and six other highlights went
    # in the bin with it. A fabrication should cost the SPAN, not the page.
    #
    # Dropping is safe because the fabrication never enters the output either way -- only text
    # sliced from the source is ever stored. What changes is that we stop discarding the honest
    # spans alongside the dishonest one.
    #
    # Two limits keep this from becoming a loophole:
    #   * the abstract must still meet its family's minimum span count from SURVIVING spans
    #   * more than MAX_FABRICATIONS rejects means the model was confused about this page as a
    #     whole, not slipping on one sentence -- quarantine the record and let a human look
    located_abstract: list[Located] = []
    located_high: list[Located] = []

    for span in llm_output.get("abstract_spans", []):
        try:
            located_abstract.append(locate(span, source))
        except SpanRejected as exc:
            res.dropped_fabrications += 1
            res.fabricated_spans.append(span[:160])
            res.failures.append(f"G1 dropped abstract span ({exc.reason}): {exc.span[:60]!r}")
    for span in llm_output.get("keyhighlights_spans", []):
        try:
            located_high.append(locate(span, source))
        except SpanRejected as exc:
            res.dropped_fabrications += 1
            res.fabricated_spans.append(span[:160])
            res.failures.append(f"G1 dropped highlight span ({exc.reason}): {exc.span[:60]!r}")
    ev = llm_output.get("verdict_evidence") or ""
    if ev:
        try:
            locate(ev, source)
        except SpanRejected as exc:
            # The evidence for the verdict itself being invented is a different kind of problem:
            # the model was not reading this page. Hard fail.
            res.failures.append(f"G1 verdict_evidence not on page: {exc.span[:60]!r}")
            return res

    if res.dropped_fabrications > MAX_FABRICATIONS:
        res.failures.append(
            f"G1 {res.dropped_fabrications} fabricated spans (limit {MAX_FABRICATIONS}) -- "
            f"the model was not reading this page reliably; quarantined for review"
        )
        return res

    if len(located_abstract) < family_span_range[0]:
        res.failures.append(
            f"G1 only {len(located_abstract)} of "
            f"{len(llm_output.get('abstract_spans', []))} abstract spans survived; "
            f"family needs {family_span_range[0]}"
        )
        return res

    if not located_abstract:
        res.failures.append("G1 REAL verdict with no abstract spans")
        return res

    # The failures logged above are DROPS, not record failures. Clear them so the record can pass
    # on its surviving spans; the counts and the offending text are preserved on the result.
    res.failures = [f for f in res.failures if not f.startswith("G1 dropped")]

    abstract_values = [l.stored_text for l in located_abstract]

    # G11 SPECIFICITY FLOOR. Drop highlights that are bare navigation labels.
    #
    # Found by Arijit reviewing the pack: /doc/ui-libraries yielded "InstantSearch Android",
    # "InstantSearch iOS", "InstantSearch.js", "React InstantSearch", "Vue InstantSearch" as five
    # of its seven key points. Every one is verbatim and provably on the page. Every one is a
    # link label in a nav list, and worthless in a search result.
    #
    # A useful highlight makes a STATEMENT. The cheap, non-judgemental test for that: it has
    # enough words to be a clause, or it carries a number/limit. A 2-3 word noun phrase does not.
    # Applied per span (drop it), never to the record, and NOT to abstract spans -- an API
    # reference page legitimately has a short parameter row as its whole abstract.
    kept_specific = [
        l for l in located_high
        if len(l.stored_text.split()) >= 6 or any(c.isdigit() for c in l.stored_text)
    ]
    dropped_generic = len(located_high) - len(kept_specific)
    if dropped_generic:
        res.dropped_highlights += dropped_generic
    located_high = kept_specific

    # Drop over-long highlights rather than failing the record. 300 characters is a display
    # limit for a search result, and it is a property of the individual span. German runs ~30%
    # longer than English, so a single long testimonial was killing otherwise-good records.
    kept_high = [l for l in located_high if len(l.stored_text) <= 300]
    dropped = len(located_high) - len(kept_high)
    if dropped:
        res.dropped_highlights = dropped
    located_high = kept_high
    highlight_values = [l.stored_text for l in located_high]
    abstract_text = " ".join(abstract_values)

    # ---- G3, G4, G6, G7, G2 ----------------------------------------------
    res.failures += check_integrity(abstract_values, highlight_values, family_span_range,
                                    family=family)
    res.failures += check_context(located_abstract, located_high, family, original_length)
    res.failures += check_subject_present(abstract_values[0], title)
    res.failures += check_blacklists(abstract_values + highlight_values)
    res.failures += check_information_gain(abstract_text, title, description,
                                           minimum=INFO_GAIN_MINIMUM.get(family, 8))
    fabricated = check_no_fabricated_tokens(abstract_values + highlight_values, source)
    if fabricated:
        res.failures.append(f"G2 tokens absent from source: {fabricated[:5]}")

    if res.failures:
        return res

    res.abstract_enriched = abstract_text
    res.abstract_spans = abstract_values
    res.keyhighlights_enriched = highlight_values
    res.span_offsets = [(l.start, l.end) for l in located_abstract + located_high]
    res.passed = True
    return res
