"""ONE canonicalisation. Extracted from span_gate.py, which is where it did not belong.

WHY THIS MODULE EXISTS SEPARATELY
  `canonicalise()` is not a gate. It is the coordinate system every other stage works in:
  candidate slicing cuts spans out of `Canon.text`, repair extends over `Canon.text`, artifact
  validation looks a stored string up in `Canon.text`, and live verification does the same
  against a re-fetched body. Four consumers, one projection.

  Both Blog grounding failures were the same defect: two code paths canonicalised the same
  characters differently, so a span sliced verbatim out of a page reported as ungrounded.
  The markdown-link branch skipped the typographic fold and the space-before-punctuation rule
  that the main loop applied. Nothing was wrong with the spans.

  Keeping this in one module does not by itself prevent divergence -- the divergence was WITHIN
  one function. `test_canonical.py` asserts idempotence and branch parity directly, which is the
  check that would have caught it.

CANONICALISATION IS PURELY SUBTRACTIVE.
  It deletes formatting characters, collapses whitespace, and folds typographic variants 1:1.
  It can never introduce a word. That is what lets a canonical match still prove every word came
  off the page, and it is why every mapping in `_FOLD` is exactly one character to one character:
  `origin[i]` must stay an exact index into the original string.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field

# Emphasis and code markers that carry no words. `_` is deliberately NOT here:
# stripping it would corrupt snake_case identifiers, which are the substance of
# the reference records.
_DROP_CHARS = set("*`~")

# Table cell separators. Stripping these only at line start is not enough -- a markdown
# table puts them BETWEEN cells, so `| name | required |` kept its inner pipes. Treated as
# whitespace rather than deleted, so two cells never fuse into one false word.
_SPACEY = set("|")

# Typographic variants folded to their ASCII equivalent FOR MATCHING ONLY.
#
# Every LLM normalises typography when it copies: the page says `Algolia’s` with U+2019 and the
# model writes `Algolia's` with U+0027. Safe because the STORED text is sliced out of the source,
# so it keeps the page's original characters -- only the lookup key is folded. Every mapping is
# strictly 1:1, so the canonical->original offset map stays exact. `…` is deliberately NOT mapped:
# it would need 1->3 characters and break that invariant.
_FOLD = {
    "‘": "'", "’": "'", "‛": "'", "ʼ": "'", "´": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "«": '"', "»": '"',
    "–": "-", "—": "-", "‑": "-", "−": "-",
    " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
}

# A space before closing punctuation. algolia.com's own prose contains `percentage points , with`
# and every model silently corrects it while copying. Dropping the space on BOTH sides makes the
# faithful copy match. Subtractive, so it cannot introduce a word.
_SPACE_BEFORE_PUNCT = set(",.;:!?")

# An HTML/JSX tag. Length-bounded and newline-free on purpose: a comparison in prose
# ("if count < 5 and total > 3") must not be swallowed as a tag. Must open with a letter,
# `/` or `!`, or the comparison is silently eaten.
_TAG = re.compile(r"</?[A-Za-z!][^<>\n]{0,300}>")

# Line-leading markdown furniture: headings, blockquotes, list bullets, table pipes.
#
# No `^` anchor, and consumed in a LOOP. `pattern.match(text, i)` already anchors at i, whereas
# `^` only matches at the true start of the string unless re.MULTILINE is set -- so an anchored
# version fires on the first line of a document and silently never again. The loop is needed
# because real markdown stacks furniture: blockquoted headings, nested list bullets.
_LINE_LEAD = re.compile(r"[ \t]*(?:#{1,6}|>+|[-+*]|\d+\.|\|)[ \t]*")

# Block-boundary detection, used only to fill Canon.block.
#
# The ONE case where a source newline does NOT end a block is a hard-wrapped paragraph. A wrapped
# line is long by construction -- it ran out of width. A nav label, a CTA, an all-caps banner and
# a "00 TAGE" timer segment are short and unpunctuated. So: no terminal punctuation AND at least
# _WRAP_MIN characters means the sentence continues; anything else ends the block.
#
# Getting this backwards is the expensive direction: a false SOFT wrap re-merges a timer with the
# headline after it, while a false HARD break only splits one sentence in two and both halves are
# then labelled sentence_complete=False rather than being sold as prose.
_WRAP_MIN = 60
_TERMINAL_PUNCT = frozenset(".!?:;")
_TRAILING_CLOSERS = "\"'’”)]»"


def _ends_a_sentence(emitted: list[str]) -> bool:
    """Did the line just ended finish a sentence? Ignores trailing quotes and brackets."""
    k = len(emitted) - 1
    while k >= 0 and emitted[k] in _TRAILING_CLOSERS:
        k -= 1
    return k >= 0 and emitted[k] in _TERMINAL_PUNCT


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
    # selection: it strips `>` so a customer quote becomes indistinguishable from the page's own
    # claim, and it strips `#` so a "Deprecated" heading vanishes. The structure has to be
    # captured while it is still visible.
    section: list[int] = field(default_factory=list)
    quoted: list[bool] = field(default_factory=list)
    sections: list[str] = field(default_factory=list)
    # block[i] is the id of the source BLOCK canonical char i came from. Canonicalisation
    # collapses every newline to a space, so without this a nav bar, a countdown timer and an
    # all-caps banner arrive at the splitter as one unbroken string; having no punctuation they
    # are never cut. Measured on Blog: 31.6% of all candidates were mid-sentence fragments.
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

    def emit(ch: str, at: int) -> None:
        out.append(ch)
        origin.append(at)
        sect.append(cur_section)
        quoted.append(cur_quoted)
        blk.append(cur_block)

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
            # remembering it, "the line I just left was a heading" is unknowable. A long
            # unpunctuated heading then looks exactly like a hard-wrapped paragraph and is merged
            # with the prose under it.
            prev_heading = is_heading
            line_emitted = 0

            at_line_start = False
            if j > i:
                i = j
                continue

        ch = _FOLD.get(text[i], text[i])

        # HTML / JSX tag -> separator. algolia.com's doc markdown embeds <section> and
        # <Card title="..." /> blocks; without this they survive canonicalisation and a
        # model can select a span full of markup.
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
                # A single newline INSIDE the label is normal -- real markdown hard-wraps. A blank
                # line means it is not a link, and a very long label means the `](` belongs to
                # some later link.
                label_ok = (close - i) <= 300 and "\n\n" not in text[i:close]
                end_paren = text.find(")", close + 2)
                if label_ok and end_paren != -1 and "\n" not in text[close:end_paren]:
                    label = text[i + 1 : close]
                    for k, raw_lch in enumerate(label):
                        # FOLD HERE TOO, and apply the SAME space-before-closing-punctuation rule
                        # as the main loop below. Any divergence between this branch and that one
                        # makes canonicalise() non-idempotent, which breaks the only guarantee
                        # that matters: a span sliced from the page must be findable in the page.
                        # Both known divergences -- the missing fold and the missing punctuation
                        # rule -- produced false "not grounded" verdicts on faithful spans.
                        # `test_canonical.py::test_link_branch_matches_plain_branch` pins it.
                        lch = _FOLD.get(raw_lch, raw_lch)
                        if lch.isspace():
                            pending_space = True
                            continue
                        if lch in _DROP_CHARS:
                            continue
                        nxt_l = label[k + 1] if k + 1 < len(label) else ""
                        closing_l = (lch in _SPACE_BEFORE_PUNCT and not nxt_l.isalnum())
                        if pending_space and closing_l:
                            pending_space = False
                        if pending_space:
                            if out:
                                emit(" ", i + 1 + k)
                                line_emitted += 1
                            pending_space = False
                        emit(lch, i + 1 + k)
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

        # Clear the flag even when `out` is empty. Leaving it set deferred a space onto the SECOND
        # character of the first word -- "R eal prose".
        if pending_space:
            # ...unless the next character is CLOSING punctuation. `points , with` and
            # `points, with` must canonicalise identically; models fix that typo silently.
            #
            # "Closing" is load-bearing. A test of `ch in ",.;:!?"` alone also fires on a LEADING
            # dot: `a .NET API Client` canonicalises to `a.NET`. A closing mark is followed by a
            # space, another mark, or the end of the text. A mark followed immediately by a letter
            # or digit is OPENING something -- `.NET`, `:8080`, `?q=1` -- and the space in front
            # of it is real.
            closing_punct = (ch in _SPACE_BEFORE_PUNCT
                             and not (i + 1 < n and text[i + 1].isalnum()))
            if out and not closing_punct:
                emit(" ", i)
                line_emitted += 1
            pending_space = False

        emit(ch, i)
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


def canon_text(text: str) -> str:
    """The canonical string alone. The offset-free lookup key used by every validator."""
    return canonicalise(text).text.strip()


def canon_contains(haystack_canon: str, needle: str) -> bool:
    """Is `needle` present in an already-canonicalised body, canonically?

    THE offset-free grounding primitive. Both sides go through the same function, which is the
    whole point -- the two Blog failures were two functions disagreeing.
    """
    k = canon_text(needle)
    return bool(k) and k in haystack_canon


# ---------------------------------------------------------------------------
# text predicates that belong to the projection, not to any gate
# ---------------------------------------------------------------------------
#
# `is_speech` and `detect_language` live here rather than in gates.py for one structural reason:
# candidates.py needs `is_speech` to decide the [QUOTED] menu label, and gates.py needs
# candidates.py. Putting it in gates.py makes that a cycle. It is also the honest home -- both are
# properties of text, not decisions about a record.

# A blockquote is only SOMEONE ELSE'S words if it is punctuated as speech or carries an
# attribution. algolia.com blockquotes the page's OWN one-line summary right under the H1, and
# treating every `>` as a quotation rejected the single best sentence on every /doc page.
_SPEECH_MARK = re.compile(r'["“”„«»]')
_ATTRIBUTION = re.compile(r"[—–]\s*[A-Z]")


def is_speech(*texts: str) -> bool:
    """Is this someone else talking, rather than the page in its own voice?

    THE ONE DEFINITION. The G10 quotation gate decides whether to reject a span with it, and
    `render_menu` decides whether to show a [QUOTED] label with it. Those two used to disagree,
    and that disagreement cost the reference family its lede on 49 of 50 calibration pages.

    Pass every string that might carry the evidence -- typically original_text AND stored_text,
    because a trimmed match can strip the wrapping quotation marks that are the proof.
    """
    blob = " ".join(t for t in texts if t)
    return bool(_SPEECH_MARK.search(blob) or _ATTRIBUTION.search(blob))


# Stopword counting, deliberately crude: enough to FLAG a mixed-language abstract, not to
# adjudicate language.
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


_FENCE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE = re.compile(r"`[^`]*`")
_HTML = re.compile(r"<[^>]+>")


def prose_chars(markdown: str) -> int:
    """Characters of actual prose: code fences, inline code, HTML tags and line-leading
    furniture removed. Computed by script BEFORE any model call, so a THIN decision never depends
    on a model counting characters -- which models cannot do.
    """
    t = _FENCE.sub(" ", markdown)
    t = _INLINE_CODE.sub(" ", t)
    t = _HTML.sub(" ", t)
    lines = []
    for line in t.split("\n"):
        stripped = _LINE_LEAD.sub("", line)
        if len(stripped.split()) >= 4:
            lines.append(stripped)
    return len(canonicalise(" ".join(lines)).text)


def canonical_version() -> str:
    """A hash of the normalisation RULES, for `effective-config.json`.

    Hashing the rule tables rather than the file means a comment edit does not invalidate a run,
    while a changed fold, dropped character or altered furniture pattern does. A stored span is
    only findable under the rules that produced it, so this number is what says whether two runs
    are comparable.
    """
    payload = repr([
        sorted(_DROP_CHARS), sorted(_SPACEY), sorted(_FOLD.items()),
        sorted(_SPACE_BEFORE_PUNCT), _TAG.pattern, _LINE_LEAD.pattern,
        _WRAP_MIN, sorted(_TERMINAL_PUNCT), _TRAILING_CLOSERS,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
