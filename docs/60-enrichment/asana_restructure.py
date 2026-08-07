#!/usr/bin/env python3
"""
Restructure the Asana project so numbering is single-scheme, ordered and grouped.

    python3 asana_restructure.py --dry-run      # prints the whole plan, writes nothing
    python3 asana_restructure.py --apply

WHAT IS WRONG TODAY
  * Two numbering schemes on every work unit: "P1 · WU-06 — Analytics analysis".
    The phase is redundant — WU-01..21 already run in phase order — and it is
    doing a job that Asana sections exist to do.
  * WU-22..26 were appended later but belong to P0/P1, so they sort to the
    bottom in the wrong place.
  * Subtasks carry a GLOBAL [NN] that has no relationship to their parent:
    WU-06 owns [6] and [64]-[75]; WU-12 owns [37]-[42] and [44]. Nothing about
    [44] tells you it belongs to WU-12, and the sequence had a hole at [43].

WHAT THIS DOES
  1. Creates one section per phase and moves each work unit into its section,
     in WU order. The phase now lives where grouping belongs.
  2. Renames work units to drop the redundant prefix: "WU-06 — Analytics analysis".
  3. Renumbers every subtask to WU-<parent>.<n>, ordered within its parent.
  4. Rewrites every cross-reference inside task notes to match, and sweeps the
     same references across the repo and the vault.

  Step 4 is the reason this is a script and not a hand edit: the numbers appear
  inside 112 hand-written task briefs. A rename that skips them silently breaks
  every "feeds [50] and [51]" pointer while appearing to succeed.

Only [NN] with pure digits is rewritten, so [ESCALATE TIER], [RA-1], [NEW],
[SUPERSEDED], [HIDDEN GATE] and [PRIORITY — ...] are never touched.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

API = "https://app.asana.com/api/1.0"
PROJECT = "1217199861767750"

PHASES = {
    "P0": "P0 — Foundation & governance",
    "P1": "P1 — Research & data",
    "P2": "P2 — Evidence & critique",
    "P3": "P3 — Models & governance",
    "P4": "P4 — Concept architecture",
    "P5": "P5 — Build",
    "P6": "P6 — Validation & comms",
}
DOC_SECTION = "Documentation"

# Subtasks are ordered by their old [NN], which reflects plan order and is right
# almost everywhere. WU-26 is the exception: its subtasks were created as work
# was discovered, so [NN] order is not execution order. Fixed explicitly.
SUBTASK_ORDER = {26: [87, 88, 43]}   # taxonomy -> deduplication -> liveness census

# An archive is a record of what was planned. Rewriting it destroys that record,
# so it keeps the original numbers and asana-number-map.json resolves them.
EXCLUDE_FILES = {"05-execution-plan.md"}

WU_RX = re.compile(r"WU-(\d+)")
PHASE_RX = re.compile(r"^(P\d)\s*·\s*")
NUM_RX = re.compile(r"^\[(\d{1,3})\]\s*")
REF_RX = re.compile(r"\[(\d{1,3})\]")


def api(method, path, payload=None, token=None):
    """curl, not urllib: TLS interception in this environment fails urllib with
    CERTIFICATE_VERIFY_FAILED."""
    cmd = ["curl", "-sS", "-X", method, f"{API}{path}",
           "-H", f"Authorization: Bearer {token}",
           "-H", "Content-Type: application/json"]
    if payload is not None:
        cmd += ["--data-binary", json.dumps({"data": payload})]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        out = json.loads(r.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"{method} {path}: {r.stdout[:300]}")
    if "errors" in out:
        raise RuntimeError(f"{method} {path}: {out['errors']}")
    return out.get("data")


def fetch_all(token):
    """Every task in the project, with its subtasks. Paginated, no sampling."""
    tasks, offset = [], None
    while True:
        q = f"/projects/{PROJECT}/tasks?limit=100&opt_fields=name,notes,parent,completed"
        if offset:
            q += f"&offset={offset}"
        cmd = ["curl", "-sS", f"{API}{q}", "-H", f"Authorization: Bearer {token}"]
        d = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)
        tasks += d["data"]
        offset = (d.get("next_page") or {}).get("offset")
        if not offset:
            break
    by_gid = {t["gid"]: t for t in tasks}
    for t in list(tasks):
        for s in api("GET", f"/tasks/{t['gid']}/subtasks?opt_fields=name,notes,parent,completed",
                     token=token) or []:
            s["parent"] = {"gid": t["gid"]}
            by_gid[s["gid"]] = s
    return by_gid


def build_plan(by_gid):
    """Returns (units, renames, mapping). Pure — touches nothing."""
    units = []
    for g, t in by_gid.items():
        if t.get("parent"):
            continue
        m = WU_RX.search(t["name"] or "")
        if not m:
            continue
        ph = PHASE_RX.match(t["name"])
        units.append({
            "gid": g,
            "wu": int(m.group(1)),
            "phase": ph.group(1) if ph else None,
            "old_name": t["name"],
            "new_name": PHASE_RX.sub("", t["name"]),
        })
    units.sort(key=lambda u: u["wu"])

    mapping, renames = {}, []
    for u in units:
        kids = [t for t in by_gid.values()
                if (t.get("parent") or {}).get("gid") == u["gid"] and NUM_RX.match(t["name"] or "")]
        order = SUBTASK_ORDER.get(u["wu"])
        if order:
            kids.sort(key=lambda t: order.index(int(NUM_RX.match(t["name"]).group(1)))
                      if int(NUM_RX.match(t["name"]).group(1)) in order else 999)
        else:
            kids.sort(key=lambda t: int(NUM_RX.match(t["name"]).group(1)))
        for i, k in enumerate(kids, 1):
            old = int(NUM_RX.match(k["name"]).group(1))
            new_label = f"WU-{u['wu']:02d}.{i}"
            mapping[old] = new_label
            renames.append({
                "gid": k["gid"],
                "old": k["name"],
                "new": f"{new_label} — {NUM_RX.sub('', k['name'])}",
            })
    return units, renames, mapping


def rewrite_refs(text, mapping):
    if not text:
        return text, 0
    n = 0

    def sub(m):
        nonlocal n
        v = int(m.group(1))
        if v in mapping:
            n += 1
            return f"[{mapping[v]}]"
        return m.group(0)

    return REF_RX.sub(sub, text), n


def sweep_files(mapping, roots, apply=False, log=print):
    """Same rewrite across repo + vault markdown, so Asana and the docs agree."""
    changed = []
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in
                           (".git", "node_modules", "__pycache__", ".obsidian")]
            for fn in filenames:
                if not fn.endswith(".md") or fn in EXCLUDE_FILES:
                    continue
                p = os.path.join(dirpath, fn)
                try:
                    s = open(p, encoding="utf-8").read()
                except (UnicodeDecodeError, OSError):
                    continue
                new, n = rewrite_refs(s, mapping)
                if n:
                    changed.append((p, n))
                    if apply:
                        open(p, "w", encoding="utf-8").write(new)
    for p, n in changed:
        log(f"    {n:3d} refs  {p}")
    log(f"  files touched: {len(changed)}  refs rewritten: {sum(n for _, n in changed)}")
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--skip-files", action="store_true")
    args = ap.parse_args()
    apply = args.apply
    token = os.environ["ASANA_PAT"]

    who = api("GET", "/users/me", token=token)
    print(f"authenticated as {who['name']} ({who['gid']})")

    print("\nfetching every task and subtask (no sampling)...")
    by_gid = fetch_all(token)
    print(f"  {len(by_gid)} tasks")

    units, renames, mapping = build_plan(by_gid)

    print(f"\n=== 1. SECTIONS — {len(PHASES)} phases + {DOC_SECTION} ===")
    for ph, name in sorted(PHASES.items()):
        members = [u for u in units if u["phase"] == ph]
        print(f"  {name:34s} <- {', '.join('WU-%02d' % u['wu'] for u in members) or '(none)'}")

    print(f"\n=== 2. WORK UNITS — drop the redundant phase prefix ({len(units)}) ===")
    for u in units:
        if u["old_name"] != u["new_name"]:
            print(f"  {u['old_name'][:58]:60s} -> {u['new_name'][:58]}")

    print(f"\n=== 3. SUBTASKS — global [NN] becomes WU-<parent>.<n> ({len(renames)}) ===")
    for r in renames:
        print(f"  {r['old'][:52]:54s} -> {r['new'][:52]}")

    print("\n=== 4. CROSS-REFERENCES INSIDE TASK NOTES ===")
    note_edits = []
    for g, t in by_gid.items():
        new, n = rewrite_refs(t.get("notes"), mapping)
        if n:
            note_edits.append((g, t["name"], new, n))
    print(f"  notes to rewrite: {len(note_edits)}  "
          f"refs: {sum(x[3] for x in note_edits)}  "
          f"chars: {sum(len(x[2]) for x in note_edits):,}")

    print("\n=== 5. SAME REFERENCES IN THE REPO AND VAULT ===")
    roots = [] if args.skip_files else [
        os.path.expanduser("~/Dropbox/AI-Development/algolia-com/docs"),
        os.path.expanduser("~/Dropbox/AI-Development/algolia-com/SESSION.md"),
        os.path.expanduser("~/Dropbox/AI-Development/Obsidian/Arijit-Second-Brain/"
                           "Projects/Search-First-Algolia-com"),
    ]
    roots = [r for r in roots if os.path.isdir(r)]
    sweep_files(mapping, roots, apply=False)

    mapfile = os.path.expanduser("~/Dropbox/AI-Development/algolia-com/"
                                 "docs/60-enrichment/asana-number-map.json")
    print(f"\n=== 6. RESOLVER — old [NN] -> new label, for the excluded archive ===")
    print(f"  {sorted(EXCLUDE_FILES)} keeps its original numbers by design")
    print(f"  map -> {mapfile}")

    if not apply:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        return

    json.dump({"generated": time.strftime("%Y-%m-%d"),
               "scheme": "global [NN] replaced by WU-<parent>.<n>",
               "excluded_from_sweep": sorted(EXCLUDE_FILES),
               "map": {str(k): v for k, v in sorted(mapping.items())}},
              open(mapfile, "w"), indent=2)

    print("\n--- APPLYING ---")
    existing = {s["name"]: s["gid"] for s in
                api("GET", f"/projects/{PROJECT}/sections", token=token)}
    section_gid = {}
    for ph, name in sorted(PHASES.items()):
        section_gid[ph] = existing.get(name) or api(
            "POST", f"/projects/{PROJECT}/sections", {"name": name}, token)["gid"]
        print(f"  section {name}")
    doc_gid = existing.get(DOC_SECTION) or api(
        "POST", f"/projects/{PROJECT}/sections", {"name": DOC_SECTION}, token)["gid"]

    for u in units:
        if u["phase"] and u["phase"] in section_gid:
            api("POST", f"/sections/{section_gid[u['phase']]}/addTask",
                {"task": u["gid"]}, token)
        if u["old_name"] != u["new_name"]:
            api("PUT", f"/tasks/{u['gid']}", {"name": u["new_name"]}, token)
    print(f"  {len(units)} work units sectioned and renamed")

    for g, t in by_gid.items():
        if not t.get("parent") and t["name"] in ("Create Project Documentation",):
            api("POST", f"/sections/{doc_gid}/addTask", {"task": g}, token)

    for i, r in enumerate(renames, 1):
        api("PUT", f"/tasks/{r['gid']}", {"name": r["new"]}, token)
        if i % 20 == 0:
            print(f"  subtasks renamed: {i}/{len(renames)}")
    print(f"  subtasks renamed: {len(renames)}/{len(renames)}")

    for i, (g, name, new_notes, n) in enumerate(note_edits, 1):
        api("PUT", f"/tasks/{g}", {"notes": new_notes}, token)
        if i % 20 == 0:
            print(f"  notes rewritten: {i}/{len(note_edits)}")
    print(f"  notes rewritten: {len(note_edits)}/{len(note_edits)}")

    if roots:
        print("  sweeping repo + vault files")
        sweep_files(mapping, roots, apply=True)

    print("\n--- VERIFY (re-read from Asana, not from what we just sent) ---")
    after = fetch_all(token)
    stale_names = [t["name"] for t in after.values() if NUM_RX.match(t["name"] or "")]
    stale_prefix = [t["name"] for t in after.values() if PHASE_RX.match(t["name"] or "")]
    stale_notes = sum(1 for t in after.values()
                      if any(int(x) in mapping for x in REF_RX.findall(t.get("notes") or "")))
    print(f"  subtasks still on the old [NN] scheme : {len(stale_names)}")
    print(f"  work units still carrying 'P· '       : {len(stale_prefix)}")
    print(f"  notes still holding a stale reference : {stale_notes}")
    secs = api("GET", f"/projects/{PROJECT}/sections", token=token)
    print(f"  sections now: {[s['name'] for s in secs]}")
    ok = not stale_names and not stale_prefix and not stale_notes
    print("\n  PASS" if ok else "\n  FAIL — see counts above")
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
