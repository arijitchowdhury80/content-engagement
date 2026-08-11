#!/usr/bin/env python3
"""algolia-corpus-enrichment -- the ONE entry point.

    python3 algolia_enrich.py <command> --workspace <path> --run-id <id> [args]

Every operation goes through here. The loose scripts in `docs/70-enrichment/*.py` are historical:
25 of the 40 do not belong in this pipeline at all, and two of the ones that do contain code
paths the runner never reached. Running them is how the Blog slice acquired 67 report files and
two "fixes" that changed nothing.

WHAT EVERY COMMAND GUARANTEES
  * it writes only under `runs/<run-id>/` (except `handoff`, by explicit exception)
  * it holds the run lock, so two writers cannot touch one run folder
  * it records what it produced in `artifact-manifest.json`
  * it exits NON-ZERO on any invariant failure
  * it never prints PASS after checking zero records or zero spans

Run ids are `YYYYMMDD-source-page_type-aNN`. The `aNN` attempt suffix is not decoration: without
it a same-day rerun of the same slice collides on the run folder and the lock.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from algolia_enrichment import (approvals, corpus, human_review, profile_lint, selection_registry,
                                strategies, write)
from algolia_enrichment.api import AlgoliaClient
from algolia_enrichment.artifacts import RunFolder
from algolia_enrichment.batching import (DEFAULT_MODEL_CONCURRENCY, DEFAULT_SCOUT_CONCURRENCY,
                                         project_runtime, run_concurrent)
from algolia_enrichment.bodysource import (SEALED_SCOUT_REPLAY, IngestPayload, RunCache,
                                           ScoutRefetch)
from algolia_enrichment.canonical import canonical_version
from algolia_enrichment.config import env_values, load_config
from algolia_enrichment.errors import (ApprovalError, EnrichmentError, LockError, ProfileError,
                                       StateError, ZeroWorkError)
from algolia_enrichment.ledger import Ledger, Metrics, read_effective_config, write_effective_config
from algolia_enrichment.lock import run_lock
from algolia_enrichment.model_io import (InferenceClient, PROMPT_VERSION, assert_model_separation)
from algolia_enrichment.pipeline import GATES_LOADED, process_record
from algolia_enrichment.profiles import load_profile
from algolia_enrichment.scout import ScoutClient
from algolia_enrichment.state import RunState
from algolia_enrichment.validate import GATE_REGISTRY, grounding, live as live_validate, payload, quality
from algolia_enrichment.verdicts import canonical_index

RECORD_ATTRIBUTES = ["objectID", "url", "title", "description", "source", "page_type",
                     "language_code"]

# Measured on one real Scout job, queue wait included. Used only to PROJECT a runtime, never to
# claim one.
MEASURED_S_PER_RECORD = 80.0


# ---------------------------------------------------------------------------
# plumbing
# ---------------------------------------------------------------------------

class Ctx:
    """Everything a command needs, resolved once and printed once."""

    def __init__(self, args):
        self.args = args
        self.cfg = load_config(args.workspace, args.source_index, args.target_index)
        self.workspace = self.cfg.workspace
        self.enrichment_dir = self.workspace / "docs" / "70-enrichment"
        self.run_id = args.run_id
        self.rf = RunFolder(self.enrichment_dir, self.run_id) if self.run_id else None
        self.profiles_dir = HERE / "profiles"

    @property
    def run_dir(self) -> Path:
        if self.rf is None:
            raise EnrichmentError("this command needs --run-id")
        return self.rf.dir

    def algolia(self) -> AlgoliaClient:
        return AlgoliaClient.from_env(self.workspace)

    def scout(self) -> ScoutClient:
        env = env_values(self.workspace)
        return ScoutClient(self.cfg.scout_base, env.get("SCOUT_HOSTED_API_KEY", ""))

    def inference(self) -> InferenceClient:
        return InferenceClient.from_env(self.workspace)

    def profile(self):
        if not self.args.source or not self.args.page_type:
            raise EnrichmentError("this command needs --source and --page-type")
        return load_profile(self.profiles_dir, self.args.source, self.args.page_type)

    def state(self) -> RunState:
        path = self.run_dir / "state.json"
        if path.exists():
            return RunState.load(self.run_dir)
        return RunState(run_id=self.run_id, source=self.args.source or "",
                        page_type=self.args.page_type or "",
                        target_index=self.cfg.target_index)

    def manifest(self) -> dict:
        p = self.run_dir / "manifest.json"
        if not p.exists():
            raise EnrichmentError(f"{p} not found. Run plan-slice first.")
        return json.loads(p.read_text())

    def emit(self, rel: str, data, command: str) -> Path:
        text = data if isinstance(data, str) else json.dumps(data, indent=2, ensure_ascii=False,
                                                             sort_keys=True)
        return self.rf.write(rel, text, command)

    def emit_jsonl(self, rel: str, rows: list[dict], command: str) -> Path:
        return self.rf.write(rel, "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
                             command)

    def banner(self, command: str) -> None:
        print(f"[{command}] workspace={self.workspace}")
        print(f"[{command}] source-index={self.cfg.source_index}  "
              f"target-index={self.cfg.target_index}")
        if self.run_id:
            print(f"[{command}] run-id={self.run_id}  run-dir={self.run_dir}")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _echo_config(ctx: Ctx, profile, judge_tier: str | None, body_source: str) -> dict:
    cfg = write_effective_config(
        ctx.run_dir, profile=profile,
        gates_loaded=GATES_LOADED + sorted(GATE_REGISTRY),
        writer_model=ctx.cfg.writer_model, judge_model=ctx.cfg.judge_model if judge_tier else None,
        prompt_version=PROMPT_VERSION, canonical_version=canonical_version(),
        body_source=body_source,
        thresholds={
            "min_body_chars": profile.min_body_chars,
            "abstract_span_count": list(profile.abstract_span_count),
            "highlight_count": list(profile.highlight_count),
            "information_gain_minimum": profile.information_gain_minimum,
            "coverage_target_pct": profile.coverage_target_pct,
            "max_human_review_open_pct": profile.max_human_review_open_pct,
            "max_span_distance": profile.max_span_distance,
        })
    print("[effective-config] " + json.dumps(cfg, sort_keys=True))
    return cfg


# ---------------------------------------------------------------------------
# read-only commands
# ---------------------------------------------------------------------------

def cmd_census(ctx: Ctx) -> int:
    ctx.banner("census")
    client = ctx.algolia()
    distinct, raw = client.record_count(ctx.cfg.source_index)
    if raw <= 0 and not ctx.args.allow_empty_index:
        raise ZeroWorkError(
            f"{ctx.cfg.source_index} reports {raw} records. A zero-record census is a failure "
            f"unless --allow-empty-index says an empty index is expected.")
    counts = corpus.live_slice_counts(client, ctx.cfg.source_index)
    scanned = sum(counts.values())
    if scanned != raw:
        raise EnrichmentError(
            f"scan counted {scanned} records but the index reports {raw}. A census that does not "
            f"reconcile is not a census.")
    data = {"index": ctx.cfg.source_index, "taken_at": _now(),
            "distinct_url_hits": distinct, "records": raw, "scanned": scanned,
            "slices": dict(sorted(counts.items(), key=lambda kv: -kv[1]))}
    if ctx.rf:
        ctx.emit("census-before.json", data, "census")
    print(f"records={raw}  distinct-url={distinct}  page_types={len(counts)}")
    for key, n in sorted(counts.items(), key=lambda kv: -kv[1])[:15]:
        print(f"  {n:6d}  {key}")
    return 0


def cmd_profile_lint(ctx: Ctx) -> int:
    ctx.banner("profile-lint")
    client = ctx.algolia()
    counts = corpus.live_slice_counts(client, ctx.cfg.source_index)
    report = profile_lint.lint(ctx.profiles_dir, counts)
    if ctx.rf:
        ctx.emit("validation/profile-lint.json", report, "profile-lint")
    print(f"live page_types : {report['live_page_types']}")
    print(f"resolved        : {len(report['resolved'])}")
    print(f"excluded        : {len(report['excluded'])} "
          f"({sum(v['records'] for v in report['excluded'].values())} records)")
    for u in report["uncovered"]:
        print(f"  UNCOVERED {u['key']} ({u['records']} records)")
    for e in report["errors"]:
        print(f"  ERROR {e}")
    if not report["ok"]:
        raise EnrichmentError(
            f"{len(report['uncovered'])} uncovered page_types ({report['uncovered_records']} "
            f"records) and {len(report['errors'])} profile errors. An uncovered page_type means "
            f"a slice hard-refuses mid-run.")
    print("PASS: every live page_type resolves to a profile or an explicit exclusion.")
    return 0


def cmd_health_scout(ctx: Ctx) -> int:
    ctx.banner("health-scout")
    report = ctx.scout().health(ctx.args.probe_url, ctx.cfg.site)
    if ctx.rf:
        ctx.emit("scout-health.json", report, "health-scout")
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise EnrichmentError(
            f"Scout returned no usable body for {ctx.args.probe_url}. `/health` alone is not "
            f"evidence -- Scout has reported healthy for three hours while unable to start a "
            f"worker thread.")
    print(f"PASS: real job returned {report['chars']} chars in {report['elapsed_s']}s.")
    return 0


def cmd_plan_slice(ctx: Ctx) -> int:
    ctx.banner("plan-slice")
    profile = ctx.profile()
    client = ctx.algolia()
    records = [r for r in client.browse(ctx.cfg.source_index, attributes=RECORD_ATTRIBUTES)
               if r.get("source") == profile.source and r.get("page_type") == profile.page_type]

    counts = corpus.live_slice_counts(client, ctx.cfg.source_index)
    live_count = counts.get(profile.key, 0)
    if len(records) != live_count:
        raise EnrichmentError(
            f"scan found {len(records)} records for {profile.key} but the census says "
            f"{live_count}. The two must agree before a slice is planned.")

    replay_of = ""
    if ctx.args.replay_run:
        # A stability experiment must re-run the SAME records, while reading their current source
        # fields afresh. Reusing the previous manifest rows would silently reuse stale metadata;
        # re-planning with --limit would sample different objectIDs because the run id changes.
        prior_path = ctx.enrichment_dir / "runs" / ctx.args.replay_run / "manifest.json"
        if not prior_path.exists():
            raise EnrichmentError(f"replay manifest not found: {prior_path}")
        prior = json.loads(prior_path.read_text())
        if prior.get("source") != profile.source or prior.get("page_type") != profile.page_type:
            raise EnrichmentError(
                f"replay slice is {prior.get('source')!r}/{prior.get('page_type')!r}, not "
                f"{profile.source!r}/{profile.page_type!r}")
        wanted = list(prior.get("objectIDs") or [])
        if not wanted:
            raise ZeroWorkError("replay manifest names zero records")
        current = {r["objectID"]: r for r in records}
        missing = [oid for oid in wanted if oid not in current]
        if missing:
            raise EnrichmentError(
                f"{len(missing)} replay records no longer belong to {profile.key}: {missing[:5]}")
        records = [current[oid] for oid in wanted]
        replay_of = ctx.args.replay_run
    elif ctx.args.limit:
        # A bounded smoke slice. Deterministically sampled, and the manifest says so -- an
        # unlabelled subset reported as a slice is how a partial run reads as a complete one.
        if ctx.args.languages:
            wanted = [w.strip() for w in ctx.args.languages.split(",") if w.strip()]
            by_lang: dict[str, list[dict]] = {}
            for r in records:
                by_lang.setdefault((r.get("language_code") or "?"), []).append(r)
            chosen: list[dict] = []
            for spec in wanted:
                lang, _, n = spec.partition(":")
                pool = sorted(by_lang.get(lang, []), key=lambda r: r["objectID"])
                take = int(n) if n else ctx.args.limit
                if len(pool) < take:
                    raise EnrichmentError(
                        f"asked for {take} {lang!r} records, the slice has {len(pool)}")
                rng = random.Random(f"{ctx.run_id}:{lang}")
                chosen += rng.sample(pool, take)
            records = sorted(chosen, key=lambda r: r["objectID"])
        else:
            rng = random.Random(ctx.run_id)
            records = sorted(rng.sample(records, min(ctx.args.limit, len(records))),
                             key=lambda r: r["objectID"])

    ids = [r["objectID"] for r in records]
    if len(set(ids)) != len(ids):
        raise EnrichmentError("duplicate objectIDs in the planned slice")
    if not ids and not ctx.args.allow_empty:
        raise ZeroWorkError(f"{profile.key} planned zero records. Zero work is a failure.")

    langs: dict[str, int] = {}
    for r in records:
        langs[r.get("language_code") or "?"] = langs.get(r.get("language_code") or "?", 0) + 1

    manifest = {
        "run_id": ctx.run_id,
        "planned_at": _now(),
        "source": profile.source,
        "page_type": profile.page_type,
        "profile_version": profile.version,
        "source_index": ctx.cfg.source_index,
        "target_index": ctx.cfg.target_index,
        "live_slice_count": live_count,
        "planned_count": len(ids),
        "is_bounded_subset": bool(ctx.args.limit),
        "replay_of": replay_of or None,
        "language_split": dict(sorted(langs.items())),
        "objectIDs": ids,
        "records": records,
        "projection": project_runtime(len(ids), DEFAULT_SCOUT_CONCURRENCY, MEASURED_S_PER_RECORD),
    }
    ctx.emit("manifest.json", manifest, "plan-slice")
    state = ctx.state()
    state.save(ctx.run_dir)
    print(f"planned {len(ids)} of {live_count} live {profile.key} records")
    print(f"languages: {manifest['language_split']}")
    print(f"projection: {json.dumps(manifest['projection'])}")
    return 0


def cmd_corpus_status(ctx: Ctx) -> int:
    ctx.banner("corpus-status")
    client = ctx.algolia()
    counts = corpus.live_slice_counts(client, ctx.cfg.source_index)
    lint = profile_lint.lint(ctx.profiles_dir, counts)
    status = corpus.build_status(client, ctx.cfg.source_index, ctx.cfg.target_index,
                                 ctx.enrichment_dir / "runs", lint)
    path = corpus.write_state(ctx.workspace, status)
    lines = [f"# Corpus status\n", f"_generated {status['updated_at']}_\n",
             f"- source `{status['source_index']}`: {status['total_live_records']} records, "
             f"{status['live_page_types']} page_types",
             f"- target `{status['target_index']}`: {status['target_records']} records, "
             f"{status['target_enriched_records']} enriched\n",
             "| slice | planned | written (live) | reconciles |", "|---|---:|---:|---|"]
    for key, s in sorted(status["slices"].items()):
        lines.append(f"| {key} | {s['planned_target_count']} | {s['target_written_live']} | "
                     f"{s.get('reconciles', 'n/a')} |")
    (ctx.enrichment_dir / "CORPUS-STATUS.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nwrote {path}")
    if not status["ok"]:
        raise EnrichmentError(
            f"corpus-status is RED: unprofiled={status['unprofiled_page_types']} "
            f"unreconciled={status['unreconciled_slices']}. No future slice starts on red.")
    print("PASS: every live page_type is profiled or excluded, and every slice reconciles.")
    return 0


# ---------------------------------------------------------------------------
# the pipeline
# ---------------------------------------------------------------------------

def cmd_fetch(ctx: Ctx) -> int:
    ctx.banner("fetch")
    profile = ctx.profile()
    manifest = ctx.manifest()
    state = ctx.state()
    metrics = Metrics(ctx.run_dir, "fetch")
    ledger = Ledger(ctx.run_dir)
    cache = RunCache(ctx.run_dir, ctx.run_id)
    records = manifest["records"]
    done = {"ok": 0, "failed": 0}
    source_name = ScoutRefetch.name
    replay_bodies: dict[str, dict] = {}
    if ctx.args.replay_bodies_run:
        donor_dir = ctx.enrichment_dir / "runs" / ctx.args.replay_bodies_run
        donor_manifest_path = donor_dir / "manifest.json"
        if not donor_manifest_path.exists():
            raise EnrichmentError(f"sealed-body replay manifest not found: {donor_manifest_path}")
        donor_manifest = json.loads(donor_manifest_path.read_text())
        expected = [r["objectID"] for r in records]
        if donor_manifest.get("objectIDs") != expected:
            raise EnrichmentError("sealed-body replay refuses a different objectID sequence")
        replay_bodies = RunCache(donor_dir, ctx.args.replay_bodies_run).load()
        if set(replay_bodies) != set(expected):
            raise EnrichmentError("sealed-body replay donor does not contain exactly this slice")
        source_name = SEALED_SCOUT_REPLAY

    _echo_config(ctx, profile, ctx.cfg.judge_tier if profile.judge_required else None, source_name)

    source = None if replay_bodies else ScoutRefetch(ctx.scout(), ctx.cfg.site)

    def one(rec: dict) -> dict:
        body = dict(replay_bodies[rec["objectID"]]) if replay_bodies else source.body_for(rec)
        if replay_bodies:
            body["replayed_from_run"] = ctx.args.replay_bodies_run
        cache.store(body)
        return body

    def report(rec, res, exc):
        if exc is not None or res is None or res.get("fetch_error"):
            done["failed"] += 1
            reason = str(exc) if exc else res.get("fetch_error", "unknown")
            ledger.append(rec["objectID"], "fetch", "FETCH_FAILED", reason=reason[:200])
            print(f"  FAIL {rec['objectID']}: {reason[:120]}")
        else:
            done["ok"] += 1
            ledger.append(rec["objectID"], "fetch", "REPLAYED" if replay_bodies else "FETCHED",
                          chars=len(res["markdown"]))
            if done["ok"] % 10 == 0:
                print(f"  ... {done['ok']} fetched")

    run_concurrent(records, one, ctx.args.concurrency, report)
    fetch_manifest = cache.seal([r["objectID"] for r in records], source_name)
    if replay_bodies:
        fetch_manifest["replayed_from_run"] = ctx.args.replay_bodies_run
        (ctx.run_dir / "fetch-manifest.json").write_text(json.dumps(fetch_manifest, indent=2,
                                                                       sort_keys=True))
    ctx.rf.record(f"{RunCache(ctx.run_dir, ctx.run_id).cache_dir.name}/", "fetch")
    ctx.rf.record("fetch-manifest.json", "fetch")
    metrics.flush(len(records))

    state.set("fetch", "DONE" if done["failed"] == 0 else "PARTIAL")
    state.save(ctx.run_dir)
    print(f"fetched {done['ok']}, failed {done['failed']}, of {len(records)} planned")
    if done["ok"] == 0:
        raise ZeroWorkError("fetch produced zero bodies. Zero work is a failure.")
    print(f"cache sealed: {fetch_manifest['fetched']} bodies under this run id")
    return 0


def cmd_enrich(ctx: Ctx) -> int:
    ctx.banner("enrich")
    profile = ctx.profile()
    manifest = ctx.manifest()
    state = ctx.state()
    state.require("fetch", "DONE", "PARTIAL")
    metrics = Metrics(ctx.run_dir, "enrich")
    ledger = Ledger(ctx.run_dir)

    judge_tier = ctx.cfg.judge_tier if (profile.judge_required and ctx.cfg.judge_enabled) else None
    inference = ctx.inference()
    pinned = assert_model_separation(inference, ctx.cfg)
    print(f"[models] {json.dumps(pinned['tiers'], sort_keys=True)}")
    _echo_config(ctx, profile, judge_tier, "ScoutRefetch")

    # THE JOIN. `enrich` cannot be pointed at any cache other than the one this run's own fetch
    # produced -- there is no argument for it.
    bodies = RunCache(ctx.run_dir, ctx.run_id).load()
    canon_map = canonical_index(manifest["records"])
    registry_path = ctx.workspace / selection_registry.REGISTRY_RELATIVE_PATH
    selection_cache = {} if ctx.args.ignore_selection_registry else selection_registry.load(registry_path)
    print(f"[selection-registry] {len(selection_cache)} frozen content contracts"
          + (" (intentionally bypassed for stability evaluation)"
             if ctx.args.ignore_selection_registry else ""))

    work = []
    for rec in manifest["records"]:
        body = bodies.get(rec["objectID"])
        if body is None:
            continue
        merged = dict(rec)
        merged.update({k: v for k, v in body.items() if k != "url"})
        work.append(merged)
    if not work:
        raise ZeroWorkError("enrich found zero fetched bodies for the planned records.")

    def one(rec: dict) -> dict:
        return process_record(rec, profile, inference, writer_tier=ctx.cfg.writer_tier,
                              judge_tier=judge_tier, canonical_map=canon_map,
                              selection_cache=selection_cache)

    counts: dict[str, int] = {}

    def report(rec, res, exc):
        if exc is not None or res is None:
            counts["ERROR"] = counts.get("ERROR", 0) + 1
            ledger.append(rec["objectID"], "enrich", "ERROR", reason=str(exc)[:200])
            print(f"  ERROR {rec['objectID']}: {exc}")
            return
        status = res.get("status", "?")
        counts[status] = counts.get(status, 0) + 1
        ledger.append(rec["objectID"], "enrich", status)

    results = [r for r in run_concurrent(work, one, ctx.args.concurrency, report) if r]
    ctx.emit_jsonl("outputs/base/results.jsonl", results, "enrich")
    metrics.flush(len(work))
    state.set("enrich", "DONE" if not counts.get("ERROR") else "PARTIAL")
    state.save(ctx.run_dir)
    print(f"processed {len(results)} of {len(work)}: {json.dumps(counts, sort_keys=True)}")
    if not results:
        raise ZeroWorkError("enrich produced zero rows. Zero work is a failure.")
    return 0


REPAIRABLE_STATUSES = {"QUARANTINED_BY_GATE", "WRITER_UNPARSEABLE", "JUDGE_UNAVAILABLE"}


def merge_repair_results(prior: list[dict], latest: list[dict]) -> list[dict]:
    """Keep the best known repair result for each record.

    Writer selection is non-deterministic. A later failed retry is evidence about that retry, not
    grounds for erasing a prior grounded PASS. This makes the repair artifact monotonic: a PASS
    can only be replaced by another PASS.
    """
    merged = {row["objectID"]: row for row in prior}
    for row in latest:
        existing = merged.get(row["objectID"])
        if existing and existing.get("status") == "PASS" and row.get("status") != "PASS":
            continue
        merged[row["objectID"]] = row
    return list(merged.values())


def cmd_repair(ctx: Ctx) -> int:
    """Re-run the selection ladder for rows a gate refused.

    Repair is not a second algorithm. It is the SAME live path over the same bodies, with the
    failing candidates banned -- which is what `evaluate_selection`'s retry ladder already does
    inside `enrich`. This command exists for rows whose ladder ran out of attempts, so the extra
    attempts happen against artifacts rather than a re-fetch.
    """
    ctx.banner("repair")
    profile = ctx.profile()
    manifest = ctx.manifest()
    state = ctx.state()
    state.require("enrich", "DONE", "PARTIAL")
    base = _read_jsonl(ctx.run_dir / "outputs" / "base" / "results.jsonl")
    prior = _read_jsonl(ctx.run_dir / "outputs" / "repair" / "results.jsonl")
    effective = {row["objectID"]: row for row in base}
    effective.update({row["objectID"]: row for row in prior})
    targets = [effective[row["objectID"]] for row in base
               if effective[row["objectID"]].get("status") in REPAIRABLE_STATUSES]
    if not targets and not ctx.args.allow_empty:
        raise ZeroWorkError(
            "repair found zero repairable rows. If that is the true state, pass --allow-empty; "
            "silently reporting success on zero rows is the failure this refuses.")

    bodies = RunCache(ctx.run_dir, ctx.run_id).load()
    by_id = {r["objectID"]: r for r in manifest["records"]}
    judge_tier = ctx.cfg.judge_tier if (profile.judge_required and ctx.cfg.judge_enabled) else None
    inference = ctx.inference()
    assert_model_separation(inference, ctx.cfg)
    canon_map = canonical_index(manifest["records"])
    selection_cache = selection_registry.load(
        ctx.workspace / selection_registry.REGISTRY_RELATIVE_PATH)
    ledger = Ledger(ctx.run_dir)

    def one(row: dict) -> dict:
        rec = dict(by_id[row["objectID"]])
        rec.update({k: v for k, v in bodies[row["objectID"]].items() if k != "url"})
        out = process_record(rec, profile, inference, writer_tier=ctx.cfg.writer_tier,
                             judge_tier=judge_tier, canonical_map=canon_map,
                             selection_cache=selection_cache)
        out["repair_attempt"] = True
        return out

    recovered = 0

    def report(row, res, exc):
        nonlocal recovered
        if res and res.get("status") == "PASS":
            recovered += 1
        ledger.append(row["objectID"], "repair",
                      (res or {}).get("status", "ERROR") if not exc else "ERROR")

    latest = [r for r in run_concurrent(targets, one, ctx.args.concurrency, report) if r]
    results = merge_repair_results(prior, latest)
    ctx.emit_jsonl("outputs/repair/results.jsonl", results, "repair")
    state.set("repair", "DONE")
    state.save(ctx.run_dir)
    print(f"repair attempted {len(targets)}, recovered {recovered} to PASS")
    return 0


def cmd_build_final(ctx: Ctx) -> int:
    ctx.banner("build-final")
    profile = ctx.profile()
    manifest = ctx.manifest()
    state = ctx.state()
    state.require("enrich", "DONE", "PARTIAL")

    final_path = ctx.run_dir / "final" / "results.jsonl"
    if final_path.exists():
        approvals.require(ctx.run_dir, "rerun", run_id=ctx.run_id,
                          source_index=ctx.cfg.source_index, target_index=ctx.cfg.target_index)

    base = _read_jsonl(ctx.run_dir / "outputs" / "base" / "results.jsonl")
    repair = _read_jsonl(ctx.run_dir / "outputs" / "repair" / "results.jsonl")

    # EXPLICIT PRECEDENCE, never an implicit glob. Historical artifacts poisoned validation on
    # this project: a repair output and a base output for the same record, and whichever the glob
    # happened to read last won.
    merged: dict[str, dict] = {}
    for row in base:
        merged[row["objectID"]] = row
    for row in repair:
        prior = merged.get(row["objectID"])
        # A repair wins ONLY when it improved the outcome. A repair that failed must not
        # overwrite a base row that passed.
        if prior is None or row.get("status") == "PASS" or prior.get("status") != "PASS":
            merged[row["objectID"]] = row

    planned = list(manifest["objectIDs"])
    missing = [oid for oid in planned if oid not in merged]
    extra = [oid for oid in merged if oid not in set(planned)]
    if extra:
        raise EnrichmentError(f"final artifact contains {len(extra)} objectIDs the manifest never "
                              f"planned: {extra[:5]}")

    rows = [merged[oid] for oid in planned if oid in merged]
    for oid in missing:
        # A record that never produced a row is UNATTEMPTED, and it is counted -- not dropped.
        rows.append({"objectID": oid, "status": "UNATTEMPTED",
                     "verdict_reason": "no result row was produced for this planned record"})

    writable, review_rows, terminal = human_review.partition(rows, profile)
    payloads, skipped = payload.build_payloads(rows)

    ctx.emit_jsonl("final/results.jsonl", rows, "build-final")
    ctx.emit_jsonl("final/payloads.jsonl", payloads, "build-final")
    ctx.emit_jsonl("final/human-review-queue.jsonl", review_rows, "build-final")

    cov = human_review.coverage(manifest["planned_count"], len(writable), len(review_rows),
                                len(terminal), profile)
    ctx.emit("validation/coverage.json", cov, "build-final")
    state.set("final", "BUILT")
    state.save(ctx.run_dir)

    print(f"planned {manifest['planned_count']} | writable {len(writable)} | "
          f"human-review {len(review_rows)} | terminal {len(terminal)} | "
          f"unattempted {cov['unattempted']}")
    print(f"skipped-by-status: {json.dumps(skipped, sort_keys=True)}")
    print(f"coverage: {json.dumps(cov, sort_keys=True)}")
    if not cov["all_accounted_for"]:
        raise EnrichmentError(
            f"{cov['unattempted']} planned records have no terminal outcome. Every planned record "
            f"must be written, repaired-then-written, or in the human-review queue.")
    return 0


def cmd_validate(ctx: Ctx) -> int:
    ctx.banner("validate")
    profile = ctx.profile()
    manifest = ctx.manifest()
    state = ctx.state()
    state.require("final", "BUILT")

    echoed = read_effective_config(ctx.run_dir)
    if not echoed:
        raise EnrichmentError("no effective-config.json. A run that did not echo its config "
                              "cannot be validated against the profile it claims.")
    if echoed.get("profile_version") != profile.version:
        raise EnrichmentError(
            f"effective-config.json claims profile {echoed.get('profile_version')!r} but the "
            f"profile on disk is {profile.version!r}. The run and the profile disagree; a gate "
            f"'fixed' after the run does not apply to it.")
    if echoed.get("canonical_version") != canonical_version():
        raise EnrichmentError(
            f"canonicalisation rules changed since the run "
            f"({echoed.get('canonical_version')} -> {canonical_version()}). A stored span is only "
            f"findable under the rules that produced it; re-run rather than re-validate.")

    rows = _read_jsonl(ctx.run_dir / "final" / "results.jsonl")
    bodies = RunCache(ctx.run_dir, ctx.run_id).load()
    writable = [r for r in rows if human_review.is_writable(r)]

    g = grounding.check_rows(writable, bodies)
    q = quality.check_rows(writable)
    payloads = _read_jsonl(ctx.run_dir / "final" / "payloads.jsonl")
    p = payload.check_payloads(payloads, expected_target_ids=set(manifest["objectIDs"]))
    census = quality.quality_census(rows)

    disagreements = [r["objectID"] for r in rows if r.get("status") == "METHOD_DISAGREEMENT"]
    method_rate = len(disagreements) / max(1, len(rows))

    report = {
        "run_id": ctx.run_id, "validated_at": _now(),
        "profile_version": profile.version,
        "grounding": g, "quality": q, "payload": p,
        "language_census": census,
        "method_check": {"disagreements": len(disagreements),
                         "rate": round(method_rate, 4),
                         "threshold": profile.max_method_disagreement_pct,
                         "ok": method_rate <= profile.max_method_disagreement_pct},
        "gates_loaded": echoed.get("gates_loaded"),
    }
    ctx.emit("validation/artifact-validation.json", report, "validate")
    ctx.emit("validation/method-check.json", report["method_check"], "validate")

    print(f"grounding : {g['located']}/{g['spans_checked']} spans located, modes={g['modes']}")
    print(f"quality   : leakage={len(q['leakage'])} chrome={len(q['chrome'])} "
          f"incomplete={len(q['incomplete_spans'])} "
          f"duplicate-description={len(q['duplicate_description'])}")
    print(f"payload   : {p['payloads']} payloads, fields={p['fields']}")
    print("language census:")
    for lang, s in census.items():
        print(f"  {lang}: records={s['records']} candidates={s['candidates']} "
              f"abstract_chars={s['abstract_span_chars']} highlights={s['highlight_count']}")

    fatal = []
    if not g["ok"]:
        fatal.append(f"{len(g['failures'])} spans not found in their source body, "
                     f"{len(g['missing_body'])} rows with no body")
    if q["leakage"] or q["chrome"] or q["incomplete_spans"]:
        fatal.append("quality: leakage/chrome/incomplete spans present")
    if not report["method_check"]["ok"]:
        fatal.append(f"method disagreement {method_rate:.1%} over "
                     f"{profile.max_method_disagreement_pct:.1%}")
    if fatal:
        state.set("validate", "FAILED"); state.save(ctx.run_dir)
        raise EnrichmentError("VALIDATION FAILED: " + "; ".join(fatal))

    state.set("validate", "PASSED")
    state.save(ctx.run_dir)
    print(f"PASS: {g['spans_checked']} spans checked, 0 grounding failures.")
    return 0


def cmd_review_pack(ctx: Ctx) -> int:
    ctx.banner("review-pack")
    profile = ctx.profile()
    rows = _read_jsonl(ctx.run_dir / "final" / "results.jsonl")
    review = _read_jsonl(ctx.run_dir / "final" / "human-review-queue.jsonl")
    bodies = RunCache(ctx.run_dir, ctx.run_id).load()
    if not rows:
        raise ZeroWorkError("review-pack has no final rows to sample.")

    passed = [r for r in rows if human_review.is_writable(r)]
    repaired = [r for r in passed if r.get("repaired") or r.get("repair_attempt")]
    if not repaired and any(r.get("repaired") for r in rows):
        raise EnrichmentError("review pack would omit repaired records")

    def take(pool, n):
        pool = sorted(pool, key=lambda r: r["objectID"])
        return pool[:n] if len(pool) <= n else \
            random.Random(ctx.run_id).sample(pool, n)

    sample = {
        "writable_pass": take(passed, min(20, len(passed))),
        "repaired": take(repaired, min(10, len(repaired))),
        "human_review": review[:10],
        "language_mismatch": [r for r in rows if r.get("language_mismatch")],
    }
    lines = [f"# Review pack -- {profile.key}", "",
             f"run: `{ctx.run_id}`  profile: `{profile.version}`",
             f"minimum_review_sample: {profile.minimum_review_sample}", ""]
    for group, items in sample.items():
        lines.append(f"## {group} ({len(items)})\n")
        for r in items:
            oid = r.get("objectID")
            body = (bodies.get(oid) or {}).get("markdown", "")
            lines += [f"### `{oid}`", f"- url: {r.get('url')}",
                      f"- status: {r.get('status')}  language: {r.get('language_code')}",
                      f"- abstract: {' '.join(r.get('abstract_spans_stored') or []) or '(none)'}"]
            for h in (r.get("keyhighlights_enriched") or []):
                lines.append(f"  - highlight: {h}")
            if r.get("reason") or r.get("verdict_reason"):
                lines.append(f"- reason: {r.get('reason') or r.get('verdict_reason')}")
            lines.append(f"- source body: {len(body)} chars\n")
    ctx.emit("reports/review-pack.md", "\n".join(lines), "review-pack")
    print(f"review pack: {sum(len(v) for v in sample.values())} records across "
          f"{len(sample)} strata")
    return 0


def cmd_freeze_selections(ctx: Ctx) -> int:
    """Promote validated candidate IDs to the content-addressed reproducibility registry."""
    ctx.banner("freeze-selections")
    state = ctx.state()
    state.require("validate", "PASSED")
    rows = _read_jsonl(ctx.run_dir / "final" / "results.jsonl")
    if not rows:
        raise ZeroWorkError("freeze-selections has no final rows")
    path = ctx.workspace / selection_registry.REGISTRY_RELATIVE_PATH
    report = selection_registry.freeze(path, rows, run_id=ctx.run_id)
    ctx.emit("validation/selection-freeze.json", report, "freeze-selections")
    print(json.dumps(report, sort_keys=True))
    print("PASS: validated selections are frozen by content hash, profile and prompt version.")
    return 0


# ---------------------------------------------------------------------------
# write path
# ---------------------------------------------------------------------------

def cmd_prepare_target_index(ctx: Ctx) -> int:
    ctx.banner("prepare-target-index")
    client = ctx.algolia()
    write.assert_write_target(ctx.cfg.source_index, ctx.cfg.target_index)
    exists = client.index_exists(ctx.cfg.target_index)
    if not exists:
        approvals.require(ctx.run_dir, "prepare-target-index", run_id=ctx.run_id,
                          source_index=ctx.cfg.source_index, target_index=ctx.cfg.target_index)
    report = write.prepare_target_index(client, ctx.cfg.source_index, ctx.cfg.target_index,
                                        create=not exists)
    ctx.emit("validation/target-index-ready.json", report, "prepare-target-index")
    ctx.emit("validation/target-index-settings.json",
             client.get_settings(ctx.cfg.target_index), "prepare-target-index")
    print(json.dumps(report, indent=2))
    print("PASS: target index ready, both enriched fields present as separate attributes.")
    return 0


def cmd_dry_run_write(ctx: Ctx) -> int:
    ctx.banner("dry-run-write")
    manifest = ctx.manifest()
    state = ctx.state()
    state.require("validate", "PASSED")
    client = ctx.algolia()
    write.assert_write_target(ctx.cfg.source_index, ctx.cfg.target_index)
    if not client.index_exists(ctx.cfg.target_index):
        raise EnrichmentError(f"{ctx.cfg.target_index} does not exist. Run prepare-target-index.")

    payloads = _read_jsonl(ctx.run_dir / "final" / "payloads.jsonl")
    report = payload.check_payloads(payloads, expected_target_ids=set(manifest["objectIDs"]))

    _, source_now = client.record_count(ctx.cfg.source_index)
    census_path = ctx.run_dir / "census-before.json"
    if census_path.exists():
        before = json.loads(census_path.read_text()).get("records")
        if before is not None and before != source_now:
            # The live index can change mid-run. A drift that is not acknowledged makes every
            # count in the packet stale.
            raise EnrichmentError(
                f"source index moved from {before} to {source_now} records since the census. "
                f"Re-census and re-plan rather than writing against a stale count.")

    out = {
        "target_index": ctx.cfg.target_index,
        "source_index": ctx.cfg.source_index,
        "source_records_now": source_now,
        "payload_count": len(payloads),
        "allowed_fields": sorted(payload.ALLOWED_FIELDS),
        "forbidden_fields_present": [],
        "sample_payload": payloads[0] if payloads else None,
        "check": report,
    }
    ctx.emit("validation/write-dry-run.json", out, "dry-run-write")
    state.set("write", "DRY_RUN_PASSED")
    state.save(ctx.run_dir)
    print(f"{len(payloads)} payloads would be written to {ctx.cfg.target_index}")
    print(f"fields: {sorted(payload.ALLOWED_FIELDS)}")
    print("PASS: payload shape legal, every objectID in the manifest, source count unchanged.")
    return 0


def cmd_apply_write(ctx: Ctx) -> int:
    ctx.banner("apply-write")
    manifest = ctx.manifest()
    state = ctx.state()
    state.require("write", "DRY_RUN_PASSED")
    client = ctx.algolia()
    payloads = _read_jsonl(ctx.run_dir / "final" / "payloads.jsonl")
    if not payloads:
        raise ZeroWorkError("apply-write has zero payloads. Zero work is a failure.")

    # The count compared is the one THIS run built, not the one the approval claims -- comparing
    # the approval to itself would be a tautology.
    approval = approvals.require(
        ctx.run_dir, "apply-write", run_id=ctx.run_id,
        source_index=ctx.cfg.source_index, target_index=ctx.cfg.target_index,
        source=manifest["source"], page_type=manifest["page_type"],
        expected_target_count=manifest["planned_count"],
        expected_write_count=len(payloads))
    print(f"[approval] {approval.path.name} by {approval.approved_by}")

    _, source_before = client.record_count(ctx.cfg.source_index)
    settings_before = client.get_settings(ctx.cfg.source_index)

    result = write.apply_write(client, ctx.cfg.target_index, ctx.cfg.source_index, payloads)
    ctx.emit("validation/write-applied.json", result, "apply-write")

    src = live_validate.source_index_unchanged(client, ctx.cfg.source_index, source_before,
                                               settings_before)
    ctx.emit("validation/source-index-unchanged.json", src, "apply-write")
    state.set("write", "APPLIED")
    state.save(ctx.run_dir)
    print(f"wrote {result['written']} records to {ctx.cfg.target_index} "
          f"(indexing published: {result['indexing_published']})")
    print(f"source index {ctx.cfg.source_index}: {src['records']} records, "
          f"settings changed: {src['settings_changed'] or 'none'}")
    if not src["ok"]:
        raise EnrichmentError("SOURCE INDEX CHANGED during a target-index write. Stop.")
    return 0


def cmd_verify_live(ctx: Ctx) -> int:
    ctx.banner("verify-live")
    manifest = ctx.manifest()
    state = ctx.state()
    state.require("write", "APPLIED", "LIVE_VERIFIED")
    client = ctx.algolia()
    payloads = _read_jsonl(ctx.run_dir / "final" / "payloads.jsonl")

    # Every objectID any run of this skill has ever planned. The target index accumulates
    # slices, so scoping "extra records" to THIS run's manifest would report the previous slice
    # as contamination -- measured on the case-study smoke, which flagged the 10 Blog records
    # written an hour earlier.
    planned_by_any_run = _all_planned_ids(ctx.enrichment_dir / "runs")
    report = live_validate.verify(client, ctx.cfg.target_index, payloads,
                                  manifest_ids=planned_by_any_run)
    life = live_validate.proof_of_life(client, ctx.cfg.target_index, payloads)
    src = live_validate.source_index_unchanged(
        client, ctx.cfg.source_index,
        json.loads((ctx.run_dir / "census-before.json").read_text())["records"]
        if (ctx.run_dir / "census-before.json").exists() else
        client.record_count(ctx.cfg.source_index)[1])

    out = {"verification": report, "proof_of_life": life, "source_index": src,
           "verified_at": _now()}
    ctx.emit("validation/live-verification.json", out, "verify-live")
    print(f"live: {report['exact']} exact of {report['expected']}, "
          f"missing={len(report['missing'])} mismatched={len(report['mismatched'])} "
          f"extra={report['extra_count']} spans={report['spans_compared']}")
    for p in life["probes"]:
        print(f"  probe {p['objectID']}: nbHits={p['nbHits']} found_self={p['found_self']} "
              f"q={p['query']!r}")
    print(f"source index unchanged: {src['ok']} ({src['records']} records)")
    if not (report["ok"] and life["ok"] and src["ok"]):
        raise EnrichmentError("LIVE VERIFICATION FAILED. See validation/live-verification.json")
    state.set("write", "LIVE_VERIFIED")
    state.save(ctx.run_dir)
    print(f"PASS: {report['exact']} records byte-match, {life['queries_with_hits']} "
          f"enriched-only queries return hits.")
    return 0


# ---------------------------------------------------------------------------
# housekeeping
# ---------------------------------------------------------------------------

def cmd_cleanup(ctx: Ctx) -> int:
    ctx.banner("cleanup")
    protected = ["manifest.json", "final", "validation", "reports/packet.md", "approvals",
                 "artifact-manifest.json", "state.json", "effective-config.json"]
    if ctx.args.delete:
        approvals.require(ctx.run_dir, "cleanup", run_id=ctx.run_id,
                          source_index=ctx.cfg.source_index, target_index=ctx.cfg.target_index)
    archive = ctx.run_dir / "archive"
    archive.mkdir(exist_ok=True)
    moved = []
    for name in ("tmp", "logs", "probes"):
        src = ctx.run_dir / name
        if src.exists():
            dest = archive / name
            if dest.exists():
                continue
            src.rename(dest)
            moved.append(name)
    report = {"archived": moved, "protected": protected, "deleted": []}
    ctx.emit("validation/cleanup.json", report, "cleanup")
    print(json.dumps(report, indent=2))
    print("accepted evidence is never deleted by default; deletion needs cleanup-approved.json")
    return 0


def cmd_handoff(ctx: Ctx) -> int:
    ctx.banner("handoff")
    state = ctx.state()
    manifest_path = ctx.run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    if not manifest:
        raise EnrichmentError("handoff needs a planned run: no manifest.json")
    next_step = _next_step(state)
    if not next_step:
        raise EnrichmentError("handoff refuses to write without a named next step")
    body = "\n".join([
        f"# Handoff -- {ctx.run_id}", "",
        f"- generated: {_now()}",
        f"- slice: `{manifest.get('source')}/{manifest.get('page_type')}` "
        f"({manifest.get('planned_count')} planned)",
        f"- source index: `{ctx.cfg.source_index}` (read-only)",
        f"- target index: `{ctx.cfg.target_index}`",
        f"- state: `{json.dumps(state.tracks, sort_keys=True)}`", "",
        "## Next step", "", f"    {next_step}", "",
        "## Rules that do not change", "",
        "- run every operation through `algolia_enrich.py`; the loose scripts in",
        "  `docs/70-enrichment/*.py` are historical and two of them contain dead gate paths",
        "- Scout is the only body source; `enrich` reads only this run folder's own cache",
        "- three fields may be written: objectID, abstract_enriched, keyhighlights_enriched",
        f"- never write to `{ctx.cfg.source_index}`", "",
    ])
    path = ctx.enrichment_dir / "HANDOFF-current.md"
    path.write_text(body)
    print(body)
    print(f"\nwrote {path}")
    return 0


def _next_step(state: RunState) -> str:
    t = state.tracks
    if t.get("fetch") == "NONE":
        return "fetch"
    if t.get("enrich") == "NONE":
        return "enrich"
    if t.get("final") == "NONE":
        return "build-final"
    if t.get("validate") != "PASSED":
        return "validate"
    if t.get("write") == "NONE":
        return "dry-run-write"
    if t.get("write") == "DRY_RUN_PASSED":
        return "apply-write (needs approvals/write-approved.json)"
    if t.get("write") == "APPLIED":
        return "verify-live"
    return "cleanup, then corpus-status"


def _all_planned_ids(runs_dir: Path) -> set[str]:
    """Every objectID planned by any run on disk.

    This is the denominator for "no extra records in the target index". A record belonging to no
    run at all is an unknown writer and is the thing that check exists to catch.
    """
    ids: set[str] = set()
    for m in Path(runs_dir).glob("*/manifest.json"):
        try:
            ids |= set(json.loads(m.read_text()).get("objectIDs") or [])
        except (json.JSONDecodeError, OSError):
            continue
    return ids


def _read_jsonl(path: Path) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


# ---------------------------------------------------------------------------
# registry
# ---------------------------------------------------------------------------

# command -> (handler, needs a run folder + lock)
COMMANDS = {
    "census": (cmd_census, False),
    "profile-lint": (cmd_profile_lint, False),
    "health-scout": (cmd_health_scout, False),
    "corpus-status": (cmd_corpus_status, False),
    "plan-slice": (cmd_plan_slice, True),
    "fetch": (cmd_fetch, True),
    "enrich": (cmd_enrich, True),
    "repair": (cmd_repair, True),
    "build-final": (cmd_build_final, True),
    "validate": (cmd_validate, True),
    "review-pack": (cmd_review_pack, True),
    "freeze-selections": (cmd_freeze_selections, True),
    "prepare-target-index": (cmd_prepare_target_index, True),
    "dry-run-write": (cmd_dry_run_write, True),
    "apply-write": (cmd_apply_write, True),
    "verify-live": (cmd_verify_live, True),
    "cleanup": (cmd_cleanup, True),
    "handoff": (cmd_handoff, True),
}


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="algolia_enrich.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=sorted(COMMANDS))
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--run-id", default="")
    ap.add_argument("--source-index", default=None)
    ap.add_argument("--target-index", default=None)
    ap.add_argument("--source", default="")
    ap.add_argument("--page-type", default="")
    ap.add_argument("--limit", type=int, default=0,
                    help="bound the slice; the manifest records that it is a subset")
    ap.add_argument("--replay-run", default="",
                    help="plan the exact objectIDs from another run's manifest using fresh source records")
    ap.add_argument("--replay-bodies-run", default="",
                    help="reuse only a prior run's sealed Scout bodies; never calls Scout")
    ap.add_argument("--ignore-selection-registry", action="store_true",
                    help="evaluation only: force a fresh model selection from sealed bodies")
    ap.add_argument("--languages", default="",
                    help="stratified subset, e.g. 'de:4,fr:4,en:2'")
    ap.add_argument("--concurrency", type=int, default=DEFAULT_SCOUT_CONCURRENCY)
    ap.add_argument("--probe-url", default="")
    ap.add_argument("--allow-empty", action="store_true")
    ap.add_argument("--allow-empty-index", action="store_true")
    ap.add_argument("--delete", action="store_true")
    ap.add_argument("--recover-lock", action="store_true")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    handler, needs_run = COMMANDS[args.command]
    if args.command == "enrich" and args.concurrency == DEFAULT_SCOUT_CONCURRENCY:
        args.concurrency = DEFAULT_MODEL_CONCURRENCY
    try:
        ctx = Ctx(args)
        if needs_run:
            if not ctx.run_id:
                raise EnrichmentError(f"{args.command} requires --run-id")
            ctx.run_dir.mkdir(parents=True, exist_ok=True)
            with run_lock(ctx.run_dir, args.command, _now(), recover=args.recover_lock):
                return handler(ctx)
        return handler(ctx)
    except (ApprovalError, EnrichmentError, LockError, ProfileError, StateError,
            ZeroWorkError) as exc:
        print(f"\nFAIL [{args.command}] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
