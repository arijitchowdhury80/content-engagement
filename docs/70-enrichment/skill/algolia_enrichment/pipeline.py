"""THE live path. One record, end to end. There is no second copy of this logic.

WHY THAT SENTENCE IS THE POINT OF THIS FILE
  The historical code had two: `span_gate.run_gates()`, which nothing called, and an inline copy
  inside the runner, which everything called. A gate was "fixed" in the dead one twice. Every
  unit test passed. The pipeline behaved exactly as before, for weeks.

  `run_gates` is not ported. `evaluate_selection` below composes the primitives from `gates.py`
  and is what the CLI runs, so a test that drives it drives production. `test_gate_wiring.py`
  asserts that by proving a gate's message reaches a CLI result, not by reading source.

THE ORDER, AND WHY EACH STEP IS WHERE IT IS
  1. terminal verdict      before any model call: a login wall, a failed fetch or a redirect is
                           a true statement about the record and costs nothing to decide
  2. candidates            the page split into a numbered menu
  3. pool filter           chrome and duplicates removed from the MENU, so they cannot be picked
  4. pool gates            candidate-level gates asked BEFORE selection, so one bad sentence
                           cannot kill a page holding forty good ones
  5. writer                returns integers
  6. resolve               integers -> our own candidates. Free text is a hard refusal.
  7. repair                incomplete spans extended over the page's own following words
  8. selection gates       the checks that need the chosen SET
  9. retry ladder          a gate failure names which sentence was wrong; ban it and ask again
 10. judge                 quality only, and it cannot write prose
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from . import strategies
from .candidates import render_menu, resolve_selection, split_candidates
from .canonical import canonicalise, prose_chars
from .dispatch import route
from .filters import filter_pool
from .gates import (apply_pool_gates, check_blacklists, check_context, check_information_gain,
                    check_integrity, check_subject_present, retry_constraints)
from .model_io import JUDGE_PROMPT, PROMPT_VERSION, SELECT_PROMPT, WRITER_SYSTEM_PROMPT
from .repair import incomplete_reason, repair_or_drop_highlights, repair_span
from .verdicts import classify as classify_verdict, language_mismatch

MAX_SELECTION_ATTEMPTS = 3

# The gate ids the runner loads. Echoed into effective-config.json so the run's own output says
# which gates ran -- reading the source proves nothing about what the runner reached.
GATES_LOADED = [
    "G-terminal-verdict", "G-pool-filter", "G-pool-static-ban", "G-pool-reversal",
    "G-id-only-selection", "G-repair-incomplete", "G-integrity", "G-context-quotation",
    "G-context-reversal", "G-context-section", "G-context-sections-spread",
    "G-context-language-mix", "G-subject-present", "G-blacklist", "G-information-gain",
    "G-method-agreement", "G-judge",
]


@dataclass
class Attempt:
    """One pass of resolve -> repair -> gate over a writer response.

    `ban_hint` is what the pool must lose for the NEXT attempt to be different. An empty hint
    means asking again returns the same answer, so the ladder stops rather than burning a call.
    """
    ok: bool
    failures: list = field(default_factory=list)
    ban_hint: set = field(default_factory=set)
    reason: str = ""
    sel: object = None
    abstract_spans: list = field(default_factory=list)
    highlight_spans: list = field(default_factory=list)
    repair_trace: list = field(default_factory=list)


def evaluate_selection(llm: dict, pool: list, unfiltered: list, canon, record: dict,
                       profile, ineligible: set) -> Attempt:
    """Resolve the model's integers, repair what the page can repair, then run the gates."""
    trace: list[str] = []
    span_range = tuple(profile.abstract_span_count)
    sel = resolve_selection(llm.get("abstract"), llm.get("highlights"), pool, span_range)

    # THE WRITER CONTRACT. A model that returned prose is a hard failure, not something to parse
    # around: accepting a string as content is the moment the zero-invention guarantee stops
    # being structural.
    if sel.free_text:
        return Attempt(ok=False, sel=sel, repair_trace=trace,
                       reason="WRITER_FREE_TEXT",
                       failures=[f"writer returned text instead of an ID: {t!r}"
                                 for t in sel.free_text[:5]])
    if not sel.passed:
        # A protocol error -- wrong count, out-of-range index. Banning candidates cannot fix it,
        # so no hint: the ladder stops and the record is reported honestly.
        return Attempt(ok=False, failures=list(sel.failures), sel=sel, repair_trace=trace)

    # SOURCE-GROUNDED REPAIR. A colon lead-in or a mid-sentence cut is a bad CUT, not a bad page:
    # the words that finish the thought are the next few ON THE PAGE. `unfiltered` is the
    # adjacency pool because the filters leave holes in page order.
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

    high_min, high_max = profile.highlight_count
    pre_high = [c for c in sel.highlights if len(c.text) <= 300
                and (len(c.text.split()) >= 6 or any(ch.isdigit() for ch in c.text))]
    kept_high, htrace, enough = repair_or_drop_highlights(
        pre_high, unfiltered, canon, used={c.index for c in sel.abstract},
        min_clean=high_min, replacement_pool=pool)
    trace += htrace
    if not enough:
        return Attempt(
            ok=False, sel=sel, repair_trace=trace,
            ban_hint={c.index for c in sel.highlights},
            reason="highlights could not be repaired or replaced",
            failures=[f"only {len(kept_high)} clean highlights survived repair and replacement "
                      f"(profile minimum {high_min})"])
    sel.highlights = kept_high[:high_max]

    abstract_spans = [c.text for c in sel.abstract]
    highlight_spans = [c.text for c in sel.highlights]

    # Belt and braces: nothing incomplete may reach storage, repaired or not.
    residual = [f"{'abstract' if i < len(abstract_spans) else 'highlight'} span still "
                f"{incomplete_reason(s, is_abstract=i < len(abstract_spans))} after repair: "
                f"{s[-60:]!r}"
                for i, s in enumerate(abstract_spans + highlight_spans)
                if incomplete_reason(s, is_abstract=i < len(abstract_spans))]
    if residual:
        return Attempt(ok=False, sel=sel, repair_trace=trace, failures=residual,
                       ban_hint={c.index for c in sel.abstract + sel.highlights},
                       reason="a span was still incomplete after repair")

    failures: list[str] = []
    failures += check_integrity(abstract_spans, highlight_spans, span_range,
                                abstract_shape=profile.abstract_shape, highlight_max=high_max)
    failures += check_context(sel.abstract, sel.highlights,
                              allow_quotes=profile.allow_quotes,
                              original_length=record.get("original_length") or 0,
                              seen_length=len(record["markdown"]),
                              max_span_distance=profile.max_span_distance)
    failures += check_subject_present(abstract_spans[0], record.get("title", ""))
    failures += check_blacklists(abstract_spans + highlight_spans)
    if profile.duplicate_description_policy == "ban":
        failures += check_information_gain(" ".join(abstract_spans), record.get("title", ""),
                                           record.get("description", ""),
                                           minimum=profile.information_gain_minimum)
    if not failures:
        return Attempt(ok=True, sel=sel, abstract_spans=abstract_spans,
                       highlight_spans=highlight_spans, repair_trace=trace)

    ban, why = retry_constraints(failures, sel, pool, record.get("title", ""), ineligible)
    return Attempt(ok=False, sel=sel, failures=failures, ban_hint=ban, reason=why,
                   repair_trace=trace)


def _prompt(record: dict, profile, menu: str) -> str:
    span_min, span_max = profile.abstract_span_count
    high_min, high_max = profile.highlight_count
    return SELECT_PROMPT.format(
        url=record.get("source_url") or record.get("url", ""),
        title=record.get("title", ""), source=profile.source,
        page_type=profile.page_type, description=record.get("description", ""),
        language_code=record.get("language_code", ""),
        span_min=span_min, span_max=span_max, high_min=high_min, high_max=high_max,
        profile_instruction=strategies.get(profile.strategy).instruction,
        menu=menu)


def process_record(record: dict, profile, inference, *, writer_tier: str,
                   judge_tier: str | None, canonical_map: dict[str, str] | None = None,
                   boilerplate: set[str] | None = None) -> dict:
    """One record, from a fetched body to a result row. `record` carries the body under
    `markdown`, which `bodysource.RunCache` is the only supplier of."""
    markdown = record.get("markdown") or ""
    out: dict = {
        "objectID": record["objectID"],
        "url": record.get("url"),
        "source": profile.source,
        "page_type": profile.page_type,
        "profile_version": profile.version,
        "strategy": profile.strategy,
        "language_code": record.get("language_code"),
        "content_hash": record.get("content_hash"),
        "served_url": record.get("served_url", ""),
        "redirect_mismatch": record.get("redirect_mismatch", False),
        "prose_chars": prose_chars(markdown),
        "writer_model": writer_tier,
        "judge_model": judge_tier,
        "prompt_version": PROMPT_VERSION,
        "processed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "abstract_spans_stored": [],
        "keyhighlights_enriched": [],
    }

    terminal = classify_verdict(record, canonical_map, profile.min_body_chars,
                                profile.dead_page_markers or (), profile.shell_markers or ())
    if terminal is not None:
        out.update(terminal)
        return out

    if profile.strategy == "no_abstract":
        # Nav furniture. NO enrichment is the correct outcome and the packet counts it as a pass,
        # not a gap. Forcing an abstract here is the failure.
        out.update({"status": "NO_ABSTRACT_BY_PROFILE", "verdict": "THIN",
                    "insufficient_reason": "NO_PROSE",
                    "verdict_reason": "profile strategy is no_abstract; not an enrichment target"})
        return out

    method = route(profile.strategy, markdown)
    out["method_check"] = method
    if not method["agrees"]:
        # WARN and refuse to write; do not silently re-route. Switching strategy on a sniffer's
        # opinion is the same mistake in the other direction.
        out.update({"status": "METHOD_DISAGREEMENT", "verdict": "REAL",
                    "verdict_reason": f"profile declares {method['declared']!r}; the body looks "
                                      f"like {method['sniffed']!r}. Not written."})
        return out

    cands, canon = split_candidates(markdown, boilerplate=boilerplate,
                                    already_indexed=record.get("description", ""))
    out["candidates"] = len(cands)
    out["already_indexed_candidates"] = sum(1 for c in cands if c.is_already_indexed)
    if not cands:
        out.update({"status": "NO_CANDIDATES", "verdict": "THIN",
                    "insufficient_reason": "NO_PROSE"})
        return out

    unfiltered = cands
    extra = profile.compiled_forbidden
    cands, dropped_counts, _ = filter_pool(cands, description=record.get("description", ""),
                                           title=record.get("title", ""), extra_patterns=extra)
    out["candidates_after_filter"] = len(cands)
    out["pool_dropped"] = dropped_counts
    if not cands:
        # Distinct from NO_CANDIDATES on purpose. The page HAD prose and the filter took all of
        # it, which is either an honest "this page is only furniture" or over-filtering. Counting
        # it separately is what makes the difference visible instead of hidden in a THIN total.
        out.update({"status": "NO_CANDIDATES_AFTER_FILTER", "verdict": "THIN",
                    "insufficient_reason": "NO_PROSE",
                    "candidates_before_filter": len(unfiltered)})
        return out

    cands, gate_counts, gate_trace, ineligible = apply_pool_gates(
        cands, canon, record.get("title", ""), unfiltered=unfiltered,
        description=record.get("description", ""), allow_quotes=profile.allow_quotes,
        extra_patterns=extra)
    out["candidates_after_pool_gates"] = len(cands)
    out["pool_gate_dropped"] = gate_counts
    if gate_trace:
        out["pool_gate_trace"] = gate_trace[:40]
    if not cands:
        out.update({"status": "NO_CANDIDATES_AFTER_FILTER", "verdict": "THIN",
                    "insufficient_reason": "NO_PROSE", "quarantine_stage": "pool_gates",
                    "candidates_before_filter": len(unfiltered)})
        return out

    llm, meta = inference.complete(writer_tier, _prompt(record, profile,
                                                        render_menu(cands, no_open=ineligible)),
                                   system=WRITER_SYSTEM_PROMPT)
    out["writer_usage"] = (meta or {}).get("usage")
    if llm is None:
        out.update({"status": "WRITER_UNPARSEABLE", "writer_raw": meta.get("raw", "")})
        return out
    out["verdict"] = llm.get("verdict")
    out["insufficient_reason"] = llm.get("insufficient_reason")
    out["language_observed"] = llm.get("language_observed") or ""
    mismatch = language_mismatch(record.get("language_code"), llm.get("language_observed"))
    out["language_mismatch"] = mismatch
    if mismatch and profile.language_policy == "must_match_record":
        # GATED HERE, COUNTED ELSEWHERE. The "de/fr serving English is acceptable" ruling was
        # measured at 100% of Blog and 0% of every other source, so it is a Blog profile setting
        # and not a global one.
        out.update({"status": "LANGUAGE_MISMATCH", "verdict": "THIN",
                    "insufficient_reason": "LANGUAGE_MISMATCH",
                    "verdict_reason": f"record claims {record.get('language_code')!r}, body reads "
                                      f"{llm.get('language_observed')!r}; profile policy is "
                                      f"must_match_record"})
        return out

    if llm.get("verdict") in ("DEAD", "THIN"):
        out["status"] = f"NO_ABSTRACT_{llm['verdict']}"
        return out

    # --- the selection ladder ---------------------------------------------
    #
    # ONE REFUSAL IS NOT A VERDICT ON THE PAGE. A gate failure says which sentence was wrong, and
    # that is enough to narrow the menu and ask again. Asking once and quarantining killed 589
    # Blog records holding pages with forty other usable sentences.
    menu_pool = cands
    banned: set[int] = set()
    repair_trace: list[str] = []
    attempt_log: list[str] = []
    llm_current = llm
    att = None

    for attempt_no in range(1, MAX_SELECTION_ATTEMPTS + 1):
        att = evaluate_selection(llm_current, menu_pool, unfiltered, canon, record, profile,
                                 ineligible)
        repair_trace += att.repair_trace
        out["out_of_range_picks"] = getattr(att.sel, "out_of_range", [])
        if att.ok:
            break
        if att.reason == "WRITER_FREE_TEXT":
            out.update({"status": "WRITER_FREE_TEXT", "gate_failures": att.failures,
                        "selection_attempts": attempt_log})
            return out
        fresh = {i for i in att.ban_hint if i not in banned}
        if not fresh or attempt_no == MAX_SELECTION_ATTEMPTS:
            break
        banned |= fresh
        menu_pool = [c for c in cands if c.index not in banned]
        if len(menu_pool) < profile.abstract_span_count[0]:
            attempt_log.append(
                f"attempt {attempt_no}: banning {len(fresh)} left too few candidates")
            break
        attempt_log.append(f"attempt {attempt_no} failed ({att.reason or att.failures[:1]}); "
                           f"re-asking with {len(fresh)} candidates banned, "
                           f"{len(menu_pool)} left on the menu")
        llm_retry, meta_retry = inference.complete(
            writer_tier, _prompt(record, profile, render_menu(menu_pool, no_open=ineligible)),
            system=WRITER_SYSTEM_PROMPT)
        if llm_retry is None:
            out.update({"status": "WRITER_UNPARSEABLE", "writer_raw": meta_retry.get("raw", ""),
                        "selection_attempts": attempt_log, "repair_trace": repair_trace})
            return out
        llm_current = llm_retry

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
    out["abstract_spans_stored"] = att.abstract_spans
    out["abstract_enriched"] = " ".join(att.abstract_spans)
    out["keyhighlights_enriched"] = att.highlight_spans
    out["span_offsets"] = [[c.start, c.end] for c in sel.abstract + sel.highlights]

    # --- the judge: quality only, and it may not write prose ---------------
    #
    # It cannot carry the grounding guarantee -- that is structural, from the writer returning
    # indices into a list this script built from the page. What it CAN do is catch the failure
    # the scripted gates cannot settle: a selection that is faithful and unrepresentative.
    #
    # A judge whose verdict does not change writability is not a gate. Across 3,069 Blog rows the
    # old judge's verdict changed the outcome for ZERO records because both its verdicts were
    # writable. Here RESELECT and HUMAN_REVIEW are NOT writable.
    if not (profile.judge_required and judge_tier):
        out["judge"] = None
        out["judge_skipped"] = ("judge disabled for this profile; deterministic gates and human "
                                "review carry the quality risk and the packet must say so")
        out["status"] = "PASS"
        return out

    judge, jmeta = inference.complete(judge_tier, JUDGE_PROMPT.format(
        page_type=profile.page_type, title=record.get("title", ""),
        description=record.get("description", ""),
        abstract=out["abstract_enriched"],
        highlights="\n".join(f"- {h}" for h in att.highlight_spans),
        markdown=markdown))
    if judge is None:
        out.update({"status": "JUDGE_UNAVAILABLE", "judge": None,
                    "judge_error": jmeta.get("raw", "")})
        return out
    out["judge"] = judge
    verdict = judge.get("verdict")
    if verdict == "PASS":
        out["status"] = "PASS"
    elif verdict == "DROP_HIGHLIGHT":
        out["status"] = "PASS"
        out["judge_note"] = "judge asked for a highlight drop; recorded, spans unchanged"
    else:
        out["status"] = "JUDGE_HUMAN_REVIEW"
        out["verdict_reason"] = f"judge returned {verdict!r}"
    return out
