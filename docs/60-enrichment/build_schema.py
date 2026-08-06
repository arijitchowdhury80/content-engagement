#!/usr/bin/env python3
"""
WU-26 / [87] — emit taxonomy-schema.algolia-com.json.

The schema is DATA. classify.py is a generic engine that reads it and knows
nothing about Algolia. Pointing the engine at a new corpus means writing a new
schema file, not new code.

Why a generator rather than a hand-written JSON: the customer vocabulary is 84
slugs read straight off /customers/* in the live index, and hand-copying it
would rot. Everything else is declared inline here so a reviewer can argue with
it in one place.

Vocabularies are read off algolia.com's own IA. Where the site and
algolia-central_enterprise_ledger disagree, the site wins — the ledger still
carries retired product names (App Search, DocSearch as a product).
"""

import collections
import json
import os
import re

CORPUS = "docs/60-enrichment/enhanced-pre-taxonomy-20260805.jsonl"
OUT = "docs/60-enrichment/taxonomy-schema.algolia-com.json"
VERSION = "algolia-com-taxonomy-v1-20260805"

# --- axes -------------------------------------------------------------------
# Applicability is THREE states, not two. Derived from the measured
# resolution-by-page_type matrix (2026-08-05), not asserted:
#
#   required      the axis is meaningful here and SHOULD resolve. If it does
#                 not, the value is "unknown" — a real, measurable gap.
#   opportunistic the axis may or may not apply. Write it when found; OMIT it
#                 when not. Never "unknown" — a blog post that names no
#                 customer is not a gap, and recording it as one would put
#                 4,136 records in a bogus "unknown" facet bucket.
#   (absent)      the axis is meaningless here. Never written.
#
# Evidence for the split, from the matrix: customer resolves 100% on case-study
# and 2% on blog-post. feature resolves 90% on doc-guide and 0% on use-case.
# solution resolves 89% on use-case and 0-3% across every doc-* type.
AXES = [
    {"name": "product", "type": "array", "searchable": True,
     "required_on": ["product-page", "product-hub", "doc-rest-api", "developer",
                     "developer-hub", "pricing", "comparison"],
     "opportunistic_on": ["blog-post", "press-release", "support-article", "case-study",
                          "resource", "solution-page", "use-case", "industry-page",
                          "landing-page", "homepage", "academy-training", "event",
                          "webinar", "doc-guide", "doc-integration", "doc-tool",
                          "developer-code-sample", "playbook"]},
    {"name": "feature", "type": "array", "searchable": True,
     "required_on": ["doc-guide", "doc-api-reference", "doc-sdk", "doc-sdk-unified",
                     "doc-rest-api", "doc-tool", "doc-ui-library", "doc-integration",
                     "doc-framework-integration", "support-article", "product-page",
                     "product-hub", "developer-code-sample", "developer", "academy-training"],
     "opportunistic_on": ["blog-post", "resource", "press-release", "case-study",
                          "solution-page", "playbook", "webinar", "landing-page", "homepage"]},
    {"name": "solution", "type": "array", "searchable": True,
     "required_on": ["use-case"],
     "opportunistic_on": ["solution-page", "industry-page", "blog-post", "resource", "case-study",
                          "comparison", "landing-page", "homepage", "pricing",
                          "press-release", "playbook", "webinar", "event"]},
    {"name": "industry", "type": "array", "searchable": True,
     "required_on": ["industry-page", "department-page"],
     "opportunistic_on": ["use-case", "case-study", "blog-post", "resource", "press-release",
                          "solution-page", "comparison", "event", "webinar",
                          "landing-page", "homepage", "playbook"]},
    {"name": "customer", "type": "array", "searchable": False,
     "required_on": ["case-study"],
     "opportunistic_on": ["case-study-hub", "blog-post", "press-release", "resource",
                          "webinar", "event"]},
    {"name": "language_platform", "type": "array", "searchable": False,
     "required_on": ["doc-sdk", "doc-framework-integration"],
     "opportunistic_on": ["doc-sdk-unified", "doc-api-reference", "doc-guide", "doc-ui-library",
                          "developer", "developer-hub", "developer-code-sample",
                          "blog-post", "support-article", "academy-training"]},
    {"name": "integration_platform", "type": "array", "searchable": False,
     "required_on": ["doc-integration"],
     "opportunistic_on": ["solution-page", "support-article", "blog-post", "resource",
                          "case-study", "doc-guide", "product-page", "developer-code-sample",
                          "landing-page", "press-release", "partner"]},
    {"name": "page_type", "type": "string", "searchable": False, "required_on": ["*"]},
]

# --- vocabularies -----------------------------------------------------------
# slug -> {label, aliases}. Aliases are matched case-insensitively in text and
# in the legacy `category` field. Slugs are lowercase-hyphenated (R3).

PRODUCT = {
    "ai-search":              {"label": "AI Search",              "aliases": ["ai search", "algolia search"]},
    "ai-browse":              {"label": "AI Browse",              "aliases": ["ai browse"]},
    "ai-recommendations":     {"label": "AI Recommendations",     "aliases": ["ai recommendations", "algolia recommend", "recommend"]},
    "agent-studio":           {"label": "Agent Studio",           "aliases": ["agent studio", "agentic", "ai agent"]},
    "ask-ai":                 {"label": "Ask AI",                 "aliases": ["ask ai"]},
    "generative-experiences": {"label": "Generative Experiences", "aliases": ["generative experiences", "genai experiences"]},
    "intelligent-data-kit":   {"label": "Intelligent Data Kit",   "aliases": ["intelligent data kit"]},
}

FEATURE = {
    # /products/features/* — the 14 the site declares
    "ab-testing":             {"label": "A/B Testing",             "aliases": ["a/b testing", "ab testing", "a/b test"]},
    "ai-ranking":             {"label": "AI Ranking",              "aliases": ["ai ranking", "dynamic re-ranking", "dynamic reranking"]},
    "ai-synonyms":            {"label": "AI Synonyms",             "aliases": ["ai synonyms", "synonym", "synonyms"]},
    "analytics":              {"label": "Analytics",               "aliases": ["analytics", "insights"]},
    "crawler":                {"label": "Crawler",                 "aliases": ["crawler"]},
    "data-enrichment":        {"label": "Data Enrichment",         "aliases": ["data enrichment", "enrichment"]},
    "data-transformation":    {"label": "Data Transformation",     "aliases": ["data transformation", "transformation", "ingestion"]},
    "neuralsearch":           {"label": "NeuralSearch",            "aliases": ["neuralsearch", "neural search", "semantic search", "vector search"]},
    "personalization":        {"label": "Personalization",         "aliases": ["personalization", "personalisation"]},
    "query-categorization":   {"label": "Query Categorization",    "aliases": ["query categorization", "query categorisation"]},
    "search-autocomplete":    {"label": "Autocomplete",            "aliases": ["autocomplete", "query suggestions"]},
    "search-relevance-rules": {"label": "Rules",                   "aliases": ["relevance rules", "query rule", "merchandising rules"]},
    "ui-component-libraries": {"label": "UI Libraries",            "aliases": ["instantsearch", "ui library", "ui libraries", "widget"]},
    "guides":                 {"label": "Guides",                  "aliases": []},
    # doc/support-derived features, validated against real high-frequency terms
    "faceting":               {"label": "Faceting",                "aliases": ["faceting", "facets", "facet"]},
    "filtering":              {"label": "Filtering",               "aliases": ["filtering", "filters"]},
    "indexing":               {"label": "Indexing",                "aliases": ["indexing", "reindex"]},
    "pagination":             {"label": "Pagination",              "aliases": ["pagination", "paginate"]},
    "highlighting":           {"label": "Highlighting & Snippeting", "aliases": ["highlighting", "snippeting"]},
    "geo-search":             {"label": "Geo Search",              "aliases": ["geo search", "geolocation", "aroundlatlng"]},
    "typo-tolerance":         {"label": "Typo Tolerance",          "aliases": ["typo tolerance", "typo-tolerance", "typos"]},
    "custom-ranking":         {"label": "Custom Ranking",          "aliases": ["custom ranking", "sorting", "sort by"]},
    "api-keys":               {"label": "API Keys & Security",     "aliases": ["api key", "secured api key", "api keys"]},
    "monitoring":             {"label": "Monitoring",              "aliases": ["monitoring", "uptime", "status api"]},
    "events":                 {"label": "Events & Click Tracking", "aliases": ["click event", "conversion event", "event tracking", "insights api"]},
    "dictionaries":           {"label": "Dictionaries",            "aliases": ["dictionary", "dictionaries", "stop word", "stopwords", "plurals"]},
    "replicas":               {"label": "Replicas & Multi-Index",  "aliases": ["replica", "replicas", "multi-index", "virtual replica"]},
    "recommend-models":       {"label": "Recommend Models",        "aliases": ["frequently bought together", "related products", "trending items", "looking similar"]},
    "query-suggestions":      {"label": "Query Suggestions",       "aliases": ["query suggestion"]},
    "docsearch":              {"label": "DocSearch",               "aliases": ["docsearch"]},
}

SOLUTION = {
    "site-search":          {"label": "Site Search",           "aliases": ["site search"]},
    "documentation-search": {"label": "Documentation Search",  "aliases": ["documentation search", "docs search"]},
    "image-search":         {"label": "Image Search",          "aliases": ["image search", "image finder"]},
    "visual-search":        {"label": "Visual Search",         "aliases": ["visual search"]},
    "voice-search":         {"label": "Voice Search",          "aliases": ["voice search"]},
    "mobile-search":        {"label": "Mobile Search",         "aliases": ["mobile search", "in-app search"]},
    "headless-commerce":    {"label": "Headless Commerce",     "aliases": ["headless commerce", "headless"]},
    "enterprise":           {"label": "Enterprise Search",     "aliases": ["enterprise search"]},
    "retail-media-network": {"label": "Retail Media Network",  "aliases": ["retail media network", "retail media"]},
    "shopping-assistant":   {"label": "Shopping Assistant",    "aliases": ["shopping assistant"]},
}

INDUSTRY = {
    "ecommerce":        {"label": "Ecommerce",         "aliases": ["ecommerce", "e-commerce"]},
    "b2b-ecommerce":    {"label": "B2B Ecommerce",     "aliases": ["b2b ecommerce", "b2b commerce", "wholesale", "distributor"]},
    "marketplaces":     {"label": "Marketplaces",      "aliases": ["marketplace", "multi-vendor"]},
    "fashion":          {"label": "Fashion",           "aliases": ["fashion", "apparel", "clothing"]},
    "grocery":          {"label": "Grocery",           "aliases": ["grocery", "grocer", "fresh produce"]},
    "media":            {"label": "Media",             "aliases": ["media", "publisher", "publishing", "editorial"]},
    "saas":             {"label": "SaaS & Software",   "aliases": ["saas", "software company"]},
    "auto-parts":       {"label": "Auto Parts",        "aliases": ["auto parts", "auto-part", "fitment"]},
    "higher-education": {"label": "Higher Education",  "aliases": ["higher education", "university", "student"]},
    "startups":         {"label": "Startups",          "aliases": ["startup", "startups"]},
}

LANGUAGE_PLATFORM = {
    "javascript": {"label": "JavaScript", "aliases": ["javascript", "js", "node.js", "nodejs"]},
    "python":     {"label": "Python",     "aliases": ["python"]},
    "php":        {"label": "PHP",        "aliases": ["php"]},
    "ruby":       {"label": "Ruby",       "aliases": ["ruby"]},
    "java":       {"label": "Java",       "aliases": ["java"]},
    "kotlin":     {"label": "Kotlin",     "aliases": ["kotlin"]},
    "swift":      {"label": "Swift",      "aliases": ["swift"]},
    "csharp":     {"label": "C#/.NET",    "aliases": ["c#", ".net", "csharp", "dotnet"]},
    "go":         {"label": "Go",         "aliases": ["golang"]},
    "scala":      {"label": "Scala",      "aliases": ["scala"]},
    "dart":       {"label": "Dart",       "aliases": ["dart", "flutter"]},
    "react":      {"label": "React",      "aliases": ["react", "react.js"]},
    "vue":        {"label": "Vue",        "aliases": ["vue", "vue.js"]},
    "angular":    {"label": "Angular",    "aliases": ["angular"]},
    "android":    {"label": "Android",    "aliases": ["android"]},
    "ios":        {"label": "iOS",        "aliases": ["ios"]},
    "laravel":    {"label": "Laravel",    "aliases": ["laravel"]},
    "symfony":    {"label": "Symfony",    "aliases": ["symfony"]},
    "rails":      {"label": "Ruby on Rails", "aliases": ["ruby on rails", "rails"]},
    "django":     {"label": "Django",     "aliases": ["django"]},
}

INTEGRATION_PLATFORM = {
    "shopify":                   {"label": "Shopify",                   "aliases": ["shopify", "hydrogen"]},
    "adobe-commerce-magento":    {"label": "Adobe Commerce / Magento",  "aliases": ["magento", "adobe commerce"]},
    "adobe-experience-manager":  {"label": "Adobe Experience Manager",  "aliases": ["adobe experience manager", "aem"]},
    "salesforce-commerce-cloud": {"label": "Salesforce Commerce Cloud", "aliases": ["salesforce commerce cloud", "sfcc", "salesforce b2c"]},
    "bigcommerce":               {"label": "BigCommerce",               "aliases": ["bigcommerce"]},
    "commercetools":             {"label": "commercetools",             "aliases": ["commercetools"]},
    "netlify":                   {"label": "Netlify",                   "aliases": ["netlify"]},
    "aws":                       {"label": "AWS",                       "aliases": ["algolia on aws", "amazon web services"]},
    "azure":                     {"label": "Microsoft Azure",           "aliases": ["algolia on azure", "microsoft azure"]},
    "zendesk":                   {"label": "Zendesk",                   "aliases": ["zendesk"]},
    "wordpress":                 {"label": "WordPress",                 "aliases": ["wordpress"]},
}

# --- page_type --------------------------------------------------------------
PAGE_TYPE = [
    "homepage", "product-page", "product-hub", "solution-page", "use-case",
    "industry-page", "department-page", "pricing", "comparison", "contact-sales",
    "landing-page", "case-study", "case-study-hub", "press-release", "company",
    "careers", "trust", "policy", "partner", "program", "services",
    "blog-post", "blog-hub", "author-page", "resource", "resource-hub",
    "webinar", "event", "playbook",
    "developer", "developer-hub", "developer-code-sample",
    "doc-guide", "doc-api-reference", "doc-sdk", "doc-sdk-unified", "doc-rest-api",
    "doc-integration", "doc-tool", "doc-ui-library", "doc-framework-integration",
    "doc-changelog", "doc-glossary", "doc-hub",
    "support-article", "academy-training", "job-posting", "utility",
]

# --- URL rules --------------------------------------------------------------
# Ordered. First match wins for page_type; ALL matching axis assignments apply.
# {segment} captures a path segment and looks it up in that axis's vocabulary.
URL_RULES = [
    # --- Documentation (8,507 records, 50.1% of the index) ---
    # /doc/libraries/sdk/* is the unified SDK reference — no language in the
    # path, so language_platform must NOT be required there. Its own page_type.
    {"host": "www.algolia.com", "path": "^/doc/libraries/sdk(/|$)",              "page_type": "doc-sdk-unified"},
    {"host": "www.algolia.com", "path": "^/doc/libraries/search-insights(/|$)",  "page_type": "doc-sdk-unified", "feature": ["events"]},
    # /doc/libraries/{lang}/{ver}/methods/{group} — the group names the feature
    # or product outright. ~2,300 records. Language is captured in the same rule
    # because the engine takes the first match only.
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/search(/|$)",            "page_type": "doc-sdk", "product": ["ai-search"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/ingestion(/|$)",         "page_type": "doc-sdk", "feature": ["data-transformation"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/analytics(/|$)",         "page_type": "doc-sdk", "feature": ["analytics"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/composition(/|$)",       "page_type": "doc-sdk", "feature": ["search-relevance-rules"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/monitoring(/|$)",        "page_type": "doc-sdk", "feature": ["monitoring"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/abtesting[\\w-]*(/|$)",  "page_type": "doc-sdk", "feature": ["ab-testing"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/query-suggestions(/|$)", "page_type": "doc-sdk", "feature": ["query-suggestions"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/recommend(/|$)",         "page_type": "doc-sdk", "product": ["ai-recommendations"], "feature": ["recommend-models"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/personalization(/|$)",   "page_type": "doc-sdk", "feature": ["personalization"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/agent-studio(/|$)",      "page_type": "doc-sdk", "product": ["agent-studio"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)/[\\w.-]+/methods/insights(/|$)",          "page_type": "doc-sdk", "feature": ["events"]},
    {"host": "www.algolia.com", "path": "^/doc/libraries/(?P<language_platform>[\\w-]+)(/|$)", "page_type": "doc-sdk"},
    {"host": "www.algolia.com", "path": "^/doc/ui-libraries/autocomplete(/|$)",  "page_type": "doc-ui-library", "feature": ["search-autocomplete", "ui-component-libraries"]},
    {"host": "www.algolia.com", "path": "^/doc/ui-libraries(/|$)",               "page_type": "doc-ui-library", "feature": ["ui-component-libraries"]},
    {"host": "www.algolia.com", "path": "^/doc/framework-integration/(?P<language_platform>[\\w-]+)(/|$)", "page_type": "doc-framework-integration"},
    {"host": "www.algolia.com", "path": "^/doc/integration/(?P<integration_platform>[\\w-]+)(/|$)", "page_type": "doc-integration"},
    {"host": "www.algolia.com", "path": "^/doc/api-reference/widgets(/|$)",      "page_type": "doc-api-reference", "feature": ["ui-component-libraries"]},
    # Each API parameter IS a feature. 93 distinct params; the camelCase ->
    # feature map is derived from the corpus in api_parameter_aliases().
    {"host": "www.algolia.com", "path": "^/doc/api-reference/api-parameters/(?P<feature>[\\w-]+)(/|$)", "page_type": "doc-api-reference"},
    {"host": "www.algolia.com", "path": "^/doc/api-reference/api-methods/(?P<feature>[\\w-]+)(/|$)",    "page_type": "doc-api-reference"},
    {"host": "www.algolia.com", "path": "^/doc/api-reference(/|$)",              "page_type": "doc-api-reference"},
    # /doc/rest-api/{service} names the product or feature outright.
    {"host": "www.algolia.com", "path": "^/doc/rest-api/(agent-studio|agents)(/|$)",  "page_type": "doc-rest-api", "product": ["agent-studio"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/ingestion(/|$)",         "page_type": "doc-rest-api", "feature": ["data-transformation"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/analytics(/|$)",         "page_type": "doc-rest-api", "feature": ["analytics"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/crawler(/|$)",           "page_type": "doc-rest-api", "feature": ["crawler"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/monitoring(/|$)",        "page_type": "doc-rest-api", "feature": ["monitoring"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/recommend(/|$)",         "page_type": "doc-rest-api", "product": ["ai-recommendations"], "feature": ["recommend-models"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/personalization(/|$)",   "page_type": "doc-rest-api", "feature": ["personalization"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/abtesting(/|$)",         "page_type": "doc-rest-api", "feature": ["ab-testing"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/insights(/|$)",          "page_type": "doc-rest-api", "feature": ["events"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/query-suggestions(/|$)", "page_type": "doc-rest-api", "feature": ["query-suggestions"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api/search(/|$)",            "page_type": "doc-rest-api", "product": ["ai-search"]},
    {"host": "www.algolia.com", "path": "^/doc/rest-api(/|$)",                   "page_type": "doc-rest-api"},
    {"host": "www.algolia.com", "path": "^/doc/api-client(/|$)",                 "page_type": "doc-sdk"},
    {"host": "www.algolia.com", "path": "^/doc/guides/building-search-ui(/|$)",  "page_type": "doc-guide", "feature": ["ui-component-libraries"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/managing-results(/|$)",    "page_type": "doc-guide", "feature": ["search-relevance-rules"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/personalization(/|$)",     "page_type": "doc-guide", "feature": ["personalization"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/algolia-ai(/|$)",          "page_type": "doc-guide", "feature": ["neuralsearch"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/sending-and-managing-data(/|$)", "page_type": "doc-guide", "feature": ["indexing", "data-transformation"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/sending-events(/|$)",      "page_type": "doc-guide", "feature": ["events"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/search-analytics(/|$)",    "page_type": "doc-guide", "feature": ["analytics"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/ab-testing(/|$)",          "page_type": "doc-guide", "feature": ["ab-testing"]},
    {"host": "www.algolia.com", "path": "^/doc/guides/security(/|$)",            "page_type": "doc-guide", "feature": ["api-keys"]},
    {"host": "www.algolia.com", "path": "^/doc/guides(/|$)",                     "page_type": "doc-guide"},
    {"host": "www.algolia.com", "path": "^/doc/tools/crawler(/|$)",              "page_type": "doc-tool", "feature": ["crawler"]},
    {"host": "www.algolia.com", "path": "^/doc/tools(/|$)",                      "page_type": "doc-tool"},
    {"host": "www.algolia.com", "path": "^/doc/changelog(/|$)",                  "page_type": "doc-changelog"},
    {"host": "www.algolia.com", "path": "^/doc/glossary(/|$)",                   "page_type": "doc-glossary"},
    {"host": "www.algolia.com", "path": "^/doc/?$",                              "page_type": "doc-hub"},
    {"host": "www.algolia.com", "path": "^/doc(/|$)",                            "page_type": "doc-guide"},
    # --- Product / Solutions ---
    {"host": "www.algolia.com", "path": "^/products/features/(?P<feature>[\\w-]+)(/|$)", "page_type": "product-page"},
    {"host": "www.algolia.com", "path": "^/products/features/?$",                        "page_type": "product-hub"},
    # /products/ai is the AI hub, not a product named "ai" — must precede the capture rule.
    {"host": "www.algolia.com", "path": "^/products/ai/?$",                              "page_type": "product-hub"},
    {"host": "www.algolia.com", "path": "^/products/ai/(?P<product>[\\w-]+)(/|$)",       "page_type": "product-page"},
    {"host": "www.algolia.com", "path": "^/products/?$",                                 "page_type": "product-hub"},
    {"host": "www.algolia.com", "path": "^/products/(?P<product>[\\w-]+)(/|$)",          "page_type": "product-page"},
    {"host": "www.algolia.com", "path": "^/use-cases/?$",                                "page_type": "solution-page"},
    {"host": "www.algolia.com", "path": "^/use-cases/(?P<solution>[\\w-]+)(/|$)",        "page_type": "use-case"},
    {"host": "www.algolia.com", "path": "^/industries/?$",                               "page_type": "solution-page"},
    {"host": "www.algolia.com", "path": "^/industries/(?P<industry>[\\w-]+)(/|$)",       "page_type": "industry-page"},
    {"host": "www.algolia.com", "path": "^/search-solutions/?$",                         "page_type": "solution-page"},
    {"host": "www.algolia.com", "path": "^/search-solutions/(?P<integration_platform>[\\w-]+)(/|$)", "page_type": "solution-page"},
    {"host": "www.algolia.com", "path": "^/department/?$",                               "page_type": "solution-page"},
    {"host": "www.algolia.com", "path": "^/department/[\\w-]+(/|$)",                     "page_type": "department-page"},
    {"host": "www.algolia.com", "path": "^/algolia-resource-center(/|$)",                "page_type": "resource-hub"},
    {"host": "www.algolia.com", "path": "^/ai-search-grader(/|$)",                       "page_type": "landing-page"},
    {"host": "www.algolia.com", "path": "^/ecommerce-merchandising-playbook(/|$)",       "page_type": "playbook", "industry": ["ecommerce"], "feature": ["search-relevance-rules"]},
    # --- Commercial ---
    {"host": "www.algolia.com", "path": "^/pricing(/|$)",                    "page_type": "pricing"},
    {"host": "www.algolia.com", "path": "^/competitors(/|$)",                "page_type": "comparison"},
    {"host": "www.algolia.com", "path": "^/(demorequest|contactus|contact)(/|$)", "page_type": "contact-sales"},
    {"host": "www.algolia.com", "path": "^/(value-signup|search-audit|welcome|thank-you)(/|$)", "page_type": "landing-page"},
    {"host": "www.algolia.com", "path": "^/lp(/|$)",                         "page_type": "landing-page"},
    # --- Customers ---
    {"host": "www.algolia.com", "path": "^/customers/(?P<customer>[\\w.-]+)(/|$)", "page_type": "case-study"},
    {"host": "www.algolia.com", "path": "^/customers/?$",                    "page_type": "case-study-hub"},
    {"host": "www.algolia.com", "path": "^/customer-hub(/|$)",               "page_type": "case-study-hub"},
    # --- Content ---
    {"host": "www.algolia.com", "path": "^/blog/author-directory(/|$)",      "page_type": "author-page"},
    {"host": "www.algolia.com", "path": "^/blog/[\\w-]+/[\\w-]+",            "page_type": "blog-post"},
    {"host": "www.algolia.com", "path": "^/blog(/|$)",                       "page_type": "blog-hub"},
    {"host": "www.algolia.com", "path": "^/resources/asset(/|$)",            "page_type": "resource"},
    {"host": "www.algolia.com", "path": "^/resources(/|$)",                  "page_type": "resource-hub"},
    {"host": "www.algolia.com", "path": "^/webinars(/|$)",                   "page_type": "webinar"},
    {"host": "www.algolia.com", "path": "^/(events|devcon|exclusive)(/|$)",  "page_type": "event"},
    # --- Developers ---
    {"host": "www.algolia.com", "path": "^/developers/code-exchange(/|$)",   "page_type": "developer-code-sample"},
    {"host": "www.algolia.com", "path": "^/developers/?$",                   "page_type": "developer-hub"},
    {"host": "www.algolia.com", "path": "^/developers(/|$)",                 "page_type": "developer"},
    {"host": "www.algolia.com", "path": "^/dev(/|$)",                        "page_type": "developer"},
    # --- Company / Trust ---
    {"host": "www.algolia.com", "path": "^/about/news(/|$)",                 "page_type": "press-release"},
    {"host": "www.algolia.com", "path": "^/about(/|$)",                      "page_type": "company"},
    {"host": "www.algolia.com", "path": "^/careers(/|$)",                    "page_type": "careers"},
    {"host": "www.algolia.com", "path": "^/policies(/|$)",                   "page_type": "policy"},
    {"host": "www.algolia.com", "path": "^/(distributed-secure|trust-center|privacy-faqs)(/|$)", "page_type": "trust"},
    {"host": "www.algolia.com", "path": "^/(partner-program|partners|mach-alliance)(/|$)", "page_type": "partner"},
    {"host": "www.algolia.com", "path": "^/(for-non-profit|for-open-source|awards|user-research)(/|$)", "page_type": "program"},
    {"host": "www.algolia.com", "path": "^/professional-services-support(/|$)", "page_type": "services"},
    {"host": "www.algolia.com", "path": "^/(search|error-404|oauth-result|master-list-for-code-exchnage|blog-podcasts|devcon-retired|test-algolia-get-a-demo|mach-alliance-test)(/|$)", "page_type": "utility"},
    {"host": "www.algolia.com", "path": "^/?$",                              "page_type": "homepage"},
    # --- Other hosts ---
    # Support URLs are /hc/en-us/articles/{id}-{slug} — no taxonomy in the path.
    # The legacy `category` field carries it instead; see FIELD_RULES.
    {"host": "support.algolia.com",      "path": ".*", "page_type": "support-article"},
    # Academy URLs are bare UUIDs. Zero path signal — text fallback only.
    {"host": "academy.algolia.com",      "path": ".*", "page_type": "academy-training"},
    {"host": "job-boards.greenhouse.io", "path": ".*", "page_type": "job-posting"},
]

# --- legacy-field rules -----------------------------------------------------
# Support's existing `category` is a real 26-value vocabulary. Treated as a
# deterministic signal of the same rank as a URL path, which moves 1,695
# records out of the text-dependent population.
FIELD_RULES = [
    {"when_source": "Support", "field": "category", "map": {
        "Managing Results":            {"feature": ["search-relevance-rules"]},
        "Shopify":                     {"integration_platform": ["shopify"]},
        "Magento":                     {"integration_platform": ["adobe-commerce-magento"]},
        "BigCommerce":                 {"integration_platform": ["bigcommerce"]},
        "Building Search UI":          {"feature": ["ui-component-libraries"]},
        "DocSearch":                   {"feature": ["docsearch"], "solution": ["documentation-search"]},
        "Crawler":                     {"feature": ["crawler"]},
        "Sending and Managing Data":   {"feature": ["indexing", "data-transformation"]},
        "Indexing & Data Ingestion":   {"feature": ["indexing", "data-transformation"]},
        "Analytics":                   {"feature": ["analytics"]},
        "Security":                    {"feature": ["api-keys"]},
        "Sending Events":              {"feature": ["events"]},
        "Algolia Recommend":           {"product": ["ai-recommendations"], "feature": ["recommend-models"]},
        "Algolia AI":                  {"feature": ["neuralsearch"]},
        "A/B Testing":                 {"feature": ["ab-testing"]},
        "Personalization":             {"feature": ["personalization"]},
        "Query Suggestions":           {"feature": ["query-suggestions"]},
        "NeuralSearch":                {"feature": ["neuralsearch"]},
        "Scaling (Infrastructure)":    {"feature": ["replicas", "monitoring"]},
        "API Clients and Extensions":  {"page_type_hint": "doc-sdk"},
        "3rd Party Integrations":      {},
        "Account Management":          {},
        "Billing and Plans":           {},
        "Usage, Operations and Costs": {"feature": ["monitoring"]},
        "Getting Started":             {},
        "Algolia Support":             {},
    }},
]

# --- legacy list-field mining ------------------------------------------------
# `tags` and `keywords` are populated on 97-100% of Blog and 56-84% of
# Developers/Website records — exactly the population where URL paths carry no
# signal. Measured caveat: only 15.9% of their values are product vocabulary.
# The rest are editorial categories ("engineering", "product") and release
# labels ("general availability", "beta"), so this is wired as a curated map,
# not a blanket alias sweep. Ranked as legacy-field: authored metadata, above
# free text, below a URL path.
LIST_FIELD_RULES = [
    {"fields": ["tags", "keywords"], "map": {
        "e-commerce":        {"industry": ["ecommerce"]},
        "ecommerce":         {"industry": ["ecommerce"]},
        "commerce":          {"industry": ["ecommerce"]},
        "retail":            {"industry": ["ecommerce"]},
        "b2b":               {"industry": ["b2b-ecommerce"]},
        "marketplace":       {"industry": ["marketplaces"]},
        "media":             {"industry": ["media"]},
        "fashion":           {"industry": ["fashion"]},
        "grocery":           {"industry": ["grocery"]},
        "saas":              {"industry": ["saas"]},
        "education":         {"industry": ["higher-education"]},
        "algolia recommend": {"product": ["ai-recommendations"], "feature": ["recommend-models"]},
        "recommend":         {"product": ["ai-recommendations"]},
        "neuralsearch":      {"feature": ["neuralsearch"]},
        "vector search":     {"feature": ["neuralsearch"]},
        "semantic search":   {"feature": ["neuralsearch"]},
        "personalization":   {"feature": ["personalization"]},
        "a/b testing":       {"feature": ["ab-testing"]},
        "analytics":         {"feature": ["analytics"]},
        "indexing":          {"feature": ["indexing"]},
        "crawler":           {"feature": ["crawler"]},
        "instantsearch":     {"feature": ["ui-component-libraries"]},
        "autocomplete":      {"feature": ["search-autocomplete"]},
        "query suggestions": {"feature": ["query-suggestions"]},
        "synonyms":          {"feature": ["ai-synonyms"]},
        "faceting":          {"feature": ["faceting"]},
        "merchandising":     {"feature": ["search-relevance-rules"]},
        "agent studio":      {"product": ["agent-studio"]},
        "agentic":           {"product": ["agent-studio"]},
        "shopify":           {"integration_platform": ["shopify"]},
        "magento":           {"integration_platform": ["adobe-commerce-magento"]},
        "adobe commerce":    {"integration_platform": ["adobe-commerce-magento"]},
        "bigcommerce":       {"integration_platform": ["bigcommerce"]},
        "commercetools":     {"integration_platform": ["commercetools"]},
        "salesforce":        {"integration_platform": ["salesforce-commerce-cloud"]},
        "site search":       {"solution": ["site-search"]},
        "voice search":      {"solution": ["voice-search"]},
        "visual search":     {"solution": ["visual-search"]},
        "image search":      {"solution": ["image-search"]},
        "headless":          {"solution": ["headless-commerce"]},
        "headless commerce": {"solution": ["headless-commerce"]},
        "mobile search":     {"solution": ["mobile-search"]},
        "documentation search": {"solution": ["documentation-search"]},
    }},
]

# --- capture aliases --------------------------------------------------------
# A URL segment captured by a rule is a RAW string; it is not automatically a
# vocabulary slug. Every raw form seen in the live corpus is mapped here.
# Anything captured but absent from both the vocabulary and this map is DROPPED,
# never invented (R4) — and the gate reports it.
# Measured before this existed: 331 integration_platform records and 44 customer
# records were resolving to out-of-vocabulary values.
CAPTURE_ALIASES = {
    "integration_platform": {
        "magento-2": "adobe-commerce-magento",
        "salesforce-commerce-cloud-b2c": "salesforce-commerce-cloud",
        "algolia-on-aws": "aws",
        "algolia-on-azure": "azure",
        "embedded-partnerships": None,   # a partnership programme, not a platform — drop
    },
    "language_platform": {
        "versions": None,                 # a docs sub-page, not a language — drop
        "search-insights": None,          # handled by an explicit feature rule instead
    },
    "product": {
        "ai": None,                       # /products/ai is the hub — handled by its own rule
    },
}

# --- text matching ----------------------------------------------------------
# GENERIC_TERMS never match from free text — only from a URL path or a legacy
# field. Measured: "search" alone appears in the title/abstract/url of 47.9% of
# records, which would blow R5 (>40%) on its own.
GENERIC_TERMS = ["search", "index", "api", "data", "ai", "algolia", "guides", "enterprise", "analytics"]

# Per-VALUE structural gate (distinct from GENERIC_TERMS, which is per-term).
# Measured: industry="ecommerce" assigned from free text landed on 84.7% of the
# records carrying an industry — the ledger's "Site Search on 65%" defect
# exactly. A value this dominant carries no filtering power. It may still be
# assigned, but only from a URL path or an authored field, where it means the
# page IS about ecommerce rather than merely mentioning it.
URL_OR_FIELD_ONLY = {"industry": ["ecommerce"]}

# A vocabulary value that is also an ordinary English word cannot be matched
# from free text — the word is not the brand. Measured: customer "end" (the
# retailer END.) collected 70 false text matches on the word "end", against 5
# genuine URL-derived ones. Contrast walgreens (15 text matches) and gymshark
# (12), which are real citations in blog posts and must be kept. So this is a
# per-value guard, not a blanket ban on text-matching customers.
COMMON_WORD_VALUES = {
    "customer": ["end", "orange", "staples", "crocs", "zoom", "politico", "clarks",
                 "co-op", "sary", "hbm", "gemo", "edx"],
}

# Minimum evidence before a text match is written.
# Measured 2026-08-05: with the available text (median 117-490 chars per record,
# because no body field exists) a concept almost never surfaces two DIFFERENT
# alias strings. A threshold of 2 discarded 90.6% of all hits — 13,184 of
# 14,559. One unambiguous, non-generic vocabulary term in title/abstract is the
# strongest signal this corpus can offer; generic terms are already barred from
# text matching entirely, which is where the precision protection actually
# lives.
MIN_TEXT_EVIDENCE = 1

# Fields the text matcher may read, in priority order. Body is not available.
TEXT_FIELDS = ["title", "abstract", "description"]

# Values that must never be emitted regardless of match (R5 escape hatch).
BLOCKLIST = {"solution": ["site-search"]}  # 65% coverage in the ledger — no filtering power


def api_parameter_aliases(recs):
    """Map /doc/api-reference/api-{parameters,methods}/{camelCaseName} onto features.

    Derived from the corpus, not hand-typed: each segment is split on camelCase
    and matched against the feature vocabulary's aliases. A parameter that
    matches nothing resolves to None and is dropped from the record — it still
    lands in the candidate queue, which is where the schema's gaps get reported.
    """
    alias_to_slug = {}
    for slug, meta in FEATURE.items():
        for term in [slug.replace("-", " ")] + list(meta.get("aliases", [])):
            alias_to_slug[term.strip().lower()] = slug

    segs = set()
    for r in recs:
        u = str(r.get("url", ""))
        m = re.search(r"/doc/api-reference/api-(?:parameters|methods)/([\w-]+)", u)
        if m:
            segs.add(m.group(1))

    out = {}
    for seg in sorted(segs):
        words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", seg).replace("-", " ").lower()
        hit = alias_to_slug.get(words)
        if not hit:
            # Try progressively shorter suffix/prefix phrases, longest first.
            toks = words.split()
            for n in range(len(toks), 0, -1):
                for i in range(len(toks) - n + 1):
                    cand = " ".join(toks[i:i + n])
                    if cand in alias_to_slug:
                        hit = alias_to_slug[cand]
                        break
                if hit:
                    break
        out[seg] = hit          # None = drop, and report as a candidate
    return out


def customer_vocabulary(recs):
    """Read /customers/* slugs off the live corpus and normalise them (R3).

    Returns (vocabulary, capture_aliases). The alias map is what lets a raw URL
    segment like "Gymshark-Headless" or "END." resolve to a canonical slug.
    """
    raw = collections.Counter()
    for r in recs:
        u = r["url"].strip()
        if u.startswith("http"):
            if "www.algolia.com" not in u:
                continue
            u = "/" + "/".join(u.split("/")[3:])
        seg = [x for x in u.split("?")[0].strip("/").split("/") if x]
        if seg and seg[0] in ("en", "fr", "de"):
            seg = seg[1:]
        if len(seg) >= 2 and seg[0] == "customers":
            raw[seg[1]] += 1

    # Collapse per-page suffixes onto one brand: gymshark-headless and
    # gymshark-recommend are two pages about ONE customer.
    SUFFIXES = ("-headless", "-recommend", "-case-study")
    ALIAS = {"iu-health-trendyminds": "iu-health"}
    vocab, capture = {}, {}
    for slug, _ in raw.most_common():
        clean = slug
        for suf in SUFFIXES:
            if clean.endswith(suf):
                clean = clean[: -len(suf)]
        clean = ALIAS.get(clean, clean)
        clean = re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")
        if not clean:
            continue
        label = " ".join(w.capitalize() for w in clean.split("-"))
        entry = vocab.setdefault(clean, {"label": label, "aliases": []})
        for cand in {slug.lower(), clean.replace("-", " ")}:
            if cand not in entry["aliases"]:
                entry["aliases"].append(cand)
        # Raw URL segment -> canonical slug. Covers casing ("PetSmart"),
        # punctuation ("END."), and per-page suffixes ("gymshark-headless").
        if slug != clean:
            capture[slug] = clean
    return vocab, capture


def main():
    recs = [json.loads(l) for l in open(CORPUS, encoding="utf-8")]
    customer, customer_capture = customer_vocabulary(recs)
    capture_aliases = {k: dict(v) for k, v in CAPTURE_ALIASES.items()}
    capture_aliases["customer"] = customer_capture
    api_map = api_parameter_aliases(recs)
    capture_aliases.setdefault("feature", {}).update(api_map)
    hit = sum(1 for v in api_map.values() if v)
    print(f"  api-parameter -> feature: {hit}/{len(api_map)} segments mapped")

    schema = {
        "version": VERSION,
        "target_index": "Algolia_Prod_Copy_Enhanced",
        "generated_from": CORPUS,
        "record_count": len(recs),
        "owner": None,  # MUST be filled before this ships — see METHODOLOGY.md
        "revalidate_on": "Algolia product launch or rename",
        "contract": {
            "cardinality": "one ordered array per tag axis; element 0 is the primary",
            "ordering": "URL-derived value first, then legacy-field matches, then text matches by descending evidence",
            "empty_states": {
                "resolved": "the value",
                "not_applicable": "field omitted entirely — never 'unknown'",
                "undetermined": "'unknown'",
            },
            "never": ["null", "None", "", "N/A"],
            "slug_form": "lowercase-hyphenated",
        },
        "axes": AXES,
        "vocabularies": {
            "product": PRODUCT,
            "feature": FEATURE,
            "solution": SOLUTION,
            "industry": INDUSTRY,
            "customer": customer,
            "language_platform": LANGUAGE_PLATFORM,
            "integration_platform": INTEGRATION_PLATFORM,
            "page_type": {v: {"label": v.replace("-", " ").title(), "aliases": []} for v in PAGE_TYPE},
        },
        "url_rules": URL_RULES,
        "capture_aliases": capture_aliases,
        "field_rules": FIELD_RULES,
        "list_field_rules": LIST_FIELD_RULES,
        "text_matching": {
            "fields": TEXT_FIELDS,
            "generic_terms_url_only": GENERIC_TERMS,
            "url_or_field_only": {k: sorted(set(URL_OR_FIELD_ONLY.get(k, [])) |
                                            set(COMMON_WORD_VALUES.get(k, [])))
                                  for k in set(URL_OR_FIELD_ONLY) | set(COMMON_WORD_VALUES)},
            "min_evidence": MIN_TEXT_EVIDENCE,
            "blocklist": BLOCKLIST,
        },
        "gates": {
            "max_value_share": 0.40,
            "min_value_share": 0.001,
            "per_axis_precision": {
                "page_type": 0.98, "language_platform": 0.98, "integration_platform": 0.95,
                "customer": 0.95, "industry": 0.85, "solution": 0.80,
                "feature": 0.75, "product": 0.70,
            },
        },
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)

    print(f"wrote {OUT}")
    for axis, v in schema["vocabularies"].items():
        print(f"  {axis:22s} {len(v):>4} values")
    print(f"  url_rules              {len(URL_RULES):>4}")
    print(f"  field_rules            {sum(len(r['map']) for r in FIELD_RULES):>4} mappings")


if __name__ == "__main__":
    main()
