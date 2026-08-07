#!/usr/bin/env python3
"""
Check that every disk path an Asana task names actually exists.

    ASANA_PAT=... python3 docs/70-enrichment/check_artifact_links.py

Asana is the status SSOT and the repo holds the artifacts. Nothing keeps those
two in step on its own: a file gets renamed or deleted and the task that cites
it goes on pointing at nothing, silently. This is the check that makes the drift
visible.

It classifies rather than just counting, because a missing path is not
automatically a fault:

  OWED      the task has not run yet, so its output is correctly absent
  DEAD      the task is SUPERSEDED and its artifacts were deliberately deleted
  BROKEN    the task is live and its artifact is gone — a real defect

Exit code is non-zero only on BROKEN.
"""

import collections
import json
import os
import re
import subprocess
import sys

API = "https://app.asana.com/api/1.0"
PROJECT = "1217199861767750"
REPO = os.path.expanduser("~/Dropbox/AI-Development/algolia-com")
PATH_RX = re.compile(r"docs/[A-Za-z0-9_./\-]+\.[a-z]{2,5}")

# A literal placeholder in prose, never a real file.
PLACEHOLDERS = {"docs/briefs/WU-NN.md"}


def api_get(path, token):
    r = subprocess.run(["curl", "-sS", f"{API}{path}",
                        "-H", f"Authorization: Bearer {token}"],
                       capture_output=True, text=True)
    return json.loads(r.stdout).get("data")


def fetch_all(token):
    """Every task at every depth.

    Recursion matters: the documentation tree is Create Project Documentation ->
    Enrichment documentation -> Chapter N -> 1.1..1.8, which is three levels
    down. A one-level walk silently skips 13 tasks and then reports a clean
    bill of health for tasks it never looked at.
    """
    tasks, offset = [], None
    while True:
        q = f"/projects/{PROJECT}/tasks?limit=100&opt_fields=name,notes,completed"
        if offset:
            q += f"&offset={offset}"
        d = json.loads(subprocess.run(
            ["curl", "-sS", f"{API}{q}", "-H", f"Authorization: Bearer {token}"],
            capture_output=True, text=True).stdout)
        tasks += d["data"]
        offset = (d.get("next_page") or {}).get("offset")
        if not offset:
            break

    out = {t["gid"]: t for t in tasks}

    def walk(gid):
        for s in api_get(f"/tasks/{gid}/subtasks"
                         f"?opt_fields=name,notes,completed", token) or []:
            if s["gid"] not in out:
                out[s["gid"]] = s
                walk(s["gid"])

    for t in tasks:
        walk(t["gid"])
    return out


def main():
    token = os.environ["ASANA_PAT"]
    os.chdir(REPO)
    tasks = fetch_all(token)

    refs = collections.defaultdict(list)
    for t in tasks.values():
        blob = (t.get("notes") or "") + " " + (t.get("name") or "")
        superseded = "SUPERSEDED" in (t.get("name") or "") or \
                     "ARTIFACTS DELETED" in (t.get("notes") or "")
        for p in PATH_RX.findall(blob):
            refs[p.rstrip(".")].append((t["name"], superseded))

    ok = owed = dead = 0
    broken = []
    for p, citers in sorted(refs.items()):
        if p in PLACEHOLDERS:
            continue
        if os.path.exists(p):
            ok += 1
        elif all(s for _, s in citers):
            dead += 1
        elif any(t.get("completed") for t in tasks.values()
                 if t["name"] in {c for c, _ in citers}):
            broken.append((p, citers))       # a COMPLETED task cites a missing file
        else:
            owed += 1

    print(f"paths cited by Asana : {len(refs)}")
    print(f"  exist on disk      : {ok}")
    print(f"  owed (task not run): {owed}")
    print(f"  dead (superseded)  : {dead}")
    print(f"  BROKEN             : {len(broken)}")
    for p, citers in broken:
        print(f"\n  BROKEN {p}")
        for c, _ in citers:
            print(f"         cited by COMPLETED task: {c[:70]}")
    if broken:
        print("\nA completed task naming a file that does not exist means the artifact was "
              "renamed or deleted without updating the task. Fix one or the other.")
    sys.exit(1 if broken else 0)


if __name__ == "__main__":
    main()
