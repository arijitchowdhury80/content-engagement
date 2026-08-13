#!/usr/bin/env python3
"""
Generic schema-driven taxonomy classifier.

Contains NO Algolia-specific and no algolia.com-specific logic. Everything it
knows comes from the schema JSON. Pointing it at a new corpus means writing a
new schema, not editing this file.

    python3 classify.py --schema <schema.json> --records <records.jsonl> \
                        --out <assignments.jsonl> --candidates <candidates.jsonl>

CONTRACT
  * Every record gets a page_type. No exceptions. A record whose URL matches no
    rule is a SCHEMA BUG, not a bad record — the run HARD-FAILS and names it.
  * Every axis that APPLIES to a record gets a value or the literal "unknown".
  * An axis that does NOT apply is omitted entirely — never "unknown", never
    null, never the string "null". Omission is the datastore's native "no" and
    is what keeps facet counts honest.
  * Tag axes are ORDERED arrays. Element 0 is the primary, by contract:
    URL-derived first, then legacy-field, then text matches by descending
    evidence.
  * A value captured or matched but absent from the vocabulary is never
    invented into the record. It is harvested to the candidate queue, which is
    the schema's improvement backlog.
"""

import argparse
import collections
import json
import re
import sys

# --- provenance ranks; lower sorts earlier, so element 0 is the strongest -----
PROV_RANK = {"url-path": 0, "legacy-field": 1, "locale-twin": 2, "text-match": 3}
CONFIDENCE = {"url-path": "high", "legacy-field": "high", "locale-twin": "medium", "text-match": "low"}


class Classifier:
    def __init__(self, schema):
        self.s = schema
        self.axes = {a["name"]: a for a in schema["axes"]}
        self.tag_axes = [a["name"] for a in schema["axes"] if a["type"] == "array"]
        self.vocab = schema["vocabularies"]
        self.capture_aliases = schema.get("capture_aliases", {})
        self.rules = [(r, re.compile(r["path"])) for r in schema["url_rules"]]
        self.field_rules = schema.get("field_rules", [])
        self.list_field_rules = schema.get("list_field_rules", [])
        tm = schema["text_matching"]
        self.text_fields = tm["fields"]
        self.generic = set(tm["generic_terms_url_only"])
        self.min_evidence = tm["min_evidence"]
        self.blocklist = {k: set(v) for k, v in tm.get("blocklist", {}).items()}
        # Values that may be assigned from a URL path or authored field, but
        # never from free text — see URL_OR_FIELD_ONLY in the schema generator.
        self.url_or_field_only = {k: set(v) for k, v in tm.get("url_or_field_only", {}).items()}
        self.version = schema["version"]
        self.candidates = collections.Counter()
        self._build_text_patterns()

    # -- text patterns -------------------------------------------------------
    def _build_text_patterns(self):
        """alias -> (axis, slug). Generic aliases are excluded from text entirely."""
        self.text_pat = {}
        for axis in self.tag_axes:
            for slug, meta in self.vocab.get(axis, {}).items():
                terms = [slug.replace("-", " ")] + list(meta.get("aliases", []))
                for t in terms:
                    t = t.strip().lower()
                    # A generic term ("search", "api") matches only from a URL
                    # path or a legacy field. Measured: "search" alone appears
                    # in 47.9% of records and would breach the >40% gate.
                    if not t or t in self.generic:
                        continue
                    self.text_pat.setdefault(t, set()).add((axis, slug))
        self.text_rx = {
            t: re.compile(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])")
            for t in self.text_pat
        }

    # -- url -----------------------------------------------------------------
    @staticmethod
    def split_url(url, default_host):
        u = str(url).strip()
        if u.startswith("http"):
            host = u.split("/")[2]
            path = "/" + "/".join(u.split("/")[3:])
        else:
            host, path = default_host, u
        path = path.split("?")[0].split("#")[0]
        path = re.sub(r"^/(en|fr|de)(/|$)", "/", path)
        if not path.startswith("/"):
            path = "/" + path
        return host, path

    def resolve(self, axis, raw):
        """Raw captured string -> canonical slug, or None if it must be dropped."""
        alias = self.capture_aliases.get(axis, {})
        for key in (raw, str(raw).lower()):
            if key in alias:
                return alias[key]          # may legitimately be None = drop
            if key in self.vocab.get(axis, {}):
                return key
        self.candidates[(axis, str(raw))] += 1
        return None

    def match_url(self, host, path):
        for rule, rx in self.rules:
            if rule["host"] != host:
                continue
            m = rx.match(path) if rule["path"] == ".*" else rx.search(path)
            if m:
                return rule, m
        return None, None

    # -- one record ----------------------------------------------------------
    def classify(self, rec, default_host):
        host, path = self.split_url(rec.get("url", ""), default_host)
        rule, m = self.match_url(host, path)
        if rule is None:
            # Not a bad record — a missing rule. Surfaced, never swallowed.
            raise Unclassifiable(f"no url_rule matched host={host} path={path}")

        page_type = rule["page_type"]
        # axis -> {slug: provenance}
        hits = collections.defaultdict(dict)

        def add(axis, slug, prov):
            if slug is None or axis not in self.tag_axes:
                return
            if slug in self.blocklist.get(axis, ()):    # R5 escape hatch
                return
            cur = hits[axis].get(slug)
            if cur is None or PROV_RANK[prov] < PROV_RANK[cur]:
                hits[axis][slug] = prov

        # 1. URL captures + static assignments on the matched rule
        for axis, raw in (m.groupdict() or {}).items():
            if raw:
                add(axis, self.resolve(axis, raw), "url-path")
        for axis in self.tag_axes:
            for slug in (rule.get(axis) or []):
                add(axis, slug, "url-path")

        # 2. Legacy fields. Support's `category` is a real 26-value vocabulary
        #    and ranks alongside a URL path, not alongside free text.
        for fr in self.field_rules:
            if rec.get("source") != fr["when_source"]:
                continue
            mapped = fr["map"].get(str(rec.get(fr["field"]) or ""))
            if not mapped:
                continue
            for axis, slugs in mapped.items():
                if axis == "page_type_hint":
                    continue
                for slug in slugs:
                    add(axis, slug, "legacy-field")

        # 2b. Authored list fields (tags / keywords). Populated on 97-100% of
        #     Blog and 56-84% of Developers/Website — precisely where URL paths
        #     say nothing. Curated map, not a blanket alias sweep: only 15.9% of
        #     these values are product vocabulary, the rest editorial labels.
        for lfr in self.list_field_rules:
            vals = []
            for f in lfr["fields"]:
                v = rec.get(f)
                if isinstance(v, list):
                    vals += [str(x).strip().lower() for x in v]
            for v in vals:
                for axis, slugs in (lfr["map"].get(v) or {}).items():
                    for slug in slugs:
                        add(axis, slug, "legacy-field")

        # 3. Text fallback, closed-vocabulary only
        text = " ".join(str(rec.get(f) or "") for f in self.text_fields).lower()
        if text.strip():
            ev = collections.Counter()
            for term, rx in self.text_rx.items():
                if rx.search(text):
                    for axis, slug in self.text_pat[term]:
                        ev[(axis, slug)] += 1
            for (axis, slug), n in ev.items():
                # Abstain unless there is enough evidence. Deliberately trading
                # coverage for precision is the only way an unknown-unknown
                # becomes a known-unknown.
                if slug in self.url_or_field_only.get(axis, ()):
                    continue
                if n >= self.min_evidence and slug not in hits[axis]:
                    add(axis, slug, "text-match")

        return self._emit(rec, page_type, hits)

    def _emit(self, rec, page_type, hits):
        out = {"url": rec.get("url"), "page_type": page_type,
               "taxonomy_version": self.version,
               "taxonomy_provenance": {"page_type": "url-path"},
               "taxonomy_confidence": {"page_type": "high"}}
        for axis in self.tag_axes:
            state = self._applicability(axis, page_type)
            if state == "none":
                continue                       # the axis is meaningless here
            got = hits.get(axis) or {}
            if not got:
                # required -> an unresolved value is a real, measurable gap.
                # opportunistic -> absence is the correct answer, so omit.
                if state == "required":
                    out[axis] = ["unknown"]
                    out["taxonomy_provenance"][axis] = "unknown"
                    out["taxonomy_confidence"][axis] = "low"
                continue
            ordered = sorted(got.items(), key=lambda kv: (PROV_RANK[kv[1]], kv[0]))
            out[axis] = [s for s, _ in ordered]
            out["taxonomy_provenance"][axis] = ordered[0][1]
            out["taxonomy_confidence"][axis] = CONFIDENCE[ordered[0][1]]
        return out

    def _applicability(self, axis, page_type):
        a = self.axes[axis]
        req = a.get("required_on", [])
        if "*" in req or page_type in req:
            return "required"
        if page_type in a.get("opportunistic_on", []):
            return "opportunistic"
        return "none"


class Unclassifiable(Exception):
    pass


def locale_propagate(rows, log):
    """A /fr/ or /de/ page inherits any axis its English twin resolved.

    URL rules already strip the locale prefix, so structural axes resolve
    natively. This only fills axes that fell to "unknown" because the French or
    German TEXT could not match an English vocabulary.
    """
    by_url = {r["url"]: r for r in rows}

    def canon(u):
        u = str(u)
        return re.sub(r"^(https://[^/]+)?/(fr|de)/", lambda mm: (mm.group(1) or "") + "/", u)

    filled = orphans = 0
    for r in rows:
        twin_url = canon(r["url"])
        if twin_url == r["url"]:
            continue
        twin = by_url.get(twin_url)
        if twin is None:
            orphans += 1
            continue
        for axis, val in list(r.items()):
            if not isinstance(val, list) or val != ["unknown"]:
                continue
            tv = twin.get(axis)
            if isinstance(tv, list) and tv and tv != ["unknown"]:
                r[axis] = list(tv)
                r["taxonomy_provenance"][axis] = "locale-twin"
                r["taxonomy_confidence"][axis] = "medium"
                filled += 1
    log(f"  locale propagation: filled {filled} axis values | {orphans} non-EN urls with no twin")
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", required=True)
    ap.add_argument("--records", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--default-host", default="www.algolia.com")
    args = ap.parse_args()

    schema = json.load(open(args.schema, encoding="utf-8"))
    clf = Classifier(schema)
    recs = [json.loads(l) for l in open(args.records, encoding="utf-8")]

    # Distinct URL is the unit of work; the writer fans results back out to
    # every objectID sharing that URL.
    seen, unique = set(), []
    for r in recs:
        u = str(r.get("url", "")).strip()
        if u not in seen:
            seen.add(u)
            unique.append(r)

    rows, failures = [], []
    for r in unique:
        try:
            rows.append(clf.classify(r, args.default_host))
        except Unclassifiable as e:
            failures.append({"url": r.get("url"), "reason": str(e)})

    print(f"records {len(recs)} -> distinct urls {len(unique)}")

    if failures:
        # There is no such thing as an unclassifiable record — only a missing
        # rule. Stop, name the gap, write no output.
        print(f"\nHARD FAIL — {len(failures)} url(s) matched no rule. Fix the schema, do not skip them.")
        for f in failures[:25]:
            print(f"   {f['url']}  ({f['reason']})")
        sys.exit(2)

    locale_propagate(rows, print)

    with open(args.out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(args.candidates, "w", encoding="utf-8") as f:
        for (axis, val), n in clf.candidates.most_common():
            f.write(json.dumps({"axis": axis, "value": val, "records": n}) + "\n")

    print(f"wrote {args.out} ({len(rows)} rows)")
    print(f"wrote {args.candidates} ({len(clf.candidates)} unmatched values — the schema's backlog)")


if __name__ == "__main__":
    main()
