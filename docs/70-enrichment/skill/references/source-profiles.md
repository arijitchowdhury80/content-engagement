# Source profiles

Profiles are YAML in `scripts/profiles/`, named `Source__page-type.yaml`. The filename carries
both because profiles are keyed on `source/page_type` and `resource.yaml` cannot distinguish
`Resources/resource` from any future source sharing that page_type.

All profiles inherit from `base.yaml` and ship DELTAS ONLY. A delta REPLACES a list, it does not
append: a profile that names `forbidden_patterns` means exactly those patterns. Silent
accumulation is how a filter ends up taking a page's whole content.

## Routing

`_profile-map.yaml` maps every live `source/page_type` to a profile file, or names it excluded.
It is a run-local routing table, **never a taxonomy change**: no record's `source` or `page_type`
is modified and no new index label is created. `profile-lint` checks the map against a LIVE
census, because a profile set that covers 40 of 44 page_types is exactly as broken as one with a
syntax error, and much harder to notice.

## What a probe may and may not set

A bounded 10–25 record probe may set **qualitative** fields only:

    strategy, abstract_shape, dead_page_markers, shell_markers,
    forbidden_patterns, language_policy, duplicate_description_policy

It may **not** set a numeric threshold — `min_body_chars`, `judge_threshold`,
`abstract_span_count`, `highlight_count`, `max_span_distance`, `coverage_target_pct`,
`max_human_review_open_pct`. The measured noise band on this corpus is ±2 PASS at n=50, so a
threshold tuned on 25 records is a number invented to fit a sample. Numerics inherit until a
full-slice census supplies real ones. `profile_lint.probe_diff()` enforces this.

## The three that carry the most risk

**`Customer-Stories__case-study.yaml` — 237 records, 65% de/fr.**
The failure mode is information gain, not grounding: a case-study lede is almost always a
compressed restatement of the meta description. Without `duplicate_description_policy: ban` you
get 237 grounded, faithful, useless abstracts and every gate passes. ROI stat tiles (`+34%`) are
grounded and meaningless alone — require the surrounding sentence. Pull-quotes are banned rather
than captured, because attribution does not survive canonicalisation reliably.

**`Website__press-release.yaml`.**
"About Algolia" is the highest-scoring editorial-looking prose on the page and would become the
abstract on every record. Banned at the CANDIDATE layer — a record-level gate here would kill the
slice. The dateline is perfectly grounded and a terrible lede. Roughly half the text is quotes.

**`Documentation__reference.yaml` — 3,411 records, 78.6% of Documentation.**
`doc-sdk` alone is 2,203 records, 18% of the whole corpus; any Documentation plan that does not
name it has not looked at the data. `min_body_chars: 250` is low ON PURPOSE. `abstract_shape:
api_facts`, never `editorial_summary`. Highlights must be independently useful facts — an
operation, a constraint, a parameter with its meaning — never transport filler and never a code
fragment presented as prose.

## Language policy

`allow_known_english_body` appears on **Blog only**. The "de/fr serving English is acceptable"
ruling was measured at 100% of Blog and 0% of every other source; generalising it would enrich
German records with English text on sources that do serve German. Everything else is
`must_match_record`, and the census must prove it before enrichment rather than after.
