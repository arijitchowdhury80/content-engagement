#!/usr/bin/env python3
"""
WU-04 artifact generator — builds ia-map.json and sitemap-inventory.csv from the
WU-02 corpus. Derived artifacts are generated, never hand-authored, so a corpus
re-crawl regenerates them instead of silently going stale.

Run from docs/:  python3 20-research/build_ia_artifacts.py
"""

import collections
import csv
import json
import os

CORPUS = "50-prototype/corpus/records.jsonl"
OUT_DIR = "20-research"

# ---------------------------------------------------------------------------
# [13] Re-type the 57 records the URL-based classifier could not type.
# Read from their titles and paths; see the audit doc for the reasoning.
# ---------------------------------------------------------------------------
RETYPE_BY_SEGMENT = {
    "ecommerce-merchandising-playbook": "playbook",
    "distributed-secure": "trust",
    "master-list-for-code-exchnage": "code-exchange",   # sic — typo is in the live URL
    "awards": "trust",
    "blog-podcasts": "blog-hub",
    "customer-hub": "customer-hub",
    "oauth-result.html": "utility",
    "for-non-profit": "program",
    "for-open-source": "program",
    "mach-alliance": "partner",
    "professional-services-support": "services",
    "search-audit": "landing-page",
    "user-research": "utility",
    "value-signup": "landing-page",
}

# ---------------------------------------------------------------------------
# [15] intent + [16] page role, assigned per page-type cluster.
# Cluster-level assignment, then spot-checked against bodies — 2322 individual
# judgments would be noise, not signal.
# ---------------------------------------------------------------------------
INTENT_ROLE = {
    "homepage":              ("evaluate",     "conversion"),
    "product":               ("evaluate",     "conversion"),
    "product-hub":           ("evaluate",     "conversion"),
    "industry":              ("evaluate",     "conversion"),
    "solution":              ("evaluate",     "conversion"),
    "use-case":              ("evaluate",     "conversion"),
    "pricing":               ("buy",          "conversion"),
    "competitor-comparison": ("compare",      "conversion"),
    "contact-sales":         ("buy",          "conversion"),
    "landing-page":          ("evaluate",     "conversion"),
    "services":              ("evaluate",     "conversion"),
    "customer-story":        ("evaluate",     "trust-building"),
    "customer-story-hub":    ("evaluate",     "trust-building"),
    "press-release":         ("learn",        "trust-building"),
    "company":               ("learn",        "trust-building"),
    "careers":               ("apply",        "trust-building"),
    "trust":                 ("evaluate",     "trust-building"),
    "partner":               ("evaluate",     "trust-building"),
    "program":               ("apply",        "trust-building"),
    "blog-post":             ("learn",        "seo-acquisition"),
    "blog-hub":              ("learn",        "seo-acquisition"),
    "resource":              ("learn",        "seo-acquisition"),
    "resource-hub":          ("learn",        "seo-acquisition"),
    "webinar":               ("learn",        "seo-acquisition"),
    "event":                 ("learn",        "seo-acquisition"),
    "developer":             ("implement",    "enablement"),
    "developer-hub":         ("implement",    "enablement"),
    "code-exchange":         ("implement",    "enablement"),
    "playbook":              ("implement",    "enablement"),
    "customer-hub":          ("troubleshoot", "enablement"),
    "utility":               ("none",         "utility"),
    "search":               ("none",         "utility"),
}

# [17] The site's own search overlay exposes these 8 content sources. The nav
# exposes a different set. Reconciling the two is the unit's hard question.
SEARCH_SOURCES = [
    "Documentation", "Support", "Blog", "Website",
    "Developers", "Resources", "Academy", "Customer Stories",
]

# Destinations the 8 non-negotiable journeys need that are NOT on www and NOT in
# the corpus. Verified reachable 2026-08-05.
OFF_CORPUS_DESTINATIONS = {
    "https://dashboard.algolia.com/users/sign_in": {"journey": "Login", "status": 403},
    "https://www.algolia.com/doc": {"journey": "Developers/Docs", "status": 200,
                                    "note": "1885 URLs in /doc/sitemap.xml, absent from corpus"},
    "https://support.algolia.com/": {"journey": "Support", "status": 302},
    "https://academy.algolia.com": {"journey": "Resources (Academy)", "status": 302},
    "https://trust.algolia.com/": {"journey": "Trust", "status": 200},
    "https://changelog.algolia.com/": {"journey": "Product", "status": 200},
    "https://status.algolia.com/": {"journey": "Trust", "status": 200},
}


def retype(rec):
    """Return the corrected page_type for a record."""
    pt = rec["page_type"]
    if pt != "other":
        return pt
    seg = rec["url"].replace("https://www.algolia.com", "").strip("/").split("/")[0]
    return RETYPE_BY_SEGMENT.get(seg, "other")


def main():
    recs = [json.loads(l) for l in open(CORPUS, encoding="utf-8")]
    ok = [r for r in recs if r.get("fetch_ok")]

    rows = []
    for r in ok:
        pt = retype(r)
        intent, role = INTENT_ROLE.get(pt, ("unknown", "unknown"))
        rows.append({
            "url": r["url"],
            "page_type": pt,
            "intent": intent,
            "role": role,
            "cta": r["cta"]["text"],
            "cta_href": r["cta"]["href"],
            # Nearly everything is addressable and deep-linked. Utility pages are
            # the only genuine exception — see the audit doc's [17] resolution.
            "must_preserve": "true" if role != "utility" else "false",
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    inv = os.path.join(OUT_DIR, "sitemap-inventory.csv")
    with open(inv, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    type_counts = collections.Counter(x["page_type"] for x in rows)
    role_counts = collections.Counter(x["role"] for x in rows)
    intent_counts = collections.Counter(x["intent"] for x in rows)

    ia_map = {
        "generated_from": CORPUS,
        "record_count": len(rows),
        "note": "Generated by 20-research/build_ia_artifacts.py. Do not hand-edit.",
        "page_types": dict(type_counts.most_common()),
        "intents": dict(intent_counts.most_common()),
        "roles": dict(role_counts.most_common()),
        "intent_vocabulary": sorted({v[0] for v in INTENT_ROLE.values()}),
        "role_vocabulary": sorted({v[1] for v in INTENT_ROLE.values()}),
        "page_type_to_intent_role": {k: {"intent": v[0], "role": v[1]}
                                     for k, v in INTENT_ROLE.items()},
        "search_overlay_sources": SEARCH_SOURCES,
        "off_corpus_destinations": OFF_CORPUS_DESTINATIONS,
        "must_preserve_count": sum(1 for x in rows if x["must_preserve"] == "true"),
    }
    with open(os.path.join(OUT_DIR, "ia-map.json"), "w", encoding="utf-8") as fh:
        json.dump(ia_map, fh, indent=2, ensure_ascii=False)

    print(f"sitemap-inventory.csv: {len(rows)} rows")
    print(f"ia-map.json: {len(type_counts)} page types, "
          f"{ia_map['must_preserve_count']} must-preserve")
    print()
    print("roles:")
    for k, v in role_counts.most_common():
        print(f"  {k:18} {v:5}  {100*v/len(rows):5.1f}%")
    print()
    print("intents:")
    for k, v in intent_counts.most_common():
        print(f"  {k:18} {v:5}  {100*v/len(rows):5.1f}%")
    print()
    print(f"still 'other': {type_counts.get('other', 0)}")


if __name__ == "__main__":
    main()
