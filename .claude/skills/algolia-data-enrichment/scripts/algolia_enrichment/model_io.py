"""The only two LLM calls in the pipeline: the writer picks IDs, the judge scores quality.

THE WRITER RETURNS NUMBERS. A MODEL THAT RETURNS PROSE IS A HARD FAILURE.
  Not something to parse around. The zero-invention guarantee is structural -- an integer either
  indexes a real sentence from the page or it is out of range -- and the moment a string in the
  response is accepted as content, the guarantee is gone and nothing downstream can restore it.
  `enrich` refuses the record and records WRITER_FREE_TEXT.

MODEL PINNING IS ON THE SERVED STRING, NEVER THE TIER ALIAS.
  Verified live 2026-08-10 by GET {base}/models:

      large  -> glm-5.2                 small  -> gemma-4-26b-a4b-nvfp4
      xlarge -> glm-5.2                 medium -> gemma-4-31b-it-nvfp4

  Two traps this closes. `large` and `xlarge` both serve glm-5.2, which is the WRITER, so a
  tier-only writer!=judge check would let the writer grade its own output. And `medium` looks
  like a harmless judge upgrade -- it is not the writer, so a tier check passes -- but it is an
  unvalidated model swap. Pinning the served string makes any rename or re-point fail loudly
  instead of silently changing what graded the corpus.

RETRIES
  Retried: transport failure, 408/425/429/5xx, and a body that is not JSON. Retried once more
  for a well-formed response whose CONTENT will not parse, because a reasoning model emitting
  malformed JSON is nondeterministic. NOT retried: a 4xx that is not a rate limit -- that is a
  bad request and repeating it burns quota. Without this, one transient failure at concurrency
  silently drops a record while the batch reports success.
"""

from __future__ import annotations

import json
import random
import re
import time
from pathlib import Path

from .api import secret_curl
from .config import env_values
from .errors import EnrichmentError

PROMPT_VERSION = "select_by_id_v2.0"

_RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
_RETRY_ATTEMPTS = 4
_RETRY_BASE_SECONDS = 2.0
_HTTP_MARK = "__HTTP_STATUS__"

WRITER_SYSTEM_PROMPT = (
    "You are a strict selection tool. Your entire response is exactly one JSON object. "
    "Never output a preamble, a summary, a code fence, or any commentary. You choose NUMBERS "
    "from a numbered list you are given; you never write, copy or quote any text."
)

SELECT_PROMPT = """You are choosing which of a page's own sentences matter. You do NOT write or
copy any text. You return ONLY numbers.

PAGE METADATA
  url            : {url}
  title          : {title}
  source         : {source}
  page_type      : {page_type}
  language       : {language_code}

Below is every sentence on this page, numbered, grouped under its section heading.

HOW THE LIST IS MARKED
  Unmarked      a complete sentence of the page's own body text. These are what you want.
  [QUOTED]      inside a blockquote - someone else speaking, not the page.
  [UI]          button, nav label, banner or countdown text. Not a sentence.
  [HEADING]     a section heading, not a statement.
  [FRAGMENT]    a piece of a sentence. It does not start or end where a sentence does.
  [NONPROSE]    markup, code or configuration data that survived into the text.
  [BOILERPLATE] a well-formed sentence that appears on MANY other pages of this site. It reads
                perfectly well and it says nothing about THIS page. You cannot tell from the
                sentence alone; we counted the other pages for you.
  [NOT-FIRST]   a real body sentence, but it opens with "It"/"They"/"This" and never names what
                it is about. Fine as your SECOND or third pick; meaningless as your first,
                because a search result shows the opening words. This is the ONE mark that does
                not disqualify an entry -- it only bars it from position one.
  [ALREADY INDEXED] this sentence is ALREADY STORED on the record, word for word, as the
                description below. Choosing it adds nothing a search already has.

  Picking a marked entry produces something unreadable. An earlier unmarked version of this list
  came back with a "Book a demo" button welded to a subheading, and a countdown timer welded to
  a headline. That is what the marks are for.

STEP 1 - VERDICT
    REAL  a genuine content page with sentences about a subject
    DEAD  an error page, "not found", or a sign-in wall
    THIN  a real page with almost no prose: a link list, a menu, nothing but code
  If DEAD or THIN, return empty arrays and set insufficient_reason.

STEP 2 - ABSTRACT: pick {span_min} to {span_max} numbers whose sentences together say what this
page is and what a reader gets from it.
{profile_instruction}
  - Use UNMARKED entries only. [NOT-FIRST] is the one exception: usable, never as your first pick.
  - THIS RECORD ALREADY STORES:
        title:       {title}
        description: {description}
    Your abstract must add something a reader would not get from those two lines. Restating them
    is the single most common way this task fails.
  - The FIRST number you pick must be a sentence that names its own subject.
  - Read the whole list before choosing, then ask: is there ONE sentence that already summarises
    this page? Pages usually contain one. If it exists, pick it and stop -- {span_min} is a
    complete answer and a single clear sentence beats three that merely touch the topic.
  - The sentences you pick will be joined and read as one paragraph, in page order. Read your
    choice back before answering. If it does not read as connected prose, change it.

STEP 3 - HIGHLIGHTS: pick {high_min} to {high_max} numbers carrying the page's concrete
specifics -- numbers, limits, names, versions, named capabilities. Do not repeat an abstract
number. Fewer is correct when the page has less.
  - Each highlight is read ALONE in a search result, so each must stand on its own.
  - A [HEADING] is not a highlight; the sentence under it is.

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


JUDGE_PROMPT = """You are reviewing a selection, not writing one. Every sentence below was cut
verbatim from the page by a script - that is already machine-verified, so faithfulness is NOT
your concern. Do not comment on it.

Judge only whether this selection REPRESENTS the page.

PAGE_TYPE: {page_type}
TITLE: {title}
DESCRIPTION ALREADY STORED: {description}

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
  information_gain    Does the abstract say anything the TITLE and DESCRIPTION above do not
                      already say? 1 if it is a restatement of them. This is the dominant failure
                      mode on case studies and reference pages.
  coherence           Do the spans read as belonging together?
  juxtaposition       Read the spans as one paragraph. Does the COMBINATION assert anything the
                      page does not actually say? Two true sentences side by side can imply a
                      link neither states. Score 1 if the pairing misleads even though each
                      sentence is individually accurate. This is the one failure the scripted
                      gates cannot settle, so weigh it carefully.

Return ONLY this JSON, no code fence:
{{"representativeness":1,"specificity":1,"information_gain":1,"coherence":1,"juxtaposition":1,
"verdict":"PASS","defects":[]}}

verdict is one of PASS, RESELECT, DROP_HIGHLIGHT, HUMAN_REVIEW. Use RESELECT when a better
sentence is clearly available; use HUMAN_REVIEW when you cannot tell. You may NOT supply
replacement prose - naming the defect is your whole job."""


def extract_json(text: str) -> dict | None:
    """Models wrap JSON in prose or fences however much you ask them not to."""
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


class InferenceClient:
    def __init__(self, base_url: str, api_key: str):
        if not base_url or not api_key:
            raise EnrichmentError(
                "ALGOLIA_INFERENCE_BASE_URL / ALGOLIA_INFERENCE_API_KEY missing from .env.local")
        self.base = base_url.rstrip("/")
        self._key = api_key

    @classmethod
    def from_env(cls, workspace: Path) -> "InferenceClient":
        env = env_values(workspace)
        return cls(env.get("ALGOLIA_INFERENCE_BASE_URL", ""),
                   env.get("ALGOLIA_INFERENCE_API_KEY", ""))

    def _curl_json(self, body: str, timeout: int, attempts: int = _RETRY_ATTEMPTS
                   ) -> tuple[dict | None, int, str, str]:
        args = ["-s", f"{self.base}/chat/completions",
                "-H", "Content-Type: application/json", "-d", body,
                "-w", f"\n{_HTTP_MARK}%{{http_code}}"]
        note = ""
        for attempt in range(1, attempts + 1):
            proc = secret_curl([*args, "--max-time", str(timeout)],
                               {"Authorization": f"Bearer {self._key}"})
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
                        return None, status, out, note
            if attempt < attempts:
                # Exponential backoff WITH JITTER. Workers retrying in lockstep re-create the
                # burst that caused the 429 in the first place.
                delay = _RETRY_BASE_SECONDS * (2 ** (attempt - 1)) * (1.0 + random.random())
                time.sleep(delay)
        return None, 0, "", f"gave up after {attempts} attempts: {note}"

    def served_models(self) -> dict[str, str]:
        """tier alias -> SERVED model id, read from the server rather than assumed.

        NO FALLBACK TO THE ALIAS. An earlier version ended `served or alias`, which meant that if
        the field were ever renamed the check would compare `"large" == "large"` and pass -- a
        vacuous assertion that reads exactly like a real one. A tier with no `served_model` is
        omitted here, and `assert_model_separation` then refuses it by name.

        Verified live 2026-08-10: the field is `served_model`, and `large` and `xlarge` both
        report `glm-5.2`.
        """
        proc = secret_curl(["-s", "--max-time", "30", f"{self.base}/models"],
                           {"Authorization": f"Bearer {self._key}"})
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise EnrichmentError(f"GET /models returned non-JSON: {proc.stdout[:200]}")
        out: dict[str, str] = {}
        for m in data.get("data", []):
            alias = m.get("id") or ""
            served = m.get("served_model") or ""
            if alias and served:
                out[alias] = served
        return out

    def complete(self, model: str, prompt: str, *, system: str | None = None,
                 max_tokens: int = 4000, timeout: int = 180) -> tuple[dict | None, dict]:
        """One chat completion, parsed as JSON.

        max_tokens must be GENEROUS: glm-5.2 is a reasoning model and its reasoning tokens are
        charged against the completion budget. At max_tokens=120 it returned reasoning_tokens=121
        and completely EMPTY content.
        """
        messages = ([{"role": "system", "content": system}] if system else []) + \
                   [{"role": "user", "content": prompt}]
        body = json.dumps({"model": model, "temperature": 0, "max_tokens": max_tokens,
                           "messages": messages})
        data, status, raw, note = self._curl_json(body, timeout)
        meta = {"http_status": status, "raw": (note or raw)[:400], "model": model}
        if data is None or "error" in (data or {}):
            meta["raw"] = str((data or {}).get("error", note or raw))[:300]
            return None, meta
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError):
            return None, meta
        meta["raw"] = text[:400]
        meta["usage"] = data.get("usage")
        parsed = extract_json(text)
        if parsed is None:
            meta["retried_unparseable"] = True
            data2, _, _, _ = self._curl_json(body, timeout, attempts=1)
            if data2:
                try:
                    parsed = extract_json(data2["choices"][0]["message"]["content"] or "")
                except (KeyError, IndexError):
                    pass
        return parsed, meta


def assert_model_separation(client: InferenceClient, cfg) -> dict:
    """Resolve both tiers to their SERVED strings and refuse on any mismatch.

    Three refusals:
      * a tier resolves to a model the profile did not name -- an unvalidated swap
      * judge_enabled and judge_model == writer_model -- the writer grading itself
      * the tier is missing from /models entirely
    """
    served = client.served_models()
    writer_served = served.get(cfg.writer_tier)
    judge_served = served.get(cfg.judge_tier)
    problems = []
    if not writer_served:
        problems.append(f"writer tier {cfg.writer_tier!r} is not served by this endpoint")
    elif cfg.writer_model and writer_served != cfg.writer_model:
        problems.append(f"writer tier {cfg.writer_tier!r} serves {writer_served!r}, config "
                        f"pins {cfg.writer_model!r}")
    if cfg.judge_enabled:
        if not judge_served:
            problems.append(f"judge tier {cfg.judge_tier!r} is not served by this endpoint")
        elif cfg.judge_model and judge_served != cfg.judge_model:
            problems.append(f"judge tier {cfg.judge_tier!r} serves {judge_served!r}, config "
                            f"pins {cfg.judge_model!r}")
        if writer_served and judge_served and writer_served == judge_served:
            problems.append(
                f"judge and writer both serve {writer_served!r} -- a model grading its own "
                f"output is not a check. `large` and `xlarge` are the same model on this "
                f"endpoint; the judge must run on a different family.")
    if problems:
        raise EnrichmentError("model pinning failed:\n  " + "\n  ".join(problems))
    return {"writer_served": writer_served, "judge_served": judge_served if cfg.judge_enabled
            else None, "tiers": {cfg.writer_tier: writer_served, cfg.judge_tier: judge_served}}
