#!/usr/bin/env python3
"""
shape_probe_libraries — 24 `/doc/libraries/*` pages via Scout, described structurally. No scores.

WHY THIS EXISTS
  Probe 1 characterised 9.2% of the `reference` `/doc` population and missed the dominant shape.
  `libraries` is 2,587 of 3,587 records (72%), and probe 1 included exactly one libraries page --
  `/doc/libraries/sdk`, an outlier at 612 chars with 0 usable facts on both sources. Codex,
  2026-08-09: "a 150-page sample now would be statistically larger but structurally blind."

  Same instrument, same bound, different population. No pass percentage, no Algolia write, no
  calibration. Structure only.

THE THING THIS PROBE ADDS THAT WAS NOT ASKED FOR, and why
  `lang-method` is 2,082 of the 2,587 libraries records -- 80.5% -- and the language histogram is
  csharp 200, go 200, java 200, javascript 200, kotlin 200, php 200, python 200, ruby 200, scala 200,
  swift 199, dart 83. That is not 2,082 documents. That is ~200 documents translated across 11
  language SDKs, where the prose is plausibly shared and only the code sample differs.

  If that holds, ~2,082 records -- 20% of the whole 10,198-record corpus -- will produce abstracts
  that are near-duplicates of each other ACROSS records. No per-record gate can see that: G7 compares
  a candidate to its own record's fields, and every one of the 11 would pass. So this probe spends 6
  of its 24 pages on THE SAME METHOD IN SIX LANGUAGES and measures the cross-language overlap
  directly. Codex's stratification spec did not ask for it; it is the largest measurable risk in the
  population and it costs nothing extra to answer here.

  python3 shape_probe_libraries.py --plan     # strata, counts, URLs. No network, no credits.
  python3 shape_probe_libraries.py --run      # fetch 24 via Scout, then report
  python3 shape_probe_libraries.py --report   # re-report from cache. No network.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import itertools
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

import shape_probe as SP                                                          # noqa: E402
from assert_scout_provenance import ProvenanceViolation, assert_scout_provenance  # noqa: E402
from fetch_router import FetchFailed, absolute_url, fetch_scout, scout_key, truncate  # noqa: E402

QUEUE_PATH = HERE / "work-queue.jsonl"
PROBE_DIR = HERE / "cache-scout" / "shape-probe-libraries-24"
QUARANTINE_DIR = PROBE_DIR / "quarantine"
FINDINGS_PATH = HERE / "reports" / "SCOUT-PROBE-LIBRARIES-24-findings.json"

CAP = 24

# Allocation. NOT proportional, and that is a deliberate choice worth stating: proportional to the
# population would put 19 of 24 pages in `lang-method` and leave one page each for the others, which
# characterises nothing outside the dominant shape. This is a SHAPE probe, so pages are spent on
# distinct shapes rather than on estimating a rate. Consequence, stated so it cannot be misread:
# **no count from this probe estimates any population frequency.**
ALLOCATION = {
    "lang-method-crosslang": 6,   # same method, six languages -- the duplication test
    "lang-method-spread":    8,   # different languages, different method groups
    "sdk-method":            4,   # Codex's "SDK method pages"
    "sdk-page":              3,   # Codex's "version/root pages"
    "upgrade-guide":         2,   # Codex's "guide/changelog/upgrade pages"
    "root":                  1,   # /doc/libraries/{sdk,versions,search-insights}
}


def stratum(url: str) -> str:
    """Population stratum from the URL alone. Deterministic, no model, no guessing."""
    seg = [s for s in url.split("/") if s][2:]        # after /doc/libraries
    if len(seg) <= 1:
        return "root"
    if seg[0] == "sdk":
        if "upgrade" in seg:
            return "upgrade-guide"
        if "methods" in seg:
            return "sdk-method"
        return "sdk-page"
    if "methods" in seg:
        return "lang-method"
    if "upgrade" in seg:
        return "upgrade-guide"
    return "other"


def load_libraries() -> list[dict]:
    if not QUEUE_PATH.exists():
        sys.exit("FATAL: work-queue.jsonl not found. Run fetch_router.py --build-queue first.")
    out = []
    for line in QUEUE_PATH.open(encoding="utf-8"):
        rec = json.loads(line)
        if rec["url"].startswith("/doc/libraries/"):
            out.append(rec)
    return sorted(out, key=lambda r: r["url"])


def method_key(url: str) -> str:
    """`/doc/libraries/{lang}/{ver}/methods/{group}/{method}` -> `{group}/{method}`."""
    seg = [s for s in url.split("/") if s]
    return "/".join(seg[seg.index("methods") + 1:]) if "methods" in seg else ""


def language_of(url: str) -> str:
    seg = [s for s in url.split("/") if s]
    return seg[2] if len(seg) > 2 else ""


def select() -> tuple[list[dict], dict, dict]:
    """The 24. Deterministic: sorted order and integer strides only. No RNG, no seed to lose."""
    lib = load_libraries()
    by_stratum: dict[str, list[dict]] = collections.defaultdict(list)
    for rec in lib:
        by_stratum[stratum(rec["url"])].append(rec)

    picked: list[dict] = []
    seen: set[str] = set()

    def take(pool: list[dict], n: int, label: str) -> None:
        if not pool or n <= 0:
            return
        step = max(1, len(pool) // n)
        for rec in itertools.islice((p for i, p in enumerate(pool) if i % step == 0), n):
            if rec["objectID"] in seen:
                continue
            seen.add(rec["objectID"])
            picked.append({**rec, "stratum": label})

    lang_methods = by_stratum["lang-method"]

    # 1. The cross-language block. Pick the method present in the most languages; break ties on the
    #    sorted key so the choice is reproducible by anyone. Then the first six languages, sorted.
    per_method: dict[str, list[dict]] = collections.defaultdict(list)
    for rec in lang_methods:
        per_method[method_key(rec["url"])].append(rec)
    target = max(sorted(per_method), key=lambda k: len({language_of(r["url"]) for r in per_method[k]}))
    cross = sorted(per_method[target], key=lambda r: language_of(r["url"]))
    chosen_lang: set[str] = set()
    for rec in cross:
        if len(chosen_lang) >= ALLOCATION["lang-method-crosslang"]:
            break
        lang = language_of(rec["url"])
        if lang in chosen_lang:
            continue
        chosen_lang.add(lang)
        seen.add(rec["objectID"])
        picked.append({**rec, "stratum": "lang-method-crosslang", "method_key": target})

    # 2. The spread: one page per LANGUAGE first, then one per method GROUP within that.
    #    Deduping on the (language, group) pair alone is not enough and the dry run proved it --
    #    it returned 5 csharp pages of 8, because csharp sorts first and appears in every group.
    #    Language is the outer key, so eight pages cannot pile into one SDK.
    rest = [r for r in lang_methods if r["objectID"] not in seen]
    by_lang: dict[str, list[dict]] = collections.defaultdict(list)
    for rec in rest:
        by_lang[language_of(rec["url"])].append(rec)
    spread, used_groups = [], set()
    for lang in itertools.cycle(sorted(by_lang)):
        if len(spread) >= ALLOCATION["lang-method-spread"]:
            break
        # LEAF method pages only (`{group}/{method}`), not the group index page (`{group}`).
        # Second dry-run catch: sorted order puts `/methods/abtesting` before
        # `/methods/abtesting/list-ab-tests`, so the spread was returning eight index pages while
        # leaf methods are 1,969 of the 2,082 -- it would have characterised 6% of the stratum and
        # missed the shape that 76% of the libraries population actually has.
        pool = [r for r in by_lang[lang] if len(method_key(r["url"]).split("/")) >= 2]
        pick = next((r for r in pool
                     if method_key(r["url"]).split("/")[0] not in used_groups
                     and r["objectID"] not in seen), None)
        if pick is None:                      # every group of this language already covered
            if all(len(by_lang[x]) == 0 or not any(
                    method_key(r["url"]).split("/")[0] not in used_groups for r in by_lang[x])
                   for x in by_lang):
                break                          # nothing left anywhere; do not spin
            continue
        used_groups.add(method_key(pick["url"]).split("/")[0])
        seen.add(pick["objectID"])
        spread.append(pick)
    for rec in spread:
        picked.append({**rec, "stratum": "lang-method-spread"})

    take(by_stratum["sdk-method"], ALLOCATION["sdk-method"], "sdk-method")
    take(by_stratum["sdk-page"], ALLOCATION["sdk-page"], "sdk-page")
    take(by_stratum["upgrade-guide"], ALLOCATION["upgrade-guide"], "upgrade-guide")
    take(by_stratum["root"], ALLOCATION["root"], "root")

    if len(picked) > CAP:
        sys.exit(f"FATAL: selection produced {len(picked)} pages, cap is {CAP}")

    population = {k: len(v) for k, v in sorted(by_stratum.items(), key=lambda kv: -len(kv[1]))}
    return picked, population, {"cross_language_method": target}


# ---------------------------------------------------------------------------

def print_plan(picked: list[dict], population: dict, meta: dict) -> None:
    total = sum(population.values())
    print(f"POPULATION — /doc/libraries/* in work-queue.jsonl: {total} records\n")
    for name, count in population.items():
        print(f"  {name:24s} {count:5d}  {100 * count / total:5.1f}%")
    # No silent caps: say what is deliberately not covered.
    print(f"\n  NOT COVERED by this probe: stratum 'other' "
          f"({population.get('other', 0)} records, "
          f"{100 * population.get('other', 0) / total:.1f}%) — /doc/libraries/{{lang}}/{{ver}}/"
          f"{{helpers,customize,...}}. Excluded to stay inside the 24-page cap.")

    print(f"\nSELECTION — {len(picked)} pages, {len(picked)} Scout credits. Deterministic "
          f"(sorted order + integer stride; no RNG).")
    print(f"Cross-language method under test: {meta['cross_language_method']!r}\n")
    by = collections.Counter(p["stratum"] for p in picked)
    for name, want in ALLOCATION.items():
        print(f"  {name:24s} planned {want:2d}  selected {by.get(name, 0):2d}")
    print()
    for n, rec in enumerate(picked, 1):
        print(f"  {n:2d}. [{rec['stratum']:22s}] {rec['url']}")
    print(f"\ncache target  : {PROBE_DIR}")
    print("route override: none. fetch_path_for() is not called; fetch_scout() is called direct.")


def run() -> int:
    picked, population, meta = select()
    print_plan(picked, population, meta)
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    key = scout_key()
    print(f"\nfetching {len(picked)} pages via Scout\n")
    ok = failed = 0
    for n, item in enumerate(picked, 1):
        absolute = absolute_url(item["url"])
        stem = item["objectID"].replace("/", "_")[:120]
        out = {
            "objectID": item["objectID"], "url": item["url"], "source_url": absolute,
            "fetch_path": "scout",
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "markdown": "", "content_hash": "", "http_status": 0,
            "truncated": False, "original_length": 0, "fetch_error": "",
            "probe": "shape-probe-libraries-24", "stratum": item["stratum"],
        }
        out.update({k: item.get(k, "") for k in
                    ("page_type", "family", "language_code", "source", "title", "description")})
        try:
            markdown, status = fetch_scout(absolute, key)
        except FetchFailed as exc:
            out["fetch_error"], out["http_status"] = exc.reason, exc.status
            (QUARANTINE_DIR / f"{stem}.json").write_text(
                json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
            failed += 1
            print(f"  {n:2d}/{len(picked)}  QUARANTINED  {exc.reason[:50]:50s} {item['url'][:50]}",
                  flush=True)
            continue
        markdown, truncated, original = truncate(markdown)
        out.update({"markdown": markdown,
                    "content_hash": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
                    "http_status": status, "truncated": truncated, "original_length": original})
        (PROBE_DIR / f"{stem}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        ok += 1
        print(f"  {n:2d}/{len(picked)}  ok  http {status}  {len(markdown):7d} chars  "
              f"{item['url'][:56]}", flush=True)
    print(f"\nfetched OK : {ok}/{len(picked)}")
    print(f"quarantined: {failed} (kept in {QUARANTINE_DIR}, not deleted)")
    return report()


def report() -> int:
    rows = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(PROBE_DIR.glob("*.json"))]
    quarantined = sorted(p.name for p in QUARANTINE_DIR.glob("*.json")) if QUARANTINE_DIR.exists() else []

    print("\n" + "=" * 78)
    print("PROVENANCE — asserted before any structural number is printed")
    print("=" * 78)
    try:
        prov = assert_scout_provenance(PROBE_DIR, {r["objectID"] for r in rows})
    except ProvenanceViolation as exc:
        print(f"FAIL — {len(exc.violations)} violation(s):")
        for v in exc.violations:
            print(f"  {v}")
        print("\nNo structural findings printed. A number from an unproven source is not evidence.")
        return 2
    print(f"PASS — {prov['pages']} bodies, every one fetch_path=scout, http 200, error-free,")
    print(f"       under {PROBE_DIR},")
    print("       hash-distinct from every cached doc-md-twin body.")

    twins = SP.twin_bodies({r["url"] for r in rows})
    findings = []
    for rec in rows:
        scout = SP.describe_body(rec["markdown"], rec.get("title", ""), rec.get("description", ""))
        twin_rec = twins.get(rec["url"])
        twin = SP.describe_body(twin_rec["markdown"], rec.get("title", ""), rec.get("description", "")) \
            if twin_rec else None
        findings.append({"url": rec["url"], "objectID": rec["objectID"],
                         "stratum": rec.get("stratum", "?"), "scout": scout, "twin": twin})

    print("\n" + "=" * 78)
    print("STRUCTURAL FINDINGS — Scout only. Twin column is DIAGNOSTIC, shown where cached.")
    print("=" * 78)
    hdr = (f"{'page':52s} {'chars':>6s} {'H1':>3s} {'desc':>4s} {'furn':>4s} "
           f"{'cand':>4s} {'cmt':>3s} {'clean':>5s} {'twin':>5s}")
    print(hdr)
    print("-" * len(hdr))
    for f in sorted(findings, key=lambda x: (x["stratum"], x["url"])):
        s = f["scout"]
        twin_clean = f["twin"]["clean_facts"] if f["twin"] else None
        print(f"{f['url'][:52]:52s} {s['chars']:6d} {'y' if s['has_h1'] else 'n':>3s} "
              f"{'y' if s['near_description_dupes'] or s['exact_description_dupes'] else 'n':>4s} "
              f"{s['furniture_candidates']:4d} {s['candidates']:4d} "
              f"{s['code_comment_candidates']:3d} {s['clean_facts']:5d} "
              f"{(str(twin_clean) if twin_clean is not None else '-'):>5s}")

    n = len(findings)
    print(f"\nTOTALS over {n} Scout libraries pages   (no count here estimates a population rate)")
    print(f"  has H1 (code blocks stripped)          : {sum(1 for f in findings if f['scout']['has_h1'])}/{n}")
    print(f"  Documentation Index furniture in pool  : {sum(1 for f in findings if f['scout']['furniture_candidates'])}/{n}")
    print(f"  exact description duplicate            : {sum(1 for f in findings if f['scout']['exact_description_dupes'])}/{n}")
    print(f"  near description duplicate (>=0.70)    : {sum(1 for f in findings if f['scout']['near_description_dupes'])}/{n}")
    print(f"  code comments in the usable pool       : {sum(f['scout']['code_comment_candidates'] for f in findings)} across {n} pages")
    print(f"  pages with >=1 CLEAN usable fact       : {sum(1 for f in findings if f['scout']['clean_facts'])}/{n}")
    print(f"  clean usable facts, total              : {sum(f['scout']['clean_facts'] for f in findings)}")
    print(f"  pages with ZERO clean usable facts     : {sum(1 for f in findings if not f['scout']['clean_facts'])}/{n}")
    chrome = collections.Counter(c for f in findings for c in f["scout"]["chrome"])
    print(f"  chrome markers                         : {dict(chrome) or 'none'}")
    tw = [f for f in findings if f["twin"]]
    if tw:
        print(f"  twin comparison available on           : {len(tw)}/{n} pages (DIAGNOSTIC)")
        print(f"    clean facts Scout vs twin            : "
              f"{sum(f['scout']['clean_facts'] for f in tw)} vs {sum(f['twin']['clean_facts'] for f in tw)}")

    cross = cross_language_report(rows)
    out = {"probe": "shape-probe-libraries-24",
           "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
           "provenance": prov, "quarantined": quarantined,
           "cross_language": cross, "pages": findings}
    FINDINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    FINDINGS_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nfindings: {FINDINGS_PATH}")
    if quarantined:
        print(f"quarantined (kept, excluded from every number above): {quarantined}")
    return 0


def cross_language_report(rows: list[dict]) -> dict:
    """The same method in N languages: how much of the prose is shared?

    This is the question no per-record gate can ask. If the bodies are near-identical, then so will
    the abstracts be, across ~2,082 records, and every one of them passes G7 individually.
    """
    group = [r for r in rows if r.get("stratum") == "lang-method-crosslang"]
    if len(group) < 2:
        return {"pages": len(group), "note": "not enough pages fetched to compare"}
    print("\n" + "=" * 78)
    print("CROSS-LANGUAGE DUPLICATION — same method, different SDK  (Scout bodies)")
    print("=" * 78)
    facts: dict[str, list[str]] = {}
    for r in group:
        d = SP.describe_body(r["markdown"], r.get("title", ""), r.get("description", ""))
        facts[language_of(r["url"])] = d["useful_examples"]
        print(f"  {language_of(r['url']):12s} {len(r['markdown']):6d} chars  "
              f"clean facts {d['clean_facts']:3d}   {r['url']}")
    pairs, scores = [], []
    langs = sorted(facts)
    for a, b in itertools.combinations(langs, 2):
        score = SP.overlap(" ".join(facts[a]), " ".join(facts[b]))
        pairs.append({"a": a, "b": b, "overlap": round(score, 3)})
        scores.append(score)
    if scores:
        scores.sort()
        median = scores[len(scores) // 2]
        print(f"\n  pairwise prose overlap over {len(scores)} language pairs: "
              f"min {min(scores):.2f}  median {median:.2f}  max {max(scores):.2f}")
        print(f"  pairs at or above {SP.NEAR_DUP_BAR}: "
              f"{sum(1 for s in scores if s >= SP.NEAR_DUP_BAR)}/{len(scores)}")
        return {"languages": langs, "pairs": pairs,
                "median_overlap": round(median, 3),
                "pairs_over_bar": sum(1 for s in scores if s >= SP.NEAR_DUP_BAR),
                "pair_count": len(scores)}
    return {"languages": langs, "pairs": pairs}


def main() -> int:
    ap = argparse.ArgumentParser(description="Scout shape probe, 24 /doc/libraries pages.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--plan", action="store_true")
    g.add_argument("--run", action="store_true")
    g.add_argument("--report", action="store_true")
    args = ap.parse_args()
    if args.plan:
        print_plan(*select())
        return 0
    if args.run:
        return run()
    return report()


if __name__ == "__main__":
    raise SystemExit(main())
