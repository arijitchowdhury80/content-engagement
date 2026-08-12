#!/usr/bin/env python3
"""
Enrichment runner — the loop. Fetch is already done by fetch_router; this does:

    LLM #1 (writer)  select spans + verdict          claude -p, this machine's session
    G1..G10          scripted gates                  span_gate.py  <-- the guarantee
    LLM #2 (judge)   quality only, cross-vendor      Gemini
    Gate B           judge's own span substring-checked
    output           validation pack for human review

CROSS-VENDOR ON PURPOSE
  Arijit, 2026-08-07: writer on `claude -p` in this session, judge on Gemini. That is the
  strongest independence available -- the reviewer shares no training data and no failure modes
  with the writer. A judge from the same family as the writer agrees with it for the wrong
  reasons.

WHAT THE JUDGE IS AND IS NOT ASKED
  It is NOT asked "is this hallucinated". G1 already settled that by construction: the stored
  text is sliced out of the source and the model's own string is discarded. The judge is asked
  the question no script can answer -- is this selection representative, specific, and does the
  COMBINATION of spans imply something the page never said.

PILOT MODE WRITES NOTHING TO ALGOLIA. Output is files for a human to read.

  python3 docs/70-enrichment/enrich_run.py --pilot            # all cached pilot records
  python3 docs/70-enrichment/enrich_run.py --pilot --limit 3  # smoke test first
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import os
import pathlib
import random
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from span_gate import (canonicalise, check_blacklists, check_context, check_information_gain,
                       check_subject_present, check_template_collision, INFO_GAIN_MINIMUM, locate,
                       prose_chars, run_gates, SpanRejected)  # noqa: E402
from candidates import render_menu, resolve_selection, split_candidates  # noqa: E402
from pool_filters import filter_pool  # noqa: E402
from pool_gates import apply_pool_gates, retry_constraints  # noqa: E402
from span_repair import (incomplete_reason, repair_span,  # noqa: E402
                         repair_or_drop_highlights)
from verdicts import (canonical_index, classify as classify_verdict,  # noqa: E402
                      language_mismatch)
import boilerplate as g8  # noqa: E402
from curl_secret import curl as secret_curl  # noqa: E402

CACHE_DIR = HERE / "cache"
REPORTS = HERE / "reports"
FAMILIES = json.loads((HERE / "prompts" / "shape-families.json").read_text())["families"]

# G8 -- corpus-wide boilerplate. Built by boilerplate.py from the fetched pages, loaded once.
# A missing file yields an empty set and G8 simply does not apply; it never breaks the run.
# Rebuild it whenever the fetched set grows:
#   python3 docs/70-enrichment/boilerplate.py --cache <cache dir> --out docs/70-enrichment/boilerplate-map.json
BOILERPLATE_MAP_PATH = HERE / "boilerplate-map.json"

# url -> objectID for the whole corpus. Loaded once: REDIRECT_CANONICAL needs to answer "is the
# page we were actually served already owned by another record?" and that is a corpus-wide question.
CANONICAL_INDEX = canonical_index() if (HERE / "work-queue.jsonl").exists() else {}

# G8 PREVENTION IS OFF BY DEFAULT. It was built on 2026-08-08, measured, and made things WORSE.
#
#                     run1   run2   v1.2 (no G8)   v1.3 (G8 on)
#   coherence         2.88   2.85       4.62           4.21
#   PASS               15     15         25             20
#   NO_ABSTRACT_THIN    6      4          3              8
#
# The flaw is structural, not a threshold to tune: **a sentence can be furniture on ten pages and
# be the content on the eleventh -- the page it is actually about.** /fr/awards is a page ABOUT
# Algolia's awards. G8 marked its award sentences as boilerplate because they also appear in the
# footer of ten other pages, and the page went from 8 prose candidates to 1, then to THIN. Four
# records were lost that way. G8 was right about the sentences and wrong about the page.
#
# 2026-08-08, second attempt: the guard is now built (candidates._guard_boilerplate). If the map
# claims more than half a page's prose, that page IS the boilerplate's home and G8 is undone for
# it. Verified before re-enabling: /fr/awards 8 prose -> 8 (spared), both infographic pages spared,
# while content-rich pages still get it -- /fr/customers/walgreens 40 -> 33, /devcon 9 -> 7.
# MEASURED AGAIN (v1.4) AND IT LOST AGAIN. Off, and this is now a considered verdict, not a pause.
#   guard works: /fr/awards kept all 8 prose candidates, both infographic pages spared.
#   result still worse: PASS 23 vs 25, records with an abstract 31 vs 34, coherence 4.52 vs 4.62 --
#   and v1.4 also carried the span-order fix, which should have HELPED it.
# So the guard fixed the crash-out case and G8 still does not pay for itself on this corpus. The
# remaining cost is ordinary pages losing a few genuinely useful sentences to the map.
# Arijit's own review says the defect is real (record 7: press-release key points contaminated by
# the promo modules), so this is kept, not deleted -- but it needs a sharper signal than
# "appears on >20% of paths" before it earns being on. Do not flip this without a measured run.
# G8 STAYS OFF. Measured a third time on 2026-08-09 and reverted the same night.
#
# It had already lost twice on the mixed fresh50 corpus (coherence 4.21 then 4.52 vs 4.62). Run F
# tested it properly on `reference` with a map rebuilt from that family's own cache (77 entries vs
# the general map's 20), after pre-checking that the >50%-of-prose guard fires on 0 of the 50 pages
# and only /doc/tools/cli/commands -- already genuinely THIN -- loses candidates.
#
#     run E, G8 off : 70% writable, 27 clean enriched, 58% finished, 8 leaked
#     run F, G8 on  : 66% writable, 26 clean enriched, 56% finished, 7 leaked
#
# Every delta is inside the measured +/-2-record noise floor, so the honest reading is NO EFFECT --
# not "worse". Reverted because a null result does not justify carrying a second, family-scoped map
# that has to be rebuilt per corpus.
#
# WHY it did nothing is the useful part: G8 removed the sentences that leaked in run E and the model
# simply selected the next-most-repeated one. On a TEMPLATED API reference corpus, recurrence is not
# evidence of furniture -- "Create, update, delete, and search for synonyms." appears on 20 pages
# because the synonym endpoints share a generated preamble, and it does describe its page. Any
# frequency-threshold gate plays whack-a-mole here. The map is NOT kept -- rebuild it with
#   python3 docs/70-enrichment/boilerplate.py --cache <cache dir> --out <map.json>
# which takes seconds and cannot go stale, unlike a saved copy.
#
# AND NOTE: this was all measured on doc-md-twin bodies. Under HARD RULE 11 (Scout-only) it is
# diagnostic, not decisive. Scout output has different chrome, so G8 deserves one fresh measurement
# on Scout bodies before being written off for good.
G8_ENABLED = False
BOILERPLATE = g8.load(BOILERPLATE_MAP_PATH) if G8_ENABLED else set()

# Writer default switched to Algolia's own inference server, 2026-08-07 (Arijit).
#   claude -p : ~$0.16/record (37,571 tokens of built-in tool schema per call), ~30s, and NO
#               temperature control -- the same page gave THIN on one run and REAL on the next,
#               which breaks Chapter 4's requirement to re-run and get the same spans.
#   glm-5.2   : Algolia infrastructure, 1.6s, temperature 0 accepted -> reproducible. Same
#               inference layer the Agent Studio agents use.
# Still cross-vendor against the Gemini judge, so independence is preserved.
WRITER = "glm"                           # "glm" | "claude"
WRITER_MODEL = "sonnet"                  # used only when WRITER == "claude"
GLM_MODEL = "large"                      # resolves to glm-5.2 on the Algolia endpoint
# JUDGE, DISABLED IN PRODUCTION 2026-08-10 (Arijit banned Gemini; measurement then showed the
# judge gated nothing -- see the long note at the call site in process()).
#
# Kept importable so the offline review sampler can still score 100-200 records per source.
# If it is ever re-enabled, it must NOT run on `large` or `xlarge` of the Algolia inference
# server: both serve glm-5.2, which is the writer, and a model grading its own output is not
# a check. `medium` (gemma-4-31b-it) is a genuinely different family. Verified 2026-08-10.
JUDGE_ENABLED = os.environ.get("ENRICH_JUDGE", "on").lower() in ("1", "on", "true")
JUDGE_MODEL = os.environ.get("ENRICH_JUDGE_MODEL", "small")   # gemma-4-26b on Algolia inference
# Reflects what actually ran, not what the file version is. Same discipline as WRITER_LABEL below:
# a report headed "v1.3" when G8 was off would misattribute v1.2 results to a design that lost.
PROMPT_VERSION = "abstract_enrichment_v1.3" if G8_ENABLED else "abstract_enrichment_v1.3-g8off"

# ONE source of truth for what to call the writer in a report.
#
# There were five. The per-record field (below, and correct) derived it from WRITER, while four
# report headers hardcoded f"claude-{WRITER_MODEL}". So both fresh50 summaries are headed
# "writer `claude-sonnet`" while every row inside them says `glm-5.2`. Nobody was misled yet only
# because the rows were read instead of the header -- a report that exists to be trusted was
# stating a false provenance, and provenance is the whole argument for this pipeline.
WRITER_LABEL = "glm-5.2" if WRITER == "glm" else f"claude-{WRITER_MODEL}"


# ---------------------------------------------------------------------------
# prompt assembly
# ---------------------------------------------------------------------------

def family_instruction(family: str) -> str:
    """Render the per-family block substituted into {family_instruction}.

    `abstract_must_not_be` is optional and exists because saying what to lead with was not enough
    for `reference`. That family's instruction already said "lead with what the method/endpoint/
    parameter does", and the model still opened with HTTPS, response format and API version on all
    three doc-rest-api records in Arijit's review. Doc pages put transport boilerplate first, so
    the first plausible sentence IS the boilerplate. A negative is needed, not a clearer positive.
    """
    spec = FAMILIES[family]
    out = (
        f"This is: {spec['what_it_is']}\n"
        f"  Lead the abstract with: {spec['abstract_must_lead_with']}.\n"
        f"  Highlights here are: {spec['highlights_are']}."
    )
    if spec.get("abstract_must_not_be"):
        out += f"\n  NEVER open the abstract with: {spec['abstract_must_not_be']}."
    return out


SELECT_PROMPT = """You are choosing which of a page's own sentences matter. You do NOT write or
copy any text. You return ONLY numbers.

PAGE METADATA
  url            : {url}
  title          : {title}
  page_type      : {page_type}
  shape family   : {family}
  language       : {language_code}

Below is every sentence on this page, numbered, grouped under its section heading.

HOW THE LIST IS MARKED
  Unmarked      a complete sentence of the page's own body text. These are what you want.
  [QUOTED]      inside a blockquote - someone else speaking, not the page.
  [UI]          button, nav label, banner or countdown text. Not a sentence.
  [HEADING]     a section heading, not a statement.
  [FRAGMENT]    a piece of a sentence. It does not start or end where a sentence does.
  [NONPROSE]    markup, code or configuration data that survived into the text.
  [BOILERPLATE] a well-formed sentence that appears on MANY other pages of this site - an award
                or analyst mention, a chat prompt, a cookie notice. It reads perfectly well and
                it says nothing about THIS page. You cannot tell from the sentence alone; we
                counted the other pages for you.
  [NOT-FIRST]   a real body sentence, but it opens with "It"/"They"/"This" and never names what
                it is about. Perfectly good as your SECOND or third pick; meaningless as your
                first, because a search result shows the opening words and "It lets multiple
                programs exchange data" tells a reader nothing. This is the ONE mark that does
                not disqualify an entry -- it only bars it from position one.
  [ALREADY INDEXED] this sentence is ALREADY STORED on the record, word for word, as the
                description shown below. It is usually the page's opening line and it is usually
                the best-written sentence on the page. Choosing it adds nothing a search already
                has, so it is spoken for. Everything you write must be new next to it.

  Picking a marked entry for the abstract produces something unreadable. A previous version of
  this list was unmarked, and the abstracts that came back welded a "Book a demo" button to a
  subheading, and a countdown timer to a headline. That is what the marks are for.

  [BOILERPLATE] is the one you must trust us on: those sentences look like exactly what you want.
  An earlier version of this list did not mark them and four pages came back described entirely in
  terms of Algolia's analyst awards, with the page's actual subject never mentioned.

STEP 1 - VERDICT
    REAL  a genuine content page with sentences about a subject
    DEAD  an error page, "not found", or a sign-in wall
    THIN  a real page with almost no prose: a link list, a menu, nothing but code
  If DEAD or THIN, return empty arrays and set insufficient_reason.

STEP 2 - ABSTRACT: pick {span_min} to {span_max} numbers whose sentences together say what this
page is and what a reader gets from it.
{family_instruction}
  - Use UNMARKED entries only. Never [UI], [HEADING], [FRAGMENT], [NONPROSE], [BOILERPLATE]
    or [ALREADY INDEXED]. [NOT-FIRST] is the one exception: usable, but never as your first pick.
  - THIS RECORD ALREADY STORES:
        title:       {title}
        description: {description}
    Your abstract must add something a reader would not get from those two lines. Restating them
    is the single most common way this task fails.
  - The FIRST number you pick must be a sentence that names its own subject.
  - Read the whole list before choosing, then ask: is there ONE sentence that already summarises
    this page? Pages usually contain one. If it exists, pick it and stop -- {span_min} is a
    complete answer and a single clear sentence beats three that merely touch the topic.
  - The sentences you pick will be joined together and read as one paragraph. Read your choice
    back in order before answering. If it does not read as connected prose, change it.
  - Do NOT pick a [QUOTED] sentence unless the family is evidence: it is someone else speaking.
  - Do NOT pick from a "Common mistakes", "Troubleshooting", "Deprecated" or "Legacy" section.
  - Do NOT pick a sentence the page contradicts immediately afterwards.
  - Do NOT pick a sentence that is only about the page itself ("In this guide we will...").

STEP 3 - HIGHLIGHTS: pick 3 to 8 numbers carrying the page's concrete specifics -- numbers,
limits, names, versions, named capabilities. Prefer sentences a person would find useful in a
search result. Do not repeat an abstract number. Fewer is correct when the page has less.
  - Each highlight is read ALONE in a search result, so each must stand on its own.
  - Unmarked entries only here too. A [HEADING] is not a highlight; the sentence under it is.
  - A [BOILERPLATE] award or analyst mention is never a highlight for this page. It belongs to
    every page, so it distinguishes none of them.

STEP 4 - LANGUAGE: report the language the sentences are actually written in.

OUTPUT - one JSON object, nothing else. NUMBERS ONLY, never text:
{{"verdict":"REAL|DEAD|THIN","abstract":[12,15],"highlights":[18,22],
"language_observed":"en","insufficient_reason":null}}

insufficient_reason must be null or exactly one of: ERROR_PAGE, LOGIN_REQUIRED, NO_PROSE,
LINKS_ONLY, CODE_ONLY, LANGUAGE_MISMATCH, PAYWALL.

Any sentence you want is already in the list. If you find yourself wanting to write words, pick a
number instead. When unsure, return THIN.

NUMBERED SENTENCES
==================
{menu}
==================
Return only the JSON object."""


WRITER_PROMPT = """You are an extraction tool operating on one web page. You do not write prose.
You select existing text from the page and label it.

PAGE METADATA
  url            : {url}
  title          : {title}
  source         : {source}
  page_type      : {page_type}
  shape family   : {family}
  expected language : {language_code}

ABSOLUTE CONSTRAINT - checked mechanically after you answer
  Every span you return must be text ALREADY PRESENT in PAGE_MARKDOWN. Copy it out; do not
  compose it.
    - Do not paraphrase, summarise, shorten or smooth.
    - Do not translate. Return the language the page is written in.
    - Do not merge text from two different parts of the page into one span.
    - Do not fix typos or change wording, even when clearly wrong.
  You MAY drop markdown syntax (**bold**, `code`, [link](url), #, >, |) and you MAY write a
  wrapped sentence on one line - formatting is normalised on both sides before the check.
  Changing a WORD is not allowed. A span whose words are not on the page discards the record.

STEP 1 - VERDICT
    REAL  a genuine content page carrying human-written sentences about a subject
    DEAD  an error page, "not found" page, sign-in wall, or a page whose only content is an
          error or an invitation to log in
    THIN  a real page with almost no prose: a link list, a menu, a bare table of contents, or
          nothing but code
  Do not count characters. Judge it as a reader would.
  verdict_evidence: one span copied from the page justifying the verdict. For REAL it must NOT
  be one of your abstract_spans - it is independent evidence, not a repeat.
  If DEAD or THIN: return empty arrays and set insufficient_reason. Returning nothing is the
  correct answer, not a failure.

STEP 2 - ABSTRACT SPANS (only when REAL)
  Select {span_min} to {span_max} units of the page's own text stating what this page is and what
  a reader gets from it.
{family_instruction}
  Rules:
    - A span is one complete unit: a sentence, a list row, or a table row. On API and SDK pages
      there is often no full sentence - a parameter row is a valid span, and one span is a valid
      answer.
    - The FIRST span must name its own subject: a proper noun, product name, or the page's topic.
      A span beginning "It also supports..." or "This means that..." is rejected.
    - Prefer body text over hero banners and meta descriptions.
    - Never select from a cookie notice, nav menu, related-links block, author bio, newsletter
      signup, or footer.
    - Never select a sentence only about the page itself ("In this guide we will...").
    - Never select from a "Common mistakes", "Troubleshooting", "Deprecated" or "Legacy" section,
      and never select a sentence the page contradicts immediately afterwards.
    - Never select someone else's quotation as if it were the page's own claim.
    - If the substance is inside code blocks and the prose is only scaffolding, that is THIN.

STEP 3 - KEY HIGHLIGHT SPANS (only when REAL)
  Select 3 to 8 spans carrying the page's concrete specifics.
    - Verbatim. May be a sentence, list item, or heading.
    - Each independently meaningful when read alone in a search result.
    - Prefer spans containing a number, limit, name, version, or named capability.
    - No span may duplicate, contain, or be contained by another, or repeat an abstract span.
    - Fewer is correct when the page has less. Do not pad.

STEP 4 - LANGUAGE
  language_observed: the language PAGE_MARKDOWN is actually written in (en, de, fr, other).
  Report what you see. A mismatch is a finding we need, not an error to hide.

OUTPUT - one JSON object, nothing else, no commentary, no code fence.
{{"verdict":"REAL|DEAD|THIN","verdict_evidence":"...","abstract_spans":["..."],
"keyhighlights_spans":["..."],"language_observed":"en","insufficient_reason":null}}

insufficient_reason must be null or exactly one of: ERROR_PAGE, LOGIN_REQUIRED, NO_PROSE,
LINKS_ONLY, CODE_ONLY, LANGUAGE_MISMATCH, PAYWALL. Do not invent a reason.

WHEN UNSURE return THIN with a reason. Under-reporting is always the correct failure direction.

PAGE_MARKDOWN
=============
{markdown}
=============
Return only the JSON object."""


JUDGE_PROMPT = """You are reviewing an extraction, not writing one. Every sentence below was
copied verbatim from the page - that is already machine-verified, so faithfulness is NOT your
concern. Do not comment on it.

Judge only whether this selection REPRESENTS the page.

PAGE_TYPE: {page_type}
TITLE: {title}

ABSTRACT:
{abstract}

HIGHLIGHTS:
{highlights}

PAGE:
=============
{markdown}
=============

Score each 1-5:
  representativeness  Does the abstract convey what this page is mainly about, or is it a
                      peripheral sentence?
  specificity         Would this help someone scanning search results decide to click, or is it
                      generic enough to describe a hundred other pages?
  missed_substance    Is there a materially more informative sentence on the page that was passed
                      over? 5 = nothing better was available.
  coherence           Do the spans read as belonging together?
  juxtaposition       Read the spans as one paragraph. Does the COMBINATION assert anything the
                      page does not actually say? Two true sentences side by side can imply a
                      causal or conditional link neither states. Score 1 if the pairing misleads
                      even though each sentence is individually accurate. This is the one failure
                      the scripted gates cannot settle, so weigh it carefully.

Return ONLY this JSON, no code fence:
{{"representativeness":1,"specificity":1,"missed_substance":1,"coherence":1,"juxtaposition":1,
"better_span_available":null,"verdict":"ACCEPT","notes":""}}

verdict is REVISE if any score is 1 or 2, else ACCEPT.
better_span_available, if given, must be copied VERBATIM from PAGE - it is substring-checked
exactly like the writer's spans, and an invented suggestion fails YOUR review."""


# ---------------------------------------------------------------------------
# model calls
# ---------------------------------------------------------------------------

def extract_json(text: str) -> dict | None:
    """Models wrap JSON in prose or fences however much you ask them not to."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


# Flags matter here, and each one was earned by a failure:
#
#   --system-prompt      REPLACES the default system prompt. Without it the subprocess inherits
#                        Arijit's global ~/.claude/CLAUDE.md, and the first pilot record came back
#                        as an Instruction Ledger ("1. Extract page: done.") instead of JSON --
#                        the sub-Claude correctly obeying Guardrail #2. CLAUDE_CONFIG_DIR would
#                        also isolate it but takes the OAuth session with it ("Not logged in").
#   --exclude-dynamic…   drops cwd/env/git-status sections; irrelevant to extraction.
#   --strict-mcp-config  drops every MCP server schema. Cut per-call overhead 50,638 -> 37,571
#                        tokens, $0.19 -> $0.14, then -> $0.11 with hooks off.
#   --disallowed-tools   the writer must not touch the filesystem or network. It reads the page
#                        text it was given and returns JSON. Nothing else.
#   stream-json          THE important one. Arijit's `ledger-gate.sh` is a *Stop* hook: it blocks
#                        the subprocess from ending its turn and forces a SECOND message holding
#                        an instruction ledger. With --output-format json, `result` carries only
#                        the LAST message, so the correct JSON from message 1 was discarded and
#                        every record read as unparseable. The hook was doing its job to a process
#                        that is not a conversation.
#                        Two fixes were tried and rejected:
#                          --settings '{"hooks":{}}'  the CLI MERGES settings, it does not replace
#                                                     them, so the hook still fired.
#                          --max-turns 1              made the whole call is_error:true, throwing
#                                                     away the good turn-1 answer as well.
#                        stream-json emits every assistant message, so we scan them all and take
#                        the one that parses. Immune to anything appended after the answer.
WRITER_SYSTEM_PROMPT = (
    "You are a strict text-extraction tool. Your entire response is exactly one JSON object. "
    "Never output an instruction ledger, a preamble, a summary, a code fence, or any commentary. "
    "You select existing sentences from text you are given; you never write new prose."
)
CLAUDE_FLAGS = [
    "--output-format", "stream-json", "--verbose",
    "--system-prompt", WRITER_SYSTEM_PROMPT,
    "--exclude-dynamic-system-prompt-sections",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--disallowed-tools",
    "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit",
]


def _inference_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    for line in (HERE.parents[1] / ".env.local").read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    base, key = env.get("ALGOLIA_INFERENCE_BASE_URL"), env.get("ALGOLIA_INFERENCE_API_KEY")
    if not base or not key:
        sys.exit("FATAL: ALGOLIA_INFERENCE_BASE_URL / _API_KEY missing from .env.local")
    return base, key


# ---------------------------------------------------------------------------
# retry layer -- required before any parallel run
# ---------------------------------------------------------------------------
#
# THE GAP THIS CLOSES
#   Neither model call had a retry, a backoff, or any 429 handling -- only a timeout. A transient
#   failure returned None and the record was recorded as failed and never revisited. Sequentially,
#   at one request at a time, that almost never fired. At 8 concurrent workers against ~7,700
#   Gemini calls it is a certainty, and it would have silently dropped records across the corpus
#   while every batch reported success. That is the false-green class this project keeps hitting.
#
#   Neither call could even SEE an HTTP status: plain `curl -s` prints only the body, so a 429 with
#   an empty body was indistinguishable from a network blip. The status is now captured explicitly.
#
# WHAT IS AND IS NOT RETRIED
#   Retried: transport failure (curl non-zero), 408/425/429 and 5xx, and a body that is not JSON.
#   Retried ONCE more generously: a well-formed response whose CONTENT will not parse -- v1.4 hit
#   one WRITER_UNPARSEABLE, and a reasoning model producing malformed JSON is nondeterministic, so
#   a retry is worth an attempt.
#   NOT retried: a 4xx that is not a rate limit. That is a bad request and repeating it just burns
#   quota and time.
_RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
_RETRY_ATTEMPTS = 4
_RETRY_BASE_SECONDS = 2.0
_HTTP_MARK = "__HTTP_STATUS__"


def _curl_json(args: list[str], timeout: int,
               attempts: int = _RETRY_ATTEMPTS,
               secret_headers: dict[str, str] | None = None) -> tuple[dict | None, int, str, str]:
    """Run curl with retries. Returns (parsed_body, http_status, raw_text, note).

    `note` is empty on success and carries the reason on failure, so a giving-up call is
    diagnosable in the report instead of appearing as an unexplained gap.

    `secret_headers` are passed through curl's stdin config, never argv -- an API key in a command
    line is readable by any local process via `ps`. Callers must not put credentials in `args`.
    """
    # -w appends the status on its own line; the body is everything before it.
    # `args` no longer carries the leading "curl": secret_curl supplies it.
    full = [*args, "-w", f"\n{_HTTP_MARK}%{{http_code}}"]
    note = ""
    for attempt in range(1, attempts + 1):
        proc = secret_curl([*full, "--max-time", str(timeout)], secret_headers or {})
        out = proc.stdout
        status = 0
        if _HTTP_MARK in out:
            out, _, tail = out.rpartition(f"\n{_HTTP_MARK}")
            status = int(tail.strip() or 0)

        if proc.returncode != 0:
            note = f"curl exit {proc.returncode}"
        elif status in _RETRYABLE_STATUS:
            note = f"HTTP {status}"
        else:
            try:
                return json.loads(out), status, out, ""
            except json.JSONDecodeError:
                note = f"non-JSON body (HTTP {status}): {out[:120]}"
                if status and status not in _RETRYABLE_STATUS and status >= 400:
                    return None, status, out, note      # a real 4xx; repeating it is pointless

        if attempt < attempts:
            # exponential backoff with jitter -- 8 workers retrying in lockstep would re-create
            # the burst that caused the 429 in the first place
            delay = _RETRY_BASE_SECONDS * (2 ** (attempt - 1)) * (1.0 + random.random())
            print(f"      retry {attempt}/{attempts - 1} in {delay:.1f}s ({note})", flush=True)
            time.sleep(delay)
    return None, 0, "", f"gave up after {attempts} attempts: {note}"


def call_writer_glm(prompt: str, timeout: int = 180) -> tuple[dict | None, dict]:
    """LLM #1 via Algolia's inference server (glm-5.2), OpenAI-compatible.

    max_tokens must be GENEROUS: glm-5.2 is a reasoning model and its reasoning tokens are
    charged against the completion budget. At max_tokens=120 the response came back with
    reasoning_tokens=121 and completely EMPTY content -- the same trap that made gemini-2.5-pro
    look unavailable earlier.
    """
    base, key = _inference_env()
    body = json.dumps({
        "model": GLM_MODEL, "temperature": 0, "max_tokens": 4000,
        "messages": [{"role": "system", "content": WRITER_SYSTEM_PROMPT},
                     {"role": "user", "content": prompt}],
    })
    data, status, raw, note = _curl_json(
        ["-s", f"{base}/chat/completions",
         "-H", "Content-Type: application/json", "-d", body],
        timeout, secret_headers={"Authorization": f"Bearer {key}"})
    meta: dict = {"cost_usd": 0.0, "raw": raw[:400], "writer": "glm-5.2", "http_status": status}
    if data is None:
        meta["raw"] = note or raw[:400]
        return None, meta
    if "error" in data:
        meta["raw"] = str(data["error"])[:300]
        return None, meta
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError):
        return None, meta
    meta["raw"] = text[:400]
    meta["usage"] = data.get("usage")
    parsed = extract_json(text)
    if parsed is None:
        # A reasoning model emitting malformed JSON is nondeterministic, so one more attempt is
        # worth it. v1.4 lost a record to exactly this (WRITER_UNPARSEABLE).
        meta["retried_unparseable"] = True
        data2, _, raw2, _ = _curl_json(
            ["-s", f"{base}/chat/completions",
             "-H", "Content-Type: application/json", "-d", body],
            timeout, attempts=1, secret_headers={"Authorization": f"Bearer {key}"})
        if data2:
            try:
                text2 = data2["choices"][0]["message"]["content"] or ""
                parsed = extract_json(text2)
                if parsed is not None:
                    meta["raw"] = text2[:400]
            except (KeyError, IndexError):
                pass
    return parsed, meta


def call_writer_claude(prompt: str, timeout: int = 300) -> tuple[dict | None, dict]:
    """LLM #1 via `claude -p`. No API key needed; uses this machine's session."""
    proc = subprocess.run(
        ["claude", "-p", "--model", WRITER_MODEL, *CLAUDE_FLAGS],
        input=prompt, capture_output=True, text=True, timeout=timeout,
        cwd="/tmp",  # keep the CLI out of this repo so it cannot read project context
    )
    meta: dict = {"cost_usd": 0.0, "raw": "", "turns": 0}
    messages: list[str] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "assistant":
            for block in event.get("message", {}).get("content", []):
                if block.get("type") == "text" and block.get("text"):
                    messages.append(block["text"])
        elif event.get("type") == "result":
            meta["cost_usd"] = event.get("total_cost_usd", 0.0) or 0.0
            meta["turns"] = event.get("num_turns", 0)

    meta["raw"] = (messages[-1] if messages else proc.stdout)[:400]
    meta["messages"] = len(messages)
    # Take the FIRST message that parses into our schema. A Stop hook can append an instruction
    # ledger after the answer; that must not cost us the record.
    for text in messages:
        parsed = extract_json(text)
        if parsed and "verdict" in parsed:
            if text is not messages[0]:
                meta["recovered_from_later_message"] = True
            return parsed, meta
    return None, meta


def call_writer(prompt: str, timeout: int = 300) -> tuple[dict | None, dict]:
    """Dispatch to the configured writer. The gates are identical either way -- the guarantee
    is scripted, so swapping the writer changes selection quality, never safety."""
    if WRITER == "glm":
        return call_writer_glm(prompt)
    return call_writer_claude(prompt, timeout)


def call_judge(prompt: str, timeout: int = 240) -> tuple[dict | None, str]:
    """LLM #2, quality only. Runs on the Algolia inference server, NOT Gemini.

    WHY IT MOVED, 2026-08-10
      Arijit banned Gemini. Before swapping anything in, the candidates were measured against 40
      records Gemini had already judged in the blog run:

          small   gemma-4-26b-a4b   40/40 parsed   100% verdict agreement   0.82 s/record
          medium  gemma-4-31b-it    40/40 parsed    95% verdict agreement   1.55 s/record
          (gemini-2.5-pro was ~13 s/record)

      Per-dimension deltas on `small` were within +/-0.07 across all five scores. So `small` is a
      genuine drop-in: same verdicts, 16x faster, no external vendor.

    WHY NOT `large` OR `xlarge`
      Both serve **glm-5.2**, which is the WRITER -- `GLM_MODEL = "large"` at the top of this file.
      A judge on either would be the writer grading its own output, which is not a check at all.
      The tier names hide this; it was verified against the API, not assumed:

          small -> gemma-4-26b-a4b-nvfp4     medium -> gemma-4-31b-it-nvfp4
          large -> glm-5.2                   xlarge -> glm-5.2   (identical to large)

    WHAT THIS JUDGE DOES AND DOES NOT DO
      It scores quality. It does NOT carry the zero-invention guarantee -- that is structural, from
      the writer returning INDICES into a list this script built from the page. And as wired today
      it does not GATE either: `write_enrichment.WRITABLE` accepts both PASS and JUDGE_REVISE, so
      across 3,069 blog rows the judge's verdict changed the outcome for zero records. Making it
      gate is a policy decision, not a code detail.

    Returns (verdict, failure_reason). The reason is kept so a judge failure is diagnosable in the
    report rather than an unexplained gap.
    """
    base, key = _inference_env()
    body = json.dumps({
        "model": JUDGE_MODEL, "temperature": 0, "max_tokens": 2000,
        "messages": [{"role": "user", "content": prompt}],
    })
    data, status, raw, note = _curl_json(
        ["-s", f"{base}/chat/completions",
         "-H", "Content-Type: application/json", "-d", body],
        timeout, secret_headers={"Authorization": f"Bearer {key}"})
    if data is None:
        return None, note or f"no response (HTTP {status}): {raw[:120]}"
    if "error" in data:
        return None, f"api error: {str(data['error'])[:140]}"
    choices = data.get("choices") or []
    if not choices:
        return None, f"no choices: {str(data)[:140]}"
    msg = (choices[0].get("message") or {}).get("content") or ""
    if not msg.strip():
        return None, f"empty content, finish_reason={choices[0].get('finish_reason')}"
    parsed = extract_json(msg)
    if parsed is None:
        return None, f"unparseable judge JSON, finish_reason={choices[0].get('finish_reason')}"
    return parsed, ""


# ---------------------------------------------------------------------------
# one record end to end
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class Attempt:
    """One pass of resolve -> repair -> gate over a writer response.

    `ban_hint` is what the pool must lose for the NEXT attempt to be different. An empty hint means
    asking again would produce the same answer, so the ladder stops rather than burning a call.
    """
    ok: bool
    failures: list = dataclasses.field(default_factory=list)
    ban_hint: set = dataclasses.field(default_factory=set)
    reason: str = ""
    sel: object = None
    abstract_spans: list = dataclasses.field(default_factory=list)
    highlight_spans: list = dataclasses.field(default_factory=list)
    repair_trace: list = dataclasses.field(default_factory=list)


def evaluate_selection(llm: dict, pool: list, unfiltered: list, canon, rec: dict,
                       family: str, span_range: tuple, ineligible: set) -> Attempt:
    """Resolve the model's integers, repair what the page can repair, then run the gates.

    Pulled out of process() so the retry ladder can run it more than once. It is the WHOLE live
    path, gates included -- there is no second copy. That matters: this repo has twice shipped a
    "fix" into a gate function nothing calls (`span_gate.run_gates`), and both times every unit
    test passed while the pipeline behaved exactly as before. Tests must drive THIS.
    """
    trace: list[str] = []
    sel = resolve_selection(llm.get("abstract"), llm.get("highlights"), pool, span_range)
    if not sel.passed:
        # A protocol error -- wrong count, out-of-range index. Banning candidates cannot fix it,
        # so no hint: the ladder stops and the record is reported honestly.
        return Attempt(ok=False, failures=list(sel.failures), sel=sel, repair_trace=trace)

    # SOURCE-GROUNDED REPAIR. A colon lead-in or a mid-sentence cut is a bad CUT, not a bad page:
    # the words that finish the thought are the next few ON THE PAGE. `unfiltered` is the adjacency
    # pool because the filters leave holes in page order.
    repaired, unrepairable = [], set()
    for c in sel.abstract:
        reason = incomplete_reason(c.text, is_abstract=True)
        if reason is None:
            repaired.append(c)
            continue
        fixed, t = repair_span(c, unfiltered, canon, is_abstract=True)
        trace += [f"abstract {c.index} {reason}: {x}" for x in t]
        if fixed is not None:
            repaired.append(fixed)
        else:
            unrepairable.add(c.index)
    if unrepairable:
        return Attempt(
            ok=False, sel=sel, repair_trace=trace, ban_hint=unrepairable,
            reason=f"abstract candidates {sorted(unrepairable)} cannot be completed from the page",
            failures=[f"abstract span {i} is incomplete and the page offers no grounded completion"
                      for i in sorted(unrepairable)])
    sel.abstract = repaired

    pre_high = [c for c in sel.highlights if len(c.text) <= 300
                and (len(c.text.split()) >= 6 or any(ch.isdigit() for ch in c.text))]
    kept_high, htrace, enough = repair_or_drop_highlights(
        pre_high, unfiltered, canon, used={c.index for c in sel.abstract},
        replacement_pool=pool)
    trace += htrace
    if not enough:
        return Attempt(
            ok=False, sel=sel, repair_trace=trace,
            ban_hint={c.index for c in sel.highlights},
            reason="highlights could not be repaired or replaced",
            failures=[f"only {len(kept_high)} clean highlights survived repair and replacement "
                      f"(minimum 3)"])
    sel.highlights = kept_high

    abstract_spans = [c.text for c in sel.abstract]
    highlight_spans = [c.text for c in sel.highlights]

    # Belt and braces: nothing incomplete may reach storage, repaired or not.
    residual = [f"{'abstract' if i < len(abstract_spans) else 'highlight'} span still "
                f"{incomplete_reason(s, is_abstract=i < len(abstract_spans))} after repair: {s[-60:]!r}"
                for i, s in enumerate(abstract_spans + highlight_spans)
                if incomplete_reason(s, is_abstract=i < len(abstract_spans))]
    if residual:
        return Attempt(ok=False, sel=sel, repair_trace=trace, failures=residual,
                       ban_hint={c.index for c in sel.abstract + sel.highlights},
                       reason="a span was still incomplete after repair")

    failures: list[str] = []
    failures += check_context(sel.abstract, sel.highlights, family,
                              rec.get("original_length") or 0,
                              seen_length=len(rec["markdown"]))
    failures += check_subject_present(abstract_spans[0], rec.get("title", ""))
    failures += check_blacklists(abstract_spans + highlight_spans)
    failures += check_information_gain(" ".join(abstract_spans), rec.get("title", ""),
                                       rec.get("description", ""),
                                       minimum=INFO_GAIN_MINIMUM.get(family, 8))
    if not failures:
        return Attempt(ok=True, sel=sel, abstract_spans=abstract_spans,
                       highlight_spans=highlight_spans, repair_trace=trace)

    ban, why = retry_constraints(failures, sel, pool, rec.get("title", ""), ineligible)
    return Attempt(ok=False, sel=sel, failures=failures, ban_hint=ban, reason=why,
                   repair_trace=trace)


def process(rec: dict) -> dict:
    family = rec["family"]
    spec = FAMILIES[family]
    span_min, span_max = spec.get("expected_span_count", [1, 4])
    markdown = rec["markdown"]

    out: dict = {
        "objectID": rec["objectID"],
        "url": rec["url"],
        "source_url": rec["source_url"],
        "page_type": rec["page_type"],
        "family": family,
        "language_code": rec["language_code"],
        "fetch_path": rec["fetch_path"],
        "pilot_reason": rec.get("pilot_reason", ""),
        "content_hash": rec["content_hash"],
        "truncated": rec.get("truncated", False),
        "prose_chars": prose_chars(markdown),
        "writer_model": WRITER_LABEL,
        "judge_model": JUDGE_MODEL,
        "prompt_version": PROMPT_VERSION,
        "processed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "served_url": rec.get("served_url", ""),
        "redirect_mismatch": rec.get("redirect_mismatch", False),
    }

    # --- honest verdicts, BEFORE any model call ---------------------------
    #
    # A login wall, a failed fetch, or a page that served a different document than we asked for
    # are all terminal. Deciding them here costs no model call and, for the redirect case, is the
    # only place it CAN be decided: once a body reaches the splitter, every span cut from it looks
    # perfectly verbatim, because it is -- from the wrong page.
    terminal = classify_verdict(rec, CANONICAL_INDEX)
    if terminal is not None:
        out.update(terminal)
        return out

    # --- LLM #1: numbers only, no content ---------------------------------
    #
    # The model picks from a numbered list the SCRIPT built from this page, and returns integers.
    # It never emits content, so an invented word has nowhere to appear. This replaced a
    # copy-the-text design that lost whole records to transcription slips -- GLM wrote
    # "10. August 2026" where the page said "August 2026" and the record was discarded.
    # `already_indexed` is the record's own description. On 49 of 49 reference pages it is
    # byte-identical to the page's opening line, so without this the model's most attractive pick
    # is a sentence the index already holds -- measured: 26 of 50 records quarantined at
    # "information gain 0". Passing it here is what makes the duplicate unpickable rather than
    # merely discouraged.
    cands, canon = split_candidates(markdown, boilerplate=BOILERPLATE,
                                    already_indexed=rec.get("description", ""))
    out["candidates"] = len(cands)
    out["boilerplate_candidates"] = sum(1 for c in cands if c.kind == "boilerplate")
    out["already_indexed_candidates"] = sum(1 for c in cands if c.is_already_indexed)
    if not cands:
        out.update({"status": "NO_CANDIDATES", "verdict": "THIN",
                    "insufficient_reason": "NO_PROSE"})
        return out

    # POOL FILTER. Site furniture, chrome, code comments, corpus boilerplate and restatements of
    # the record's own description are removed BEFORE the menu is rendered, so they cannot be
    # picked rather than merely being discouraged. `render_menu` prints `c.index` and
    # `resolve_selection` keys on it, so a sparse index set stays correctly addressed -- the
    # filtered list is passed to BOTH, which is what keeps them in agreement.
    unfiltered = cands
    cands, dropped_counts, _dropped = filter_pool(
        cands, description=rec.get("description", ""), title=rec.get("title", ""))
    out["candidates_after_filter"] = len(cands)
    out["pool_dropped"] = dropped_counts
    if not cands:
        # Distinct from NO_CANDIDATES on purpose. The page HAD prose and the filter took all of it,
        # which is either an honest "this page is only furniture" or over-filtering. Counting it
        # separately is what makes the difference visible instead of hidden inside a THIN total.
        out.update({"status": "NO_CANDIDATES_AFTER_FILTER", "verdict": "THIN",
                    "insufficient_reason": "NO_PROSE",
                    "candidates_before_filter": len(unfiltered)})
        return out

    # POOL GATES. The post-selection gates, asked BEFORE the model picks.
    #
    # G10's reversal and excluded-section checks, and the self-reference/chrome blacklist, are all
    # properties of the CANDIDATE -- `followed_by`, `section`, the text itself. Running them after
    # selection meant one bad sentence killed the whole record: 589 of 2,800 blog records were
    # quarantined that way, and the page had forty other usable sentences in almost every case.
    # A candidate that would fail a gate is either REPAIRED (a reversal is extended over its own
    # contradiction, one contiguous slice) or removed from the menu, so the gate has nothing left
    # to fire on. Same move as the integer-index contract: make the wrong answer unrepresentable.
    cands, gate_ban_counts, gate_ban_trace, ineligible = apply_pool_gates(
        cands, canon, family, rec.get("title", ""), unfiltered=unfiltered,
        description=rec.get("description", ""))
    out["candidates_after_pool_gates"] = len(cands)
    out["pool_gate_dropped"] = gate_ban_counts
    if gate_ban_trace:
        out["pool_gate_trace"] = gate_ban_trace[:40]
    if not cands:
        out.update({"status": "NO_CANDIDATES_AFTER_FILTER", "verdict": "THIN",
                    "insufficient_reason": "NO_PROSE",
                    "candidates_before_filter": len(unfiltered),
                    "quarantine_stage": "pool_gates"})
        return out

    prompt = SELECT_PROMPT.format(
        url=rec["source_url"], title=rec.get("title", ""), page_type=rec["page_type"],
        description=rec.get("description", ""),
        family=family, language_code=rec["language_code"],
        span_min=span_min, span_max=span_max,
        family_instruction=family_instruction(family),
        menu=render_menu(cands, no_open=ineligible),
    )
    llm, meta = call_writer(prompt)
    out["writer_cost_usd"] = meta["cost_usd"]
    if llm is None:
        out.update({"status": "WRITER_UNPARSEABLE", "writer_raw": meta["raw"]})
        return out
    out["llm_output"] = llm
    out["verdict"] = llm.get("verdict")
    out["insufficient_reason"] = llm.get("insufficient_reason")

    # COUNTED, NOT GATED. /de/blog/... and /fr/blog/... serve the English article -- probed live
    # 2026-08-09, byte-identical with and without `Accept-Language: de-DE,de;q=0.9`. There is no
    # German body to prefer, so an English abstract is the true description of an English page.
    # Arijit's ruling: enrich all 2,800 and report the split. Recorded on every row so the packet
    # can state the number instead of a reader discovering it in the live index later.
    out["language_observed"] = llm.get("language_observed") or ""
    out["language_mismatch"] = language_mismatch(rec.get("language_code"),
                                                 llm.get("language_observed"))

    if llm.get("verdict") in ("DEAD", "THIN"):
        out["status"] = f"NO_ABSTRACT_{llm['verdict']}"
        return out

    # --- the selection ladder ---------------------------------------------
    #
    # ONE REFUSAL IS NOT A VERDICT ON THE PAGE. A gate failure says which sentence was wrong, and
    # that is enough to narrow the menu and ask again -- which is what a person would do. The old
    # code asked once and quarantined, and 589 blog records died holding pages with forty other
    # usable sentences.
    #
    # The ladder is bounded at MAX_SELECTION_ATTEMPTS and stops early whenever the failure yields
    # no ban hint, because asking the same question of the same menu returns the same answer and
    # would only burn a writer call. `evaluate_selection` is the whole live path, gates included.
    MAX_SELECTION_ATTEMPTS = 3
    menu_pool = cands
    banned: set[int] = set()
    repair_trace: list[str] = []
    attempt_log: list[str] = []
    llm_current = llm
    att = None

    for attempt_no in range(1, MAX_SELECTION_ATTEMPTS + 1):
        att = evaluate_selection(llm_current, menu_pool, unfiltered, canon, rec, family,
                                 (span_min, span_max), ineligible)
        repair_trace += att.repair_trace
        out["out_of_range_picks"] = getattr(att.sel, "out_of_range", [])
        if att.ok:
            break
        fresh = {i for i in att.ban_hint if i not in banned}
        if not fresh or attempt_no == MAX_SELECTION_ATTEMPTS:
            break
        banned |= fresh
        menu_pool = [c for c in cands if c.index not in banned]
        if len(menu_pool) < span_min:
            attempt_log.append(f"attempt {attempt_no}: banning {len(fresh)} left too few candidates")
            break
        attempt_log.append(f"attempt {attempt_no} failed ({att.reason or att.failures[:1]}); "
                           f"re-asking with {len(fresh)} candidates banned, "
                           f"{len(menu_pool)} left on the menu")
        llm_retry, meta_retry = call_writer(SELECT_PROMPT.format(
            url=rec["source_url"], title=rec.get("title", ""), page_type=rec["page_type"],
            description=rec.get("description", ""),
            family=family, language_code=rec["language_code"],
            span_min=span_min, span_max=span_max,
            family_instruction=family_instruction(family),
            menu=render_menu(menu_pool, no_open=ineligible),
        ))
        out["writer_cost_usd"] = out.get("writer_cost_usd", 0) + meta_retry["cost_usd"]
        if llm_retry is None:
            out.update({"status": "WRITER_UNPARSEABLE", "writer_raw": meta_retry["raw"],
                        "selection_attempts": attempt_log, "repair_trace": repair_trace})
            return out
        llm_current = llm_retry
        out["llm_output"] = llm_retry

    out["selection_attempts"] = attempt_log
    out["selection_attempt_count"] = len(attempt_log) + 1
    out["reselect_banned"] = sorted(banned)
    if repair_trace:
        out["repair_trace"] = repair_trace
        out["repaired"] = True

    out["gate_failures"] = att.failures
    out["gate_passed"] = att.ok
    if not att.ok:
        out["status"] = "QUARANTINED_BY_GATE"
        return out

    sel = att.sel
    abstract_spans = att.abstract_spans
    highlight_spans = att.highlight_spans

    out["abstract_spans_stored"] = abstract_spans
    out["abstract_enriched"] = " ".join(abstract_spans)
    out["keyhighlights_enriched"] = highlight_spans
    out["span_offsets"] = [[c.start, c.end] for c in sel.abstract + sel.highlights]
    out["dropped_fabrications"] = 0      # structurally impossible now
    gate = type("G", (), {"abstract_enriched": out["abstract_enriched"],
                          "keyhighlights_enriched": highlight_spans})()

    # --- LLM #2, quality only. OFF IN PRODUCTION since 2026-08-10. --------
    #
    # WHY IT WAS REMOVED, AND WHY THAT IS NOT A LOSS OF SAFETY
    #   Arijit banned Gemini on 2026-08-10. Measuring what the judge actually did before replacing
    #   it showed there was nothing to replace. Across all 3,069 rows of the blog run:
    #
    #       PASS          2,002   writable
    #       JUDGE_REVISE    378   ALSO writable  (write_enrichment.py:49)
    #
    #   Both verdicts are writable, so the judge's verdict changed the outcome for ZERO records.
    #   `better_span_available` was offered 332 times and is never substituted -- the code only
    #   validates it -- and 50 of those 332 were bad (35 incomplete, 15 not on the page).
    #
    #   It cost one LLM call per record, ~13s, roughly half the ~27s per-record wall clock.
    #
    #   The zero-invention guarantee never came from the judge. It is structural: the writer
    #   returns INDICES into a list this script built from the page, so an invented word has no
    #   route to the output. Removing the judge does not touch that.
    #
    # WHAT IS LOST
    #   The five advisory quality scores, and the `JUDGE_REVISE` status. Nothing that gated.
    #   Quality signal for humans now comes from an offline sampler over 100-200 records per
    #   source, which can run on `medium` (gemma-4-31b-it) -- a different family from the writer.
    #   `large` and `xlarge` on the Algolia inference server are BOTH glm-5.2, i.e. the writer
    #   itself, and must never be used to judge it. Verified 2026-08-10.
    #
    #   If a real quality GATE is ever wanted, its verdict has to change writability. Today's did
    #   not, and calling an advisory score a gate is how a pipeline acquires false assurance.
    if not JUDGE_ENABLED:
        out["judge"] = None
        out["judge_model"] = None
        out["judge_skipped"] = "disabled in production 2026-08-10; advisory only, gated nothing"
        out["status"] = "PASS"
        return out

    judge, judge_error = call_judge(JUDGE_PROMPT.format(
        page_type=rec["page_type"], title=rec.get("title", ""),
        abstract=gate.abstract_enriched,
        highlights="\n".join(f"- {h}" for h in gate.keyhighlights_enriched),
        markdown=markdown,
    ))
    if judge is None:
        out.update({"status": "JUDGE_UNAVAILABLE", "judge": None, "judge_error": judge_error})
        return out
    out["judge"] = judge

    # --- Gate B: the judge is checked too --------------------------------
    better = judge.get("better_span_available")
    if better:
        try:
            located = locate(better, canonicalise(markdown))
            out["judge_span_valid"] = True
            # THE JUDGE IS NOT EXEMPT. Its replacement span used to be located and accepted
            # without re-entering the completeness checks, so a judge-suggested colon lead-in
            # reached storage untouched -- two of the five defects that survived the 2026-08-09
            # fix came in through here. Same detector, same repair, same fallback.
            jtext = getattr(located, "stored_text", None) or better
            jreason = incomplete_reason(jtext, is_abstract=True)
            if jreason:
                out["judge_span_incomplete"] = jreason
                out["judge_discarded"] = (f"better_span_available is {jreason} and was not "
                                          f"substituted; the stored abstract is unchanged")
                out["judge_span_valid"] = False
        except SpanRejected:
            out["judge_span_valid"] = False
            out["judge_discarded"] = "better_span_available is not on the page"
    out["status"] = "PASS" if judge.get("verdict") == "ACCEPT" else "JUDGE_REVISE"
    return out


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------

def write_validation_pack(results: list[dict], out_dir: pathlib.Path) -> pathlib.Path:
    path = out_dir / "validation-pack.md"
    lines = [
        "# Pilot validation pack — 30 records",
        "",
        f"_Generated {dt.datetime.now().strftime('%Y-%m-%d %H:%M')} · "
        f"writer `{WRITER_LABEL}` · judge `{JUDGE_MODEL}` (cross-vendor) · "
        f"prompt `{PROMPT_VERSION}`_",
        "",
        "**How to read this.** For each record: the abstract and highlights the pipeline would",
        "write, then the exact source text each span was cut from with its character offsets.",
        "Every span is machine-proved to come from the page — your job is whether it is *right*",
        "and *useful*, and above all whether anything reads as invented.",
        "",
        "Mark each record on its `ARIJIT:` line. **One hallucination stops the whole run.**",
        "",
        "---",
        "",
    ]
    for n, r in enumerate(results, 1):
        lines += [
            f"## {n}. {r['page_type']} · {r['family']} · {r['language_code']}",
            "",
            f"- **URL**: {r['source_url']}",
            f"- **Why in pilot**: {r.get('pilot_reason','')}",
            f"- **Fetch**: `{r['fetch_path']}` · prose {r.get('prose_chars',0)} chars"
            f"{' · TRUNCATED' if r.get('truncated') else ''}",
            f"- **Verdict**: `{r.get('verdict')}`"
            + (f" ({r.get('insufficient_reason')})" if r.get("insufficient_reason") else ""),
            f"- **Status**: `{r.get('status')}`",
            "",
        ]
        if r.get("gate_failures"):
            lines += ["**Gate failures:**", ""]
            lines += [f"- {f}" for f in r["gate_failures"]]
            lines.append("")
        if r.get("abstract_enriched"):
            lines += ["**abstract_enriched:**", "", f"> {r['abstract_enriched']}", ""]
            if r.get("keyhighlights_enriched"):
                lines += ["**keyhighlights_enriched:**", ""]
                lines += [f"{i}. {h}" for i, h in enumerate(r["keyhighlights_enriched"], 1)]
                lines.append("")
            lines += ["**Provenance — offsets into the fetched page:**", "",
                      "```", *[f"[{s}:{e}]" for s, e in r.get("span_offsets", [])[:12]], "```", ""]
        if r.get("judge"):
            j = r["judge"]
            lines += [
                "**Judge (Gemini, cross-vendor):**", "",
                f"| representativeness | specificity | missed_substance | coherence | juxtaposition | verdict |",
                f"|---|---|---|---|---|---|",
                f"| {j.get('representativeness')} | {j.get('specificity')} | "
                f"{j.get('missed_substance')} | {j.get('coherence')} | "
                f"{j.get('juxtaposition')} | **{j.get('verdict')}** |",
                "",
            ]
            if j.get("notes"):
                lines += [f"_{j['notes']}_", ""]
            if j.get("better_span_available"):
                valid = r.get("judge_span_valid")
                lines += [f"Judge suggested: `{j['better_span_available'][:160]}`"
                          f" — on the page: **{valid}**", ""]
        lines += ["```", "ARIJIT:  accept / reject / HALLUCINATION", "notes:", "```", "", "---", ""]
    path.write_text("\n".join(lines))
    return path


def write_summary(results: list[dict], out_dir: pathlib.Path) -> pathlib.Path:
    import collections
    path = out_dir / "pilot-summary.md"
    status = collections.Counter(r.get("status") for r in results)
    verdicts = collections.Counter(r.get("verdict") for r in results)
    gate_fail_kinds: collections.Counter = collections.Counter()
    for r in results:
        for f in r.get("gate_failures", []):
            gate_fail_kinds[f.split(" ")[0] if f.startswith("G") else "other"] += 1
    cost = sum(r.get("writer_cost_usd", 0) or 0 for r in results)
    judged = [r for r in results if r.get("judge")]
    def mean(field):
        vals = [r["judge"].get(field) for r in judged if isinstance(r["judge"].get(field), (int, float))]
        return round(sum(vals) / len(vals), 2) if vals else None

    lines = [
        "# Pilot summary", "",
        f"_writer `{WRITER_LABEL}` · judge `{JUDGE_MODEL}` · prompt `{PROMPT_VERSION}` · "
        f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M')}_", "",
        f"- records processed: **{len(results)}**",
        f"- writer cost: **${cost:.2f}** (${cost/max(len(results),1):.3f}/record)",
        "",
        "## Status", "",
        *[f"- `{k}`: {v}" for k, v in status.most_common()],
        "", "## Verdicts", "",
        *[f"- `{k}`: {v}" for k, v in verdicts.most_common()],
        "", "## Gate failures by gate", "",
        *([f"- `{k}`: {v}" for k, v in gate_fail_kinds.most_common()] or ["- none"]),
        # Reported, never gated. On blog this is EXPECTED to be roughly two thirds of rows:
        # algolia.com serves the English article at /de/ and /fr/. Stating it here is what stops a
        # later reader finding English abstracts on German records and reading it as a leak.
        "", "## Language: record language vs body language", "",
        *([f"- record `{lc or '?'}` · body `{lo or '?'}`: {n}"
           for (lc, lo), n in collections.Counter(
               (r.get("language_code"), r.get("language_observed"))
               for r in results if r.get("language_observed")).most_common()]
          or ["- no row reported an observed language"]),
        f"- **mismatched: {sum(1 for r in results if r.get('language_mismatch'))}** "
        f"of {len(results)} — counted by design, not a defect (Arijit, 2026-08-09)",
        # G8, the post-hoc half. The prevention half marks boilerplate in the menu before the model
        # sees it; this catches anything that got through anyway, by looking at the run's OUTPUT.
        # A run can only be judged on sameness after it exists, so this cannot move earlier.
        "", "## G8 template collision (stored abstracts)", "",
        *([f"- **{c}x** `{p[:80]}`" for p, c in sorted(
            check_template_collision([r.get("abstract_enriched", "") for r in results],
                                     threshold=max(2, len(results) // 10)).items(),
            key=lambda kv: -kv[1])]
          or [f"- none (threshold >{max(2, len(results) // 10)} identical 8-token prefixes)"]),
        "", f"- boilerplate map: **{len(BOILERPLATE)}** sentences loaded"
        f"{' — MAP MISSING, G8 PREVENTION NOT APPLIED' if not BOILERPLATE else ''}",
        "", "## Judge means (records that reached the judge)", "",
        f"- reached judge: {len(judged)}",
        f"- representativeness: {mean('representativeness')}",
        f"- specificity: {mean('specificity')}",
        f"- missed_substance: {mean('missed_substance')}",
        f"- coherence: {mean('coherence')}",
        f"- juxtaposition: {mean('juxtaposition')}",
        "",
        "## By family", "",
        "| family | n | passed gates | judge ACCEPT |", "|---|---|---|---|",
    ]
    fam = collections.defaultdict(lambda: [0, 0, 0])
    for r in results:
        f = fam[r["family"]]
        f[0] += 1
        f[1] += 1 if r.get("gate_passed") else 0
        f[2] += 1 if (r.get("judge") or {}).get("verdict") == "ACCEPT" else 0
    for name, (n, g, a) in sorted(fam.items()):
        lines.append(f"| {name} | {n} | {g} | {a} |")
    path.write_text("\n".join(lines) + "\n")
    return path


def replay(prior: list[dict], cache: dict[str, dict], out_dir: pathlib.Path) -> list[dict]:
    """Re-run gates and judge over ALREADY-STORED writer output.

    The writer is the expensive, slow, non-deterministic part. When a gate is fixed -- and the
    pilot fixed four canonicalisation bugs -- re-calling the writer would both cost money and
    change the spans, making it impossible to tell whether the gate fix or a different selection
    caused the difference. Replay holds the model output constant so the gate change is the only
    variable. Chapter 4 needs exactly this to re-verify without re-fetching.
    """
    results = []
    for n, old in enumerate(prior, 1):
        rec = cache.get(old["objectID"])
        llm = old.get("llm_output")
        if rec is None or llm is None:
            results.append({**old, "status": old.get("status", "NO_LLM_OUTPUT"), "replayed": False})
            print(f"  {n:2d}/{len(prior)} skipped (no stored output) {old.get('source_url','')[:48]}")
            continue
        markdown = rec["markdown"]
        family = old["family"]
        span_min, span_max = FAMILIES[family].get("expected_span_count", [1, 4])
        gate = run_gates(llm_output=llm, page_markdown=markdown,
                         title=rec.get("title", ""), description=rec.get("description", ""),
                         family_span_range=(span_min, span_max), family=family,
                         original_length=rec.get("original_length") or 0)
        new = {**old, "replayed": True, "gate_passed": gate.passed,
               "gate_failures": gate.failures,
               "abstract_enriched": gate.abstract_enriched,
               "abstract_spans_stored": gate.abstract_spans,
               "dropped_fabrications": gate.dropped_fabrications,
               "fabricated_spans": gate.fabricated_spans,
               "keyhighlights_enriched": gate.keyhighlights_enriched,
               "span_offsets": gate.span_offsets,
               "prose_chars": prose_chars(markdown)}
        if not gate.passed:
            new["status"] = "QUARANTINED_BY_GATE"
        elif not gate.abstract_enriched:
            new["status"] = f"NO_ABSTRACT_{llm.get('verdict')}"
        else:
            judge, judge_error = call_judge(JUDGE_PROMPT.format(
                page_type=old["page_type"], title=rec.get("title", ""),
                abstract=gate.abstract_enriched,
                highlights="\n".join(f"- {h}" for h in gate.keyhighlights_enriched),
                markdown=markdown))
            new["judge"], new["judge_error"] = judge, judge_error
            if judge is None:
                new["status"] = "JUDGE_UNAVAILABLE"
            else:
                better = judge.get("better_span_available")
                if better:
                    try:
                        locate(better, canonicalise(markdown))
                        new["judge_span_valid"] = True
                    except SpanRejected:
                        new["judge_span_valid"] = False
                new["status"] = "PASS" if judge.get("verdict") == "ACCEPT" else "JUDGE_REVISE"
        results.append(new)
        print(f"  {n:2d}/{len(prior)} {new['status']:22s} {new.get('verdict') or '-':5s} "
              f"{family:13s} {old['source_url'][:48]}")
    (out_dir / "results-replayed.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results))
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", action="store_true", required=True,
                    help="run the cached pilot set. Writes NOTHING to Algolia.")
    ap.add_argument("--replay", action="store_true",
                    help="re-run gates+judge over stored writer output; no writer calls")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=str(REPORTS / "pilot-30"))
    ap.add_argument("--manifest", default=str(CACHE_DIR / "pilot-manifest.json"))
    args = ap.parse_args()

    manifest = pathlib.Path(args.manifest)
    if not manifest.exists():
        sys.exit("FATAL: run `fetch_router.py --fetch-pilot 30` first")
    all_rows = json.loads(manifest.read_text())
    records = [r for r in all_rows if not r.get("fetch_error")]

    # A manifest whose rows are ALL fetch failures used to produce a clean, empty results.jsonl and
    # exit 0. The batch gate then checked `rows == distinct objectIDs` and passed on 0 == 0, so a
    # run pointed at the wrong manifest reported success having enriched nothing. Two of the blog
    # cache trees hold an error copy and an ok copy of the same 2,139 objectIDs, which is exactly
    # how the wrong one gets picked. Refuse, and say which manifest and how many rows it had.
    if not records:
        failed = sum(1 for r in all_rows if r.get("fetch_error"))
        sys.exit(f"FATAL: {manifest} has 0 usable rows "
                 f"({len(all_rows)} total, {failed} with fetch_error). "
                 f"Refusing to run: an empty result file is indistinguishable from a clean pass.")

    if args.limit:
        records = records[: args.limit]

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.replay:
        prior_path = out_dir / "results.jsonl"
        if not prior_path.exists():
            sys.exit(f"FATAL: no prior run at {prior_path}")
        prior = [json.loads(l) for l in prior_path.open()]
        cache = {r["objectID"]: r for r in json.loads(pathlib.Path(args.manifest).read_text())}
        print(f"REPLAY over {len(prior)} stored writer outputs — no writer calls, "
              f"judge {JUDGE_MODEL}\n")
        results = replay(prior, cache, out_dir)
        pack = write_validation_pack(results, out_dir)
        summary = write_summary(results, out_dir)
        print(f"\nvalidation pack: {pack}\nsummary        : {summary}")
        return 0

    print(f"pilot: {len(records)} records | writer {WRITER_LABEL} | judge {JUDGE_MODEL}")
    print("NOTHING is written to Algolia in pilot mode.\n")

    # Truncate first. This file is opened in append mode per record (deliberate: a crash must not
    # lose completed work), but nothing reset it at the START of a run -- so a re-run stacked new
    # results on top of old ones and a 30-record run produced a 60-line file. Stale rows then look
    # exactly like fresh ones, which is the same false-green class as every other bug this session.
    (out_dir / "results.jsonl").write_text("")
    results = []
    started = time.time()
    for n, rec in enumerate(records, 1):
        t0 = time.time()
        try:
            res = process(rec)
        except Exception as exc:  # a crash on one record must not lose the other 29
            res = {"objectID": rec["objectID"], "url": rec.get("url"),
                   "source_url": rec.get("source_url"), "page_type": rec.get("page_type"),
                   "family": rec.get("family"), "language_code": rec.get("language_code"),
                   "fetch_path": rec.get("fetch_path"), "status": "CRASHED",
                   "gate_failures": [f"{type(exc).__name__}: {exc}"]}
        results.append(res)
        (out_dir / "results.jsonl").open("a").write(json.dumps(res, ensure_ascii=False) + "\n")
        print(f"  {n:2d}/{len(records)} {res.get('status','?'):22s} "
              f"{res.get('verdict') or '-':5s} {res['family']:13s} "
              f"{int(time.time()-t0):3d}s  {res['source_url'][:52]}")

    pack = write_validation_pack(results, out_dir)
    summary = write_summary(results, out_dir)
    print(f"\nelapsed: {int(time.time()-started)}s")
    print(f"validation pack: {pack}")
    print(f"summary        : {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
