"""The quality and correctness gates. Pre-selection bans and post-selection checks, one file.

WHAT IS DELIBERATELY MISSING: `run_gates()`.
  `span_gate.run_gates()` existed in the historical code and the live runner never called it.
  A gate was "fixed" inside it twice; every unit test passed and the pipeline behaved exactly as
  before, because the real path was inlined somewhere else. Porting it would carry the defect
  across the refactor.

  So it is not ported. There is exactly one live path -- `pipeline.evaluate_selection` -- and it
  composes the primitives below. `test_gate_wiring.py` asserts that a gate added here is reached
  by the CLI command, not merely that it exists.

TWO KINDS OF GATE, AND THE DIFFERENCE COST 589 RECORDS
  * A POOL gate is a property of one CANDIDATE -- its section, the text after it, the text
    itself. Ask it BEFORE the model picks and the bad candidate never reaches the menu.
  * A SELECTION gate is a property of the CHOSEN SET -- span count, spread, mixed languages,
    information gain. It can only be asked afterwards.

  Running pool-shaped gates after selection quarantined 589 of 2,800 Blog records, almost all of
  them pages holding forty other usable sentences. If a verdict depends only on the page, ban the
  candidate; never the record.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

from .canonical import Canon, canonicalise, detect_language, is_speech
from .filters import drop_reason
from .repair import _adjacent_after

# ---------------------------------------------------------------------------
# locate: find a string in a source body and slice the SOURCE's own text for it
# ---------------------------------------------------------------------------

_TRIM = " \t\n\r\"'“”‘’.,;:!?…()[]"

# How far apart abstract spans may sit in the source. Raised from 8,000 to 20,000 on pilot
# evidence: 8,000 rejected a long-form article whose spans were title + thesis + conclusion,
# 13,545 apart. Abstracting a long article REQUIRES reaching across it. 20,000 still blocks
# stitching across a 60,000-character page.
_MAX_SPAN_SPREAD = 20_000

# Raised from 2 to 4. Legitimate cases used 3 and 4 sections (intro + a fact + a claim); 5+ still
# blocks. Loosen to what the data supports, do not remove.
_MAX_SPAN_SECTIONS = 4


@dataclass
class Located:
    stored_text: str      # canonical text, sliced from the SOURCE. This is what is indexed.
    original_text: str    # exact original substring, for provenance
    start: int            # original offset
    end: int
    occurrences: int      # how many times it appears; >1 means the offset is one of several
    section: str = ""
    section_index: int = 0
    is_quoted: bool = False
    followed_by: str = ""


class SpanRejected(Exception):
    """A span could not be located in the source."""

    def __init__(self, span: str, reason: str):
        super().__init__(f"{reason}: {span[:80]!r}")
        self.span = span
        self.reason = reason


def locate(model_span: str, source: Canon) -> Located:
    """Find `model_span` in the source and return the SOURCE's own text for it.

    The returned stored_text is cut from the source, never from the caller's string. There is no
    fuzzy fallback: canonical exact match or nothing.

    In v0 the writer returns IDs, so this is not on the write path -- it is the primitive that
    validation and live verification use to answer "is this stored string on this page?" without
    trusting any offset.
    """
    needle = canonicalise(model_span).text.strip()
    if not needle:
        raise SpanRejected(model_span, "empty after canonicalisation")

    hay = source.text
    pos = hay.find(needle)
    if pos == -1:
        # One bounded retry: edge punctuation or wrapping quotes may differ. Still an exact
        # match, just on a trimmed needle.
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
    return Located(
        stored_text=needle,
        original_text=stored,
        start=o_start,
        end=o_end,
        occurrences=occurrences,
        section=source.section_title(pos),
        section_index=source.section[pos] if source.section else 0,
        is_quoted=any(source.quoted[pos:c_end]) if source.quoted else False,
        followed_by=hay[c_end : c_end + 140].lstrip(),
    )


# ---------------------------------------------------------------------------
# contamination: a span that is real but came from a DIFFERENT page
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
    """Offending tokens; empty means pass.

    Belt-and-braces. Grounding already proves each span is present; this catches the case
    grounding cannot -- a span that is real but came from a stale cache or a mis-threaded batch.
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
# chrome, self-reference, section and reversal
# ---------------------------------------------------------------------------

# Two kinds of chrome, and conflating them cost 6 good records.
#
# ALWAYS: a sentence mentioning these IS site furniture whatever else it says.
_CHROME_ALWAYS = [
    "cookie", "consent banner", "newsletter", "share this", "follow us",
    "all rights reserved", "privacy policy", "terms of service",
]
# CTA: these appear inside perfectly good prose -- "...or contact sales for volume pricing" is a
# real fact about how to buy. They only disqualify a span when the span IS the button.
_CHROME_CTA = [
    "contact sales", "book a demo", "sign up for", "subscribe to", "related article",
    "get started for free", "start free trial",
]
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

# Headings whose content must NOT become an abstract: the page is not ABOUT these, and a sentence
# lifted out of them inverts or misattributes. A verbatim span from "Common mistakes" read as a
# recommendation.
_SECTION_DENY = re.compile(
    r"common mistake|common error|troubleshoot|deprecat|legacy|no longer|changelog|"
    r"release note|what customers tell us|testimonial|in their words|related (article|read)|"
    r"further reading|next step|see also|anti-pattern|what not to",
    re.I,
)

# Sections that only narrow the MENU. Kept SEPARATE from _SECTION_DENY on purpose: widening the
# gate would retroactively change the verdict on already-accepted records, while narrowing the
# menu can never turn a good record bad -- the worst it can do is cost a candidate.
_EXTRA_SECTION_DENY = re.compile(
    r"sign[ -]?up|register (now|today|for)|free trial|webinar|"
    r"contact (us|sales|support)|customer support|support (cent(er|re)|portal)|help cent(er|re)|"
    r"navigation|table of contents|on this page|share this|about the author|"
    r"subscribe|stay (up to date|informed)|get started today",
    re.I,
)

# A span is a setup for its own contradiction when the text immediately after it reverses course.
# Selecting the setup and dropping the reversal is how verbatim text lies.
_REVERSAL = re.compile(
    r"^(it does not|it doesn't|it cannot|it can't|that is not|this is not|this is incorrect|"
    r"however|but |actually|in fact|wrong|incorrect|not true|avoid|do not|don't|"
    r"unfortunately|in reality)",
    re.I,
)


def check_blacklists(values: list[str]) -> list[str]:
    """A chrome phrase only disqualifies a span when the span IS chrome, not when it mentions it.

    Substring matching rejected 6 legitimate records because "contact sales" appears inside real
    sentences on commercial pages. A call-to-action button is a SHORT span that is mostly the
    phrase; a sentence that happens to contain it is not.
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


def check_subject_present(first_span: str, title: str) -> list[str]:
    """Span 1 must name its own subject, or it is meaningless in a result list."""
    if not first_span.strip():
        return ["abstract span 1 is empty"]
    words = first_span.split()
    # Word 0 counts when it is a known proper noun. Skipping it on the theory that a leading
    # capital is only sentence-start failed "Algolia focuses on search speed." for naming no
    # subject. It names it. A bare "The" or "It" still fails, which is the case this exists for.
    _GENERIC_OPENERS = {"the", "it", "this", "that", "these", "those", "there", "they",
                        "we", "you", "our", "its", "a", "an", "and", "but", "if", "when"}
    has_proper = any(w[:1].isupper() for w in words[1:]) or (
        bool(words) and words[0][:1].isupper()
        and words[0].strip(".,;:").lower() not in _GENERIC_OPENERS
    )
    title_tokens = {t.lower().strip(".,;:") for t in title.split() if t.lower() not in _STOP}
    shares_title = any(w.lower().strip(".,;:") in title_tokens for w in words)
    has_digit = any(c.isdigit() for c in first_span)
    if has_proper or shares_title or has_digit:
        return []
    return [f"abstract span 1 names no subject: {first_span[:60]!r}"]


_TRAILING_CLOSERS = "\"'’”)]»"

# Profiles whose abstract spans must end a sentence.
#
# `api_facts` is EXCLUDED, and that exclusion is load-bearing. An API page's lede -- its one-line
# statement of what the endpoint does -- carries no full stop, and banning it cost the reference
# family 18 of 50 calibration pages: the instruction asks the abstract to lead with exactly that
# sentence, the prompt forbids marked entries, so the model had nothing legal to choose.
#
# Editorial prose has no such lede. Its period-less spans are cuts, not ledes -- 20 of them in the
# Blog run, every one a run-on. The rule is applied where it is true and withheld where it is not.
_ABSTRACT_MUST_TERMINATE = frozenset({
    "editorial_summary", "announcement_summary", "case_study_summary",
    "resource_summary", "product_summary",
})


def check_integrity(abstract: list[str], highlights: list[str], span_range: tuple[int, int],
                    abstract_shape: str = "", highlight_max: int = 8) -> list[str]:
    errs: list[str] = []
    lo, hi = span_range
    if not (lo <= len(abstract) <= hi):
        errs.append(f"abstract span count {len(abstract)} outside profile range {lo}-{hi}")
    if len(highlights) > highlight_max:
        errs.append(f"highlight count {len(highlights)} exceeds {highlight_max}")

    allv = abstract + highlights
    for v in allv:
        if not v.strip():
            errs.append("empty span")
    # Over-long highlights are NOT a record failure. Length is a property of one span, so the fix
    # is to drop that span, not to fail a record whose abstract is fine.
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

    # ABSTRACT SPANS ONLY. The abstract is read as one paragraph, so a span with no full stop runs
    # into the next one and asserts a link neither span makes. Highlights render as a list, where
    # a bullet without a full stop is normal prose. Measured on Blog: 350 period-less highlights
    # were fine, 20 period-less abstract spans were run-ons.
    for v in (abstract if abstract_shape in _ABSTRACT_MUST_TERMINATE else []):
        t = v.rstrip()
        while t and t[-1] in _TRAILING_CLOSERS:
            t = t[:-1]
        if t and t[-1] not in ".!?":
            errs.append(f"abstract span does not end a sentence, so it runs into the next: "
                        f"...{v.rstrip()[-48:]!r}")
    # A trailing colon fails everywhere: it promises a list the span does not contain.
    for v in allv:
        if v.rstrip().endswith(":"):
            errs.append(f"span ends in a colon, promising a list it does not contain: "
                        f"{v.strip()[:48]!r}")
    return errs


def check_context(abstract: list, highlights: list, allow_quotes: bool = False,
                  original_length: int = 0, seen_length: int = 0,
                  max_span_distance: int | None = None) -> list[str]:
    """MISLEADING SELECTION -- the gate that catches imagination, not hallucination.

    An adversarial probe got four misleading-but-verbatim abstracts past every grounding check.
    Every word was on the page; the meaning was wrong anyway:

      1. a customer's quote about a COMPETITOR, stored as the page's own claim
      2. a sentence from "Common mistakes", stored as a recommendation -- the page's next
         sentence was "It does not.", so dropping it inverted the meaning
      3. a sentence from a "Deprecated" section, stored as current product fact
      4. two unrelated true sentences juxtaposed so the pair implies a link the page never made

    Verbatim means "these words are on the page". It does not mean "this is what the page says".
    Those are different claims and only the first one is free.
    """
    errs: list[str] = []

    for loc in abstract + highlights:
        where = "abstract" if loc in abstract else "highlight"

        # (1) someone else's words presented as the page's own -- but only when the blockquote is
        # actually speech. A blockquoted lede is the page's own voice. Test against original_text
        # as well: a trimmed match strips the wrapping quotation marks that are the evidence.
        if (getattr(loc, "is_quoted", False) and not allow_quotes
                and is_speech(loc.original_text, loc.stored_text)):
            errs.append(
                f"{where} span is a quotation attributed to someone else "
                f"under {loc.section!r}: {loc.stored_text[:60]!r}")

        # (2) the page contradicts this sentence immediately afterwards
        if _REVERSAL.match(getattr(loc, "followed_by", "") or ""):
            errs.append(
                f"{where} span is followed by a reversal "
                f"({loc.followed_by[:30]!r}) -- selecting it inverts the meaning: "
                f"{loc.stored_text[:60]!r}")

        # (3) a section whose content is not what the page is about
        if loc.section and _SECTION_DENY.search(loc.section):
            errs.append(f"{where} span taken from excluded section {loc.section!r}: "
                        f"{loc.stored_text[:60]!r}")

    # (4) false juxtaposition -- PARTIAL. Two true sentences side by side can assert something
    # neither says. Only partly mechanical: an abstract built from a page's intro plus one key
    # fact is legitimate and common, so "same section only" would reject most good abstracts.
    # Two bounds are enforced; the residual judgement is the judge's, and it is NOT guaranteed.
    if len(abstract) > 1:
        distinct = {l.section_index for l in abstract}
        if len(distinct) > _MAX_SPAN_SECTIONS:
            errs.append(
                f"abstract spans drawn from {len(distinct)} different sections "
                f"(limit {_MAX_SPAN_SECTIONS}) -- juxtaposition implies a link the page "
                f"does not make")
        # (5) mixed languages inside one abstract. Both sentences can be genuinely on the page --
        # localised pages carry untranslated English -- and still be wrong to store together.
        langs = {detect_language(l.stored_text) for l in abstract}
        langs.discard("?")
        if len(langs) > 1:
            errs.append(
                f"abstract mixes languages {sorted(langs)} -- the page carries untranslated "
                f"text and the spans are not consistent with each other")

        # THE DENOMINATOR MUST BE HOW MUCH TEXT THE MODEL SAW.
        #
        # It used to be the position of the LAST SELECTED SPAN, which has nothing to do with
        # truncation and inverted the whole check: the tighter and higher up the page a selection
        # sat, the smaller the denominator and the bigger the multiplier. One page picked three
        # CONSECUTIVE sentences 204 characters apart and was rejected for spanning "~37,708
        # characters". That was the single largest failure bucket in its run, every one of them a
        # well-formed adjacent pick -- while a genuinely scattered selection from the bottom of a
        # page had a denominator so large it sailed through.
        #
        # No seen_length means no scaling. Silence must not invent a multiplier.
        spread = max(l.end for l in abstract) - min(l.start for l in abstract)
        if original_length and seen_length and original_length > seen_length:
            spread = int(spread * (original_length / seen_length))
        limit = max_span_distance if max_span_distance else _MAX_SPAN_SPREAD
        if spread > limit:
            errs.append(
                f"abstract spans span ~{spread} characters of the original page (limit {limit}) "
                f"-- stitched from unrelated parts of the document")

    return errs


def check_information_gain(abstract_text: str, title: str, description: str,
                           minimum: int = 8) -> list[str]:
    """Must add content words absent from title+description.

    3,340 records in this index already have abstract == description byte-for-byte, so this is a
    proven defect, not a hypothetical. On a case study the lede is almost always a compressed
    restatement of the meta description: without this gate you get 237 grounded, faithful,
    useless abstracts and every other gate passes.

    THE THRESHOLD IS PER-PROFILE, and a flat 8 was wrong. On an API reference page the title IS
    the endpoint name and the description IS what it does, so a faithful abstract necessarily
    repeats them. Measured on 16 such failures the gains were 0,0,0,1,1,2,3,3,3,4,4,6,6,6,7,7:
    a bar of 3 recovers 10 and still rejects 0/1/2, which is the case this gate exists for.
    Lowering it to 1 would gut the gate.
    """
    known = {w.lower().strip(".,;:!?()[]\"'") for w in f"{title} {description}".split()}
    new = {
        w.lower().strip(".,;:!?()[]\"'")
        for w in abstract_text.split()
        if w.lower().strip(".,;:!?()[]\"'") not in _STOP
    } - known
    new = {w for w in new if len(w) > 2}
    if len(new) < minimum:
        return [f"information gain {len(new)} < {minimum} new content tokens"]
    return []


def check_template_collision(abstracts: list[str], threshold: int = 20) -> dict[str, int]:
    """Whole-corpus sameness. Cannot be seen from inside a single record.

    Hash the first 8 tokens of every stored abstract: a prefix appearing more than `threshold`
    times is a template, not an abstract. Returns {prefix: count} for every offending cluster.
    """
    counts: dict[str, int] = {}
    for a in abstracts:
        if not a:
            continue
        prefix = " ".join(a.split()[:8]).lower()
        if prefix:
            counts[prefix] = counts.get(prefix, 0) + 1
    return {p: c for p, c in counts.items() if c > threshold}


# ---------------------------------------------------------------------------
# POOL GATES -- the post-selection gates, asked BEFORE the model picks
# ---------------------------------------------------------------------------

# An extension that swallows this much text is no longer "the sentence plus its contrast", it is
# a paragraph.
_MAX_EXTENDED_CHARS = 600

BAN_REVERSAL = "REVERSAL_UNREPAIRABLE"
BAN_SECTION = "EXCLUDED_SECTION"
BAN_SECTION_EXTRA = "EXCLUDED_SECTION_EXTRA"
BAN_BLACKLIST = "BLACKLIST"
BAN_SPEECH = "SPEECH_QUOTE"
FIX_REVERSAL_EXTENDED = "REVERSAL_EXTENDED"


def opener_ineligible(cand, title: str) -> bool:
    """True when this candidate cannot legally OPEN an abstract.

    Positional, not intrinsic. Uses the same subject check as the gate, so the menu flag and the
    gate cannot disagree.
    """
    return bool(check_subject_present(cand.text, title or ""))


def _static_ban(cand, allow_quotes: bool) -> str | None:
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
    if (getattr(cand, "is_quoted", False) and not allow_quotes
            and is_speech(getattr(cand, "original", "") or cand.text, cand.text)):
        return BAN_SPEECH
    return None


def resolve_reversal(cand, pool: list, canon, max_extensions: int = 2):
    """Extend a reversed span over its own contradiction, or report that it cannot be.

    Returns (candidate_or_None, trace). The returned text is one contiguous slice of the page.
    Same-block only: the contradiction is the next sentence, and a cross-block jump would be the
    false adjacency that spans are stored as arrays to avoid.
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
    trace.append(
        f"candidate {cand.index}: still reversed after {max_extensions} extensions -- banned")
    return None, trace


def apply_pool_gates(cands: list, canon, title: str, unfiltered: list | None = None,
                     description: str = "", allow_quotes: bool = False,
                     extra_patterns: tuple = ()):
    """(kept, counts_by_reason, trace, opener_ineligible_indices).

    `unfiltered` is the pre-filter candidate list and is what adjacency is measured against: the
    filter leaves holes in page order, and the sentence that completes a contrast may well be one
    the filter dropped.

    Candidates keep their ORIGINAL `.index`. Renumbering would break the one guarantee the
    pipeline has -- the model returns an index, and that index must address the same span the
    menu showed it.
    """
    adjacency_pool = unfiltered if unfiltered is not None else cands
    kept, counts, trace = [], {}, []

    def bump(reason: str) -> None:
        counts[reason] = counts.get(reason, 0) + 1

    for cand in cands:
        reason = _static_ban(cand, allow_quotes)
        if reason is not None:
            bump(reason)
            continue
        fixed, t = resolve_reversal(cand, adjacency_pool, canon)
        trace += t
        if fixed is None:
            bump(BAN_REVERSAL)
            continue
        if fixed is not cand:
            # RE-FILTER THE EXTENSION. The filter ran on the ORIGINAL candidate, and an extension
            # is a different sentence -- longer, carrying words the short version did not. Two
            # abstracts in a repair run grew far enough to restate the record's own title, which
            # is the exact thing the filter exists to prevent and which it had no chance to see.
            after = drop_reason(fixed, description, title, extra_patterns)
            if after is not None:
                bump(f"EXTENSION_{after}")
                continue
            bump(FIX_REVERSAL_EXTENDED)
        kept.append(fixed)

    ineligible = {c.index for c in kept if opener_ineligible(c, title)}
    return kept, counts, trace, ineligible


# --- the retry ladder's half: failures -> what to change about the pool --------------------

_SPREAD_LIMIT = 20_000


def retry_constraints(failures: list[str], sel, cands: list, title: str,
                      ineligible: set[int]) -> tuple[set[int], str]:
    """(indices to ban on the retry, a human reason) -- empty set means retry cannot help.

    A gate failure names WHICH sentence was wrong, and that is enough to narrow the menu and ask
    again, which is what a person would do. Quarantining on the first refusal throws the page
    away to punish one sentence.

    Matching on the failure STRING is deliberate and is the reason each gate message is a stable
    sentence. Structured codes are the better design and a bigger change than this refactor
    should carry; the strings are asserted in tests so a reword cannot silently turn the ladder
    off.
    """
    ban: set[int] = set()
    reasons: list[str] = []

    if any("names no subject" in f for f in failures):
        ban |= ineligible
        reasons.append(f"{len(ineligible)} subject-less candidates banned from the menu")

    if any("characters of the original page" in f for f in failures):
        if sel.abstract:
            anchor = min(c.start for c in sel.abstract)
            far = {c.index for c in cands if abs(c.start - anchor) > _SPREAD_LIMIT // 2}
            ban |= far
            reasons.append(f"{len(far)} candidates outside a {_SPREAD_LIMIT // 2}-char window "
                           f"around offset {anchor} banned")

    if any("mixes languages" in f for f in failures):
        langs = [detect_language(c.text) for c in sel.abstract]
        known = [l for l in langs if l != "?"]
        majority = max(set(known), key=langs.count) if known else "?"
        odd = {c.index for c in sel.abstract
               if detect_language(c.text) not in (majority, "?")}
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
