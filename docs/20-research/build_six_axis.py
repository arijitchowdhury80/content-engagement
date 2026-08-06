#!/usr/bin/env python3
"""
WU-05 — six-axis classification, generator.

Reads the WU-02 corpus + WU-04 inventory, emits:
  20-research/six-axis-classification.jsonl   one row per URL, all six axes
  20-research/facet-schema.json               the contract WU-15 implements

Design decisions, so a reviewer can argue with them rather than guess:

* Axes come from the NAV's own six organising axes (WU-04 `[17]`), not invented.
  The nav already sorts by capability / vertical / job-to-be-done / audience /
  integration platform / implementation surface. This makes that model filterable
  instead of positional.

* `conversion_action` has honest cardinality ~2. WU-04 measured it: 1729 pages
  carry a template "get started" CTA, 541 a hero "get a demo", only 72 carry both.
  Do not invent six conversion actions the site does not have.

* Every record gets a value on every axis. Where nothing is inferable the value is
  the literal string "unknown" — never null, never a missing key — so coverage is
  measurable instead of silently sparse.

* Multi-value is allowed on audience / capability / business_context, because a
  page genuinely can serve two. Single-value on the rest.
"""

import collections
import csv
import json
import os
import re

CORPUS = "50-prototype/corpus/records.jsonl"
INVENTORY = "20-research/sitemap-inventory.csv"
OUT_DIR = "20-research"

AXES = ["intent", "audience", "business_context", "capability",
        "content_type", "conversion_action"]

# --- vocabularies, closed ---------------------------------------------------

# Axis 4 — product capability. Sourced from the Products mega-menu + /use-cases.
CAPABILITY = {
    "search":          [r"\bai search\b", r"\bsite search\b", r"\bsearch api\b", r"instantsearch", r"autocomplete", r"typo.toleran", r"\bquery\b"],
    "recommend":       [r"recommend", r"\bfrequently bought", r"related (products|items|content)"],
    "browse":          [r"\bbrowse\b", r"category page", r"\bfacet", r"\bfiltering\b"],
    "neural-ai":       [r"neural", r"semantic", r"vector", r"\bllm\b", r"generative", r"\bgenai\b", r"embedding"],
    "agents":          [r"agent studio", r"\bagentic\b", r"\bai agent", r"\bassistant\b", r"\bchatbot\b", r"conversational"],
    "merchandising":   [r"merchandis", r"visual editor", r"promot(e|ion)", r"business rule", r"\bboost", r"\bre.?rank"],
    "personalization": [r"personaliz", r"personalis", r"user profile", r"affinity"],
    "analytics":       [r"analytics", r"\binsights\b", r"a/b test", r"click.?through", r"conversion rate"],
}

# Axis 3 — business context. From /industries + /department + content signals.
BUSINESS_CONTEXT = {
    "ecommerce":     [r"ecommerce", r"e-commerce", r"retail", r"shopper", r"\bcart\b", r"\bcheckout\b", r"\bcatalog"],
    "b2b":           [r"\bb2b\b", r"business.to.business", r"wholesale", r"procurement", r"\bdistributor"],
    "marketplace":   [r"marketplace", r"multi.?vendor", r"\bseller"],
    "media":         [r"\bmedia\b", r"publish(er|ing)", r"\beditorial\b", r"\bnews\b", r"\bcontent site"],
    "saas-software": [r"\bsaas\b", r"software compan", r"developer tool", r"\bapi.first"],
    "education":     [r"higher education", r"universit", r"\bstudent", r"\bacadem(y|ic)"],
    "grocery":       [r"grocer", r"\bfood\b", r"fresh produce"],
    "fashion":       [r"fashion", r"apparel", r"\bclothing\b"],
    "auto-parts":    [r"auto.?part", r"\bfitment\b", r"\bvehicle\b"],
    "docs-support":  [r"documentation search", r"knowledge base", r"\bsupport site"],
}

# Axis 2 — audience. /department is literally this axis; plus content signals.
AUDIENCE = {
    "developer":       [r"\bapi\b", r"\bsdk\b", r"code (sample|snippet|exchange)", r"\bnpm\b", r"\breact\b", r"javascript", r"\bpython\b", r"integration guide", r"\bgithub\b"],
    "engineering-lead":[r"architect", r"\bscalab", r"infrastructur", r"\blatency\b", r"\buptime\b", r"\bsla\b"],
    "merchandiser":    [r"merchandis", r"\bcurat(e|ion)", r"visual editor", r"business rule"],
    "marketer":        [r"\bmarketer", r"\bcampaign\b", r"\bbrand\b", r"\bcontent strategy", r"\bseo\b"],
    "product-manager": [r"product manage", r"\broadmap\b", r"\bux\b", r"user experience"],
    "executive":       [r"\broi\b", r"\brevenue\b", r"business case", r"total cost", r"\bforrester\b", r"\bcfo\b|\bcmo\b|\bceo\b"],
    "existing-customer":[r"\bmigrat", r"\bupgrade\b", r"\btroubleshoot", r"\bsupport\b", r"best practice"],
}

# Axis 5 — content type, from page_type. Deterministic, no keyword guessing.
CONTENT_TYPE = {
    "product": "product-page", "product-hub": "product-page",
    "industry": "solution-page", "solution": "solution-page", "use-case": "solution-page",
    "pricing": "pricing", "competitor-comparison": "comparison",
    "contact-sales": "contact", "landing-page": "landing-page",
    "customer-story": "case-study", "customer-story-hub": "case-study",
    "press-release": "news", "company": "company", "careers": "careers",
    "trust": "trust", "partner": "partner", "program": "program", "services": "services",
    "blog-post": "blog", "blog-hub": "blog",
    "resource": "resource", "resource-hub": "resource",
    "webinar": "webinar", "event": "event",
    "developer": "developer", "developer-hub": "developer",
    "code-exchange": "code-sample", "playbook": "playbook",
    "customer-hub": "support", "utility": "utility", "search": "utility",
    "homepage": "homepage",
    "doc": "documentation",
}


def match_multi(text, table, cap=3):
    """Return every vocabulary value whose pattern hits, most-hits first."""
    scores = {}
    for val, pats in table.items():
        n = sum(len(re.findall(p, text)) for p in pats)
        if n:
            scores[val] = n
    return [v for v, _ in sorted(scores.items(), key=lambda x: -x[1])[:cap]] or ["unknown"]


def conversion_action(rec):
    """Honest cardinality ~2. WU-04 measured this; do not inflate it."""
    m = (rec.get("cta") or {}).get("matched") or ""
    href = (rec.get("cta") or {}).get("href") or ""
    if "demo" in m or "demorequest" in href or "talk to" in m or "contact sales" in m:
        return "request-demo"
    if "get started" in m or "sign_up" in href or "start" in m or "sign up" in m:
        return "self-serve-signup"
    if "download" in m:
        return "download"
    if "read" in m or "watch" in m or "register" in m:
        return "consume-content"
    return "unknown"


def main():
    recs = [json.loads(l) for l in open(CORPUS, encoding="utf-8")]
    ok = [r for r in recs if r.get("fetch_ok")]

    inv = {}
    if os.path.exists(INVENTORY):
        for row in csv.DictReader(open(INVENTORY, encoding="utf-8")):
            inv[row["url"]] = row

    rows = []
    for r in ok:
        meta = inv.get(r["url"], {})
        pt = meta.get("page_type") or r["page_type"]
        url = r["url"]
        path = url.replace("https://www.algolia.com", "")
        # Weight title + first 4k of body; deeper body is mostly boilerplate/footer.
        text = f"{path} {r.get('title','')} {r.get('meta_description','')} {r.get('body','')[:4000]}".lower()

        # /department is literally the audience axis — trust the URL over keywords.
        dept = re.match(r"^/department/([\w-]+)", path)
        if dept:
            audience = [{"digital-experience": "marketer", "ecommerce": "merchandiser",
                         "engineering": "developer", "merchandisers": "merchandiser",
                         "product-management": "product-manager"}.get(dept.group(1), "unknown")]
        else:
            audience = match_multi(text, AUDIENCE)

        ind = re.match(r"^/industries/([\w-]+)", path)
        if ind:
            biz = [{"auto-parts": "auto-parts", "b2b-ecommerce": "b2b", "ecommerce": "ecommerce",
                    "fashion": "fashion", "grocery": "grocery", "higher-education": "education",
                    "media": "media"}.get(ind.group(1), "unknown")]
        else:
            biz = match_multi(text, BUSINESS_CONTEXT)

        rows.append({
            "url": url,
            "page_type": pt,
            "intent": meta.get("intent") or "unknown",
            "audience": audience,
            "business_context": biz,
            "capability": match_multi(text, CAPABILITY),
            "content_type": CONTENT_TYPE.get(pt, "unknown"),
            "conversion_action": conversion_action(r),
            "source": "www",
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "six-axis-classification.jsonl"), "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    schema = {
        "note": "WU-05 output. The contract WU-15 implements. Generated by build_six_axis.py.",
        "record_count": len(rows),
        "attributes": [
            {"name": "intent", "multi": False, "facet": "afterDistinct", "searchable": False},
            {"name": "audience", "multi": True, "facet": "afterDistinct", "searchable": False},
            {"name": "business_context", "multi": True, "facet": "afterDistinct(searchable)", "searchable": True},
            {"name": "capability", "multi": True, "facet": "afterDistinct(searchable)", "searchable": True},
            {"name": "content_type", "multi": False, "facet": "afterDistinct", "searchable": False},
            {"name": "conversion_action", "multi": False, "facet": "afterDistinct", "searchable": False},
            {"name": "page_type", "multi": False, "facet": "afterDistinct", "searchable": False},
            {"name": "source", "multi": False, "facet": "afterDistinct", "searchable": False},
        ],
        "vocabularies": {
            "intent": sorted({r["intent"] for r in rows}),
            "audience": sorted({v for r in rows for v in r["audience"]}),
            "business_context": sorted({v for r in rows for v in r["business_context"]}),
            "capability": sorted({v for r in rows for v in r["capability"]}),
            "content_type": sorted({r["content_type"] for r in rows}),
            "conversion_action": sorted({r["conversion_action"] for r in rows}),
        },
    }
    with open(os.path.join(OUT_DIR, "facet-schema.json"), "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)

    print(f"rows: {len(rows)}")
    for a in AXES:
        vals = []
        for r in rows:
            v = r[a]
            vals.extend(v if isinstance(v, list) else [v])
        unk = sum(1 for r in rows if r[a] == "unknown" or r[a] == ["unknown"])
        print(f"  {a:20} distinct={len(set(vals)):3}  unknown={unk:5} ({100*unk/len(rows):4.1f}%)")
        top = collections.Counter(vals).most_common(5)
        print(f"     top: {', '.join(f'{k}:{n}' for k, n in top)}")


if __name__ == "__main__":
    main()
