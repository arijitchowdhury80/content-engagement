#!/usr/bin/env python3
"""Read-only. Compare Algolia_Prod_Copy_Enhanced against Vanilla and against the demo's
current index (SEARCHFIRST_WWW_v1), to scope the swap Arijit just ordered."""
import json, os, ssl, urllib.request

CA = "/etc/ssl/cert.pem"
SSL_CTX = ssl.create_default_context(cafile=CA if os.path.exists(CA) else None)
ENV = "/Users/arijitchowdhury/Dropbox/AI-Development/RAG/Algolia-Central-Spectrum/.env.local"
env = {}
for line in open(ENV):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k] = v.strip().strip('"').strip("'")
APP, KEY = env["ALGOLIA_APP_ID"], env["ALGOLIA_ADMIN_API_KEY"]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
H = {"X-Algolia-Application-Id": APP, "X-Algolia-API-Key": KEY, "Content-Type": "application/json", "User-Agent": UA}

def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30, context=SSL_CTX))
def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=H, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=30, context=SSL_CTX))

items = get(f"https://{APP}.algolia.net/1/indexes")["items"]
for name in ["Algolia_Prod_Copy_Enhanced", "Algolia_Prod_Copy_Vanilla", "SEARCHFIRST_WWW_v1"]:
    meta = next((i for i in items if i["name"] == name), None)
    print(f"\n===== {name}")
    print(" meta:", json.dumps(meta))
    if not meta:
        continue
    s = get(f"https://{APP}.algolia.net/1/indexes/{name}/settings")
    for k in ["searchableAttributes","attributesForFaceting","customRanking","attributesToSnippet","attributesToHighlight"]:
        if s.get(k):
            print(f"  settings.{k}: {json.dumps(s[k])[:300]}")
    r = post(f"https://{APP}-dsn.algolia.net/1/indexes/{name}/query",
             {"query":"","hitsPerPage":0,"facets":["source","category","environment","language_code","page_type"],"maxValuesPerFacet":25})
    print("  nbHits:", r["nbHits"])
    for f, vals in (r.get("facets") or {}).items():
        print(f"    facet {f}: {json.dumps(vals)[:400]}")
    r2 = post(f"https://{APP}-dsn.algolia.net/1/indexes/{name}/query", {"query":"pricing","hitsPerPage":1})
    if r2["hits"]:
        h = r2["hits"][0]; h.pop("_highlightResult", None)
        print("  sample record keys:", sorted(h.keys()))
        print("  sample record:", json.dumps(h)[:900])

print("\n===== enrichment population check on Enhanced =====")
r = post(f"https://{APP}-dsn.algolia.net/1/indexes/Algolia_Prod_Copy_Enhanced/query",
         {"query":"","hitsPerPage":0,"facets":["facets.facet0","facets.facet1","facets.facet2","facets.facet3","facets.facet4","facets.facet5","is404"],"maxValuesPerFacet":10})
print("facet population:", json.dumps(r.get("facets"), indent=2))
r2 = post(f"https://{APP}-dsn.algolia.net/1/indexes/Algolia_Prod_Copy_Enhanced/query",
          {"query":"","filters":"NOT facets.facet0:\"\"","hitsPerPage":0})
print("records with facets.facet0 set (best-effort filter):", r2.get("nbHits"))
r3 = post(f"https://{APP}-dsn.algolia.net/1/indexes/Algolia_Prod_Copy_Enhanced/query",
          {"query":"","filters":"is404:true","hitsPerPage":0})
print("is404:true count:", r3.get("nbHits"))
