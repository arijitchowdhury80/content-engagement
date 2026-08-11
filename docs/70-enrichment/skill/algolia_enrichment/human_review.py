"""The human-review queue. Bad records are NOT automatically quarantined in v0.

WHY A QUEUE AND NOT A QUARANTINE
  Quarantining is a real index move and deleting is irreversible. Whether a record is bad enough
  to leave the corpus is a judgement about the CONTENT, and that is Arijit's call, not a
  pipeline's. v0's job is to make the decision cheap to take: one row per unresolved record, with
  the reason and a suggested action already filled in.

EVERY PLANNED RECORD HAS EXACTLY ONE TERMINAL OUTCOME.
  Written, repaired-then-written, or in this queue. "Zero records unaccounted for" is the
  Definition-of-Done line this file exists to make checkable -- `build-final` reconciles the
  queue plus the payloads against the manifest and fails on any gap.

A TERMINAL VERDICT IS NOT A DEFECT.
  A dead page, a login wall, a nav hub with no abstract: these are true statements about the
  record and they are counted as outcomes, not as failures. Only an UNRESOLVED record -- one the
  pipeline could not decide -- becomes an OPEN review row.
"""

from __future__ import annotations

import datetime as dt

from .verdicts import NON_ENRICHMENT

# status -> (suggested action, whether it needs a human at all)
SUGGESTED_ACTION = {
    "QUARANTINED_BY_GATE": ("retry_enrichment", True),
    "WRITER_UNPARSEABLE": ("retry_enrichment", True),
    "WRITER_FREE_TEXT": ("retry_enrichment", True),
    "JUDGE_UNAVAILABLE": ("retry_enrichment", True),
    "JUDGE_HUMAN_REVIEW": ("manual_review", True),
    "METHOD_DISAGREEMENT": ("exclude", True),
    "NO_CANDIDATES": ("accept_no_enrichment", False),
    "NO_CANDIDATES_AFTER_FILTER": ("manual_review", True),
    "NO_ABSTRACT_THIN": ("accept_no_enrichment", False),
    "NO_ABSTRACT_DEAD": ("accept_no_enrichment", False),
    "NO_ABSTRACT_BY_PROFILE": ("accept_no_enrichment", False),
    "LANGUAGE_MISMATCH": ("fix_source_then_retry", True),
    "FETCH_FAILED": ("fix_source_then_retry", True),
    "DEAD_PAGE": ("candidate_for_quarantine", False),
    "SHELL_PAGE": ("candidate_for_quarantine", False),
    "LOGIN_REQUIRED": ("accept_no_enrichment", False),
    "REDIRECT_CANONICAL": ("exclude", False),
    "REDIRECT_UNINDEXED": ("exclude", False),
    "EXCLUDED": ("exclude", False),
}

TERMINAL_NO_HUMAN = {s for s, (_, needs) in SUGGESTED_ACTION.items() if not needs} | set(
    NON_ENRICHMENT) - {"FETCH_FAILED"}


def is_writable(row: dict) -> bool:
    return row.get("status") == "PASS" and bool(row.get("abstract_spans_stored"))


def needs_human(row: dict) -> bool:
    if is_writable(row):
        return False
    action, needs = SUGGESTED_ACTION.get(row.get("status", ""), ("manual_review", True))
    return needs


def queue_row(row: dict, profile) -> dict:
    status = row.get("status", "UNKNOWN")
    action, _ = SUGGESTED_ACTION.get(status, ("manual_review", True))
    return {
        "objectID": row["objectID"],
        "source": profile.source,
        "page_type": profile.page_type,
        "url": row.get("url"),
        "terminal_verdict": status,
        "reason": row.get("verdict_reason") or "; ".join(row.get("gate_failures") or [])[:400]
                  or status,
        "suggested_action": action,
        "review_status": "OPEN",
        "reviewer_decision": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "reentry_command": None,
        "queued_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def partition(rows: list[dict], profile) -> tuple[list[dict], list[dict], list[dict]]:
    """(writable, human_review_rows, terminal_no_human_rows). The three add up to every row."""
    writable, human, terminal = [], [], []
    for row in rows:
        if is_writable(row):
            writable.append(row)
        elif needs_human(row):
            human.append(queue_row(row, profile))
        else:
            terminal.append(row)
    return writable, human, terminal


def coverage(planned: int, writable: int, human_open: int, terminal: int, profile) -> dict:
    """Coverage measured against the ORIGINAL plan-slice count, never against what survived.

    "Done" cannot mean "whatever came back". If the denominator is the survivors, a run that
    loses half its records reports 100%.
    """
    outcomes = writable + human_open + terminal
    return {
        "planned_target_count": planned,
        "target_written": writable,
        "human_review_open": human_open,
        "terminal_unwritable": terminal,
        "unattempted": max(0, planned - outcomes),
        "outcome_coverage_pct": round(outcomes / planned, 4) if planned else 0.0,
        "writable_coverage_pct": round(writable / planned, 4) if planned else 0.0,
        "human_review_pct": round(human_open / planned, 4) if planned else 0.0,
        "coverage_target_pct": profile.coverage_target_pct,
        "max_human_review_open_pct": profile.max_human_review_open_pct,
        "meets_coverage": planned > 0 and (writable / planned) >= profile.coverage_target_pct,
        "within_human_review_cap": planned > 0 and
                                   (human_open / planned) <= profile.max_human_review_open_pct,
        "all_accounted_for": outcomes == planned,
    }
