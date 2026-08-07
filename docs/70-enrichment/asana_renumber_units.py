#!/usr/bin/env python3
"""
Renumber the work units so the number IS the position.

    python3 asana_renumber_units.py --dry-run
    python3 asana_renumber_units.py --apply

THE PROBLEM
WU-22..26 were added after the original 21 were numbered, so their numbers sort
them to the bottom while they actually belong in P0 and P1:

    P0  WU-01, WU-23, WU-24, WU-25
    P1  WU-02..06, WU-22, WU-26      <- WU-26 sits in P1, WU-10 sits in P2
    P2  WU-07..10

Putting phases into sections fixed the grouping but left this untouched. The
number still has to agree with the order, or the list reads as noise.

AFTER
    P0  WU-01..04      P4  WU-19
    P1  WU-05..11      P5  WU-20..24
    P2  WU-12..15      P6  WU-25..26
    P3  WU-16..18

Within a phase the existing relative order is preserved, so nothing is
reshuffled beyond what the phase demands.

BLAST RADIUS — all of it handled here, in one pass
  * 26 Asana work-unit names
  * every subtask name (WU-<old>.<n> -> WU-<new>.<n>)
  * every "WU-NN" inside task notes
  * every "WU-NN" in the repo and vault markdown
  * the brief FILENAMES, docs/briefs/WU-NN.md, via a two-phase git mv so a
    rename never collides with a file that still holds the target name

SAFETY
Substitution is a SINGLE PASS with a callback, never sequential replaces.
Sequential would double-apply: 04->07 and then that same 07->12.
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
REPO = os.path.expanduser("~/Dropbox/AI-Development/algolia-com")
VAULT = os.path.expanduser("~/Dropbox/AI-Development/Obsidian/Arijit-Second-Brain/"
                           "Projects/Search-First-Algolia-com")

# phase -> work units in the order they should carry, oldest-first within phase
PHASE_ORDER = {
    "P0 — Foundation & governance": [1, 23, 24, 25],
    "P1 — Research & data":         [2, 3, 4, 5, 6, 22, 26],
    "P2 — Evidence & critique":     [7, 8, 9, 10],
    "P3 — Models & governance":     [11, 12, 13],
    "P4 — Concept architecture":    [14],
    "P5 — Build":                   [15, 16, 17, 18, 19],
    "P6 — Validation & comms":      [20, 21],
}

WU_RX = re.compile(r"WU-(\d{1,2})")
NAME_RX = re.compile(r"^WU-(\d{1,2})(\.(\d+))?\s+—\s*(.*)$", re.S)


def build_map():
    """old WU number -> new WU number. Position is derived, never hand-typed."""
    m, n = {}, 0
    for phase in sorted(PHASE_ORDER):
        for old in PHASE_ORDER[phase]:
            n += 1
            m[old] = n
    return m


def remap(text, m):
    """Single pass. Sequential replaces would double-apply."""
    if not text:
        return text, 0
    hits = 0

    def sub(match):
        nonlocal hits
        old = int(match.group(1))
        if old in m and m[old] != old:
            hits += 1
        return f"WU-{m.get(old, old):02d}" if old in m else match.group(0)

    return WU_RX.sub(sub, text), hits


def api(method, path, payload=None, token=None, tries=4):
    import tempfile
    last = None
    for attempt in range(tries):
        cmd = ["curl", "-sS", "-X", method, f"{API}{path}",
               "-H", f"Authorization: Bearer {token}",
               "-H", "Content-Type: application/json", "-w", "\n%{http_code}"]
        tmp = None
        if payload is not None:
            fd, tmp = tempfile.mkstemp(suffix=".json")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"data": payload}, f, ensure_ascii=False)
            cmd += ["--data-binary", "@" + tmp]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True)
        finally:
            if tmp:
                os.unlink(tmp)
        body, _, code = r.stdout.rpartition("\n")
        if code.strip() == "429":
            time.sleep(2 * (attempt + 1))
            continue
        try:
            out = json.loads(body)
        except json.JSONDecodeError:
            last = f"HTTP {code.strip()} {body[:150]!r}"
            time.sleep(1 + attempt)
            continue
        if "errors" in out:
            raise RuntimeError(f"{method} {path}: {out['errors']}")
        return out.get("data")
    raise RuntimeError(f"{method} {path}: {last}")


def fetch_all(token):
    tasks, offset = [], None
    while True:
        q = (f"/projects/{PROJECT}/tasks?limit=100"
             f"&opt_fields=name,notes,parent,completed")
        if offset:
            q += f"&offset={offset}"
        d = json.loads(subprocess.run(
            ["curl", "-sS", f"{API}{q}", "-H", f"Authorization: Bearer {token}"],
            capture_output=True, text=True).stdout)
        tasks += d["data"]
        offset = (d.get("next_page") or {}).get("offset")
        if not offset:
            break
    by = {t["gid"]: t for t in tasks}
    for t in list(tasks):
        for s in api("GET", f"/tasks/{t['gid']}/subtasks"
                            f"?opt_fields=name,notes,parent,completed", token=token) or []:
            s["parent"] = {"gid": t["gid"]}
            by[s["gid"]] = s
    return by


def md_files():
    out = []
    for root in (os.path.join(REPO, "docs"), VAULT):
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in (".git", "node_modules",
                                                "__pycache__", ".obsidian")]
            out += [os.path.join(dp, f) for f in fn if f.endswith(".md")]
    out += [os.path.join(REPO, "SESSION.md"), os.path.join(REPO, "CLAUDE.md")]
    return [p for p in out if os.path.isfile(p)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    token = os.environ["ASANA_PAT"]
    m = build_map()

    print("=== WORK UNIT RENUMBER — number now equals position ===")
    n = 0
    for phase in sorted(PHASE_ORDER):
        news = [f"WU-{m[o]:02d}" for o in PHASE_ORDER[phase]]
        olds = [f"WU-{o:02d}" for o in PHASE_ORDER[phase]]
        print(f"  {phase:32s} {news[0]}..{news[-1]}")
        for o, nw in zip(olds, news):
            if o != nw:
                n += 1
                print(f"      {o} -> {nw}")
    print(f"  {n} of {len(m)} work units change number")

    by = fetch_all(token)
    task_edits = []
    for g, t in by.items():
        nn, h1 = remap(t["name"], m)
        no, h2 = remap(t.get("notes"), m)
        if h1 or h2:
            task_edits.append((g, t["name"], nn, no, h1 + h2))
    print(f"\n=== ASANA === {len(task_edits)} tasks change name and/or notes")

    file_edits, renames = [], []
    for p in md_files():
        s = open(p, encoding="utf-8").read()
        new, h = remap(s, m)
        if h:
            file_edits.append((p, new, h))
        b = os.path.basename(p)
        mm = re.match(r"^WU-(\d{2})\.md$", b)
        if mm and m.get(int(mm.group(1))) != int(mm.group(1)):
            renames.append((p, os.path.join(os.path.dirname(p),
                                            f"WU-{m[int(mm.group(1))]:02d}.md")))
    print(f"=== FILES === {len(file_edits)} markdown files, "
          f"{sum(h for _, _, h in file_edits)} refs")
    print(f"=== BRIEF RENAMES === {len(renames)}")
    for a, b in renames:
        print(f"      {os.path.basename(a)} -> {os.path.basename(b)}")

    if not args.apply:
        print("\nDRY RUN — nothing written.")
        return

    print("\n--- APPLYING ---")
    for i, (g, old, nn, no, _) in enumerate(task_edits, 1):
        payload = {}
        if nn != old:
            payload["name"] = nn
        if no is not None and no != by[g].get("notes"):
            payload["notes"] = no
        if payload:
            api("PUT", f"/tasks/{g}", payload, token)
        if i % 25 == 0:
            print(f"  asana: {i}/{len(task_edits)}")
    print(f"  asana: {len(task_edits)}/{len(task_edits)}")

    for p, new, _ in file_edits:
        open(p, "w", encoding="utf-8").write(new)
    print(f"  files rewritten: {len(file_edits)}")

    # two phase, so WU-04 -> WU-07 cannot collide with a WU-07 that still exists
    for a, _ in renames:
        subprocess.run(["git", "mv", a, a + ".tmpmv"], cwd=REPO, check=True)
    for a, b in renames:
        subprocess.run(["git", "mv", a + ".tmpmv", b], cwd=REPO, check=True)
    print(f"  briefs renamed: {len(renames)}")

    json.dump({"generated": time.strftime("%Y-%m-%d"),
               "note": "work-unit renumber so number == phase position",
               "old_to_new": {f"WU-{k:02d}": f"WU-{v:02d}" for k, v in sorted(m.items())}},
              open(os.path.join(REPO, "docs/70-enrichment/wu-renumber-map.json"), "w"),
              indent=2)

    print("\n--- VERIFY (re-read from Asana) ---")
    after = fetch_all(token)
    secs = api("GET", f"/projects/{PROJECT}/sections?opt_fields=name", token=token)
    ok = True
    seen = []
    for s in secs:
        ts = api("GET", f"/sections/{s['gid']}/tasks?opt_fields=name", token=token) or []
        nums = sorted(int(WU_RX.search(t["name"]).group(1))
                      for t in ts if WU_RX.search(t["name"] or ""))
        if nums:
            contiguous = nums == list(range(nums[0], nums[0] + len(nums)))
            after_prev = not seen or nums[0] == seen[-1] + 1
            print(f"  {s['name']:32s} WU-{nums[0]:02d}..WU-{nums[-1]:02d}  "
                  f"{'OK' if contiguous and after_prev else 'BROKEN'}")
            ok &= contiguous and after_prev
            seen += nums
    print(f"\n  {'PASS' if ok else 'FAIL'} — sections hold contiguous, ascending WU numbers")
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
