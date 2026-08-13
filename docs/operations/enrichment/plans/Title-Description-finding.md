# Handoff: title/description finding + press-release enrichment session

Written 2026-08-11, end of session, for resume in a fresh chat with zero prior context.
Everything below is verified against real data/code as stated — flagged clearly where something
is confirmed vs. still a hypothesis I couldn't nail down.

## What this session was doing

Running the `algolia-data-enrichment` skill (`skills/algolia-data-enrichment/` in this
repo, `algolia-com`) against two real content slices: `Website/press-release` (690 records) and
`Customer Stories/case-study` (237 records, from an earlier part of the session). Goal was to get
both slices through the full pipeline (`plan-slice → fetch → enrich → repair → build-final →
validate → review-pack → write`) and written to the parallel proving-ground index
(`Algolia_Prod_Copy_Enhanced_Parallel`, v0 scope — this index is not queried by production search).

## CONFIRMED, verified findings

### 1. Case Studies (225 records) — genuinely clean, already written, verified live
- Written to `Algolia_Prod_Copy_Enhanced_Parallel`, `verify-live` PASS: 225/225 byte-exact match,
  search-findable.
- An earlier claim this session that 12 of 225 had boilerplate leaks was **wrong** — caused by a
  bug in my own verification script (`re.IGNORECASE` also makes the `[A-Z]` character class match
  lowercase, so it was flagging the ordinary German word "über" as if it were the "Über Algolia"
  heading). Re-checked properly: **0 of 225 have any boilerplate leak.**

### 2. Press-release boilerplate leak — real, found, fixed, verified (but see caveat in §4)
- Profile `scripts/profiles/Website__press-release.yaml` originally banned `"^About Algolia"` etc.
  (English only, anchored to start of the candidate text).
- Found two real gaps by hand-reading actual leaked records:
  1. Company-specific: `"À propos de Breville"` (a *customer's* own boilerplate, not Algolia's) —
     the ban only named Algolia.
  2. Structural: the candidate splitter sometimes fuses a CTA sentence onto the boilerplate
     paragraph with no period between them (`"...visit https://x.com/partners About Algolia:
     Algolia is..."`), so the boilerplate is never at position 0 of the merged candidate and a
     `^`-anchored pattern can never match it.
- Fixed: broadened `forbidden_patterns` in the YAML to be company-agnostic and unanchored (matches
  anywhere in the candidate, not just its start) for the boilerplate/contact/forward-looking bans.
  Datelines stayed anchored (lower risk, structurally sit at candidate start).
- **Verified twice**: (a) directly tested the new regex against the 3 real leaked strings found by
  hand — all 3 now match, 2 legitimate control sentences correctly don't; (b) ran a **fresh** pilot
  (30 records, current profile) end to end — **0 boilerplate leaks**, confirmed by direct text
  search across the run's real output, not a sample.
- Also attempted a second fix: checking `cand.section` (the heading a candidate falls under)
  against the same patterns, so the *whole* boilerplate block gets banned by position, not just
  sentences containing the trigger phrase. **This does NOT work** — verified directly against a
  real page: "**Über Algolia**" in the source markdown is bold emphasis, not a real `##` heading,
  so the splitter never treats it as a section boundary, and the heading text itself is under the
  25-char minimum so it never even becomes its own candidate. `cand.section` for the boilerplate
  sentence returns the *article's own headline*, not "Über Algolia". The edit is still in
  `filters.py` (harmless, doesn't break anything, 186/186 tests still pass) but it does not solve
  this case. **A real fix needs a raw-text-position-based exclusion in `candidates.py`
  (`split_candidates`), not a candidate-level pattern check** — not built, needs a design decision
  first (it's a shared module every profile depends on).

### 3. Title vs. description — verified against the FULL source index (11,928 records, no sampling)
- **Title: 100.0% real content, every single record, zero exceptions.** An earlier claim this
  session that titles were `None` was **wrong** — caused by checking `results.jsonl`, which never
  persists a `title` field in its output rows at all, regardless of what the judge actually
  received at runtime. Directly rendered the real judge prompt for 3 records and confirmed the
  judge genuinely receives the real title (e.g. `"Algolia Introduces 'Shopping Guides': A
  Generative AI Tool to Elevate the Online Shopping Experience"`), not "None".
- **Description: 85.7% real, 14.3% missing/placeholder** (7.9% empty string, 6.3% literal `"…"`
  placeholder character, 0.1% truly null). This is a **real, bounded, source-data fact**, not a
  pipeline bug — verified against every one of the 11,928 records in `Algolia_Prod_Copy_Enhanced`.
  Breakdown by content family:
  ```
  source/page_type                    total   no-description   %
  Website/press-release                 690        401        58.1%
  Blog/blog-post                       2,694        887        32.9%
  Resources/resource                     835        291        34.9%
  Documentation/doc-rest-api             333         23         6.9%
  Customer Stories/case-study            237          7         3.0%
  Documentation/doc-guide                586          6         1.0%
  ```
  Also documented in `docs/customer-documentation/enrichment/chapter-3-content-enrichment.md` §13.5
  (that file's frontmatter links to a live Asana task, GID `1217211621995392` — see §6 below on
  why that push never happened).
- **Implication, not yet built:** any judge criterion that compares an abstract against
  `description` cannot assume it exists. For `Website/press-release`, `Blog/blog-post`, and
  `Resources/resource` — the three families with a real gap — generating/backfilling a usable
  description needs to become part of the enrichment scope for those records. `Customer
  Stories/case-study` and `Documentation/doc-guide` don't have this problem.

### 4. `information_gain` judge criterion — root cause partially found, NOT fully explained (be honest about this on resume)
- **Confirmed in code**: `pipeline.py:226`, function `judge_quality_failures()` — a single
  hardcoded floor of `4` applies identically to all 5 judge criteria on every profile. No
  per-criterion, no per-profile override exists. (This is distinct from the *separate*,
  already-per-profile-configurable deterministic pool gate `information_gain_minimum` — the judge
  floor and the pool-gate minimum are two different mechanisms that happen to share a name.)
- **Confirmed in the prompt** (`model_io.py`, `JUDGE_PROMPT`): the `information_gain` criterion's
  own instruction text says *"This is the dominant failure mode on case studies and reference
  pages"* — i.e. it was written/calibrated with those content types in mind, not press-release.
- **Confirmed by measurement**: on the full 690-record press-release run, 283 of 291
  human-review-routed records (97%) failed *only* on `information_gain` scoring below the floor,
  and the judge's own overall verdict was `PASS` on 281 of those 291 (96.6%) — the floor override
  on one sub-score, not the judge's holistic opinion, is what's blocking them. Human-review rate:
  ~44% on press-release vs. ~1.3% on case-study.
- **NOT confirmed — I reversed myself three times trying to explain *why*, and each theory broke
  under direct testing:**
  1. First theory: PR descriptions are already comprehensive so abstracts inevitably restate them
     → **disproven**: checked real records, `title=None, description=None` (this was actually the
     `results.jsonl`-doesn't-persist-these-fields artifact from §3, not real).
  2. Second theory (after finding titles ARE real): titles are themselves rich/complete
     ("Algolia Introduces X: A Y Tool to Z") so abstracts restate the title → **partially holds**
     for 2 of 3 samples checked, but breaks on the third: a record whose abstract adds a real,
     specific, quantified fact the title doesn't contain (1,005% growth, $110M funding) still
     scored the worst possible `1`.
  3. **The actual blocker**: the judge prompt never asks the model to explain its score — it's
     `{"information_gain": 1}`, no reasoning field returned, by design. There is no stored "why" to
     retrieve after the fact from data alone; the model's real reasoning is a black box from output
     data. **Proposed but not done**: temporarily add a `"reasoning"` text field to the judge's
     response schema and re-run a handful of real records to see what the model says its own
     reasoning is. This is the actual next diagnostic step, not another theory from outside.
- **What I do have, without a full mechanistic explanation**: a clean, directly-measured
  behavioral fact — same judge model, same broken-or-not metadata, wildly different pass rate by
  profile (1.3% vs ~44%). That alone is enough precedent (this project already made the *pool-gate*
  version of information_gain per-profile-configurable for the same reason: measured behavior, not
  a fully-explained mechanism) to justify making the *judge floor* configurable per profile too —
  but Arijit has not yet decided to do this, and I should not build it without that decision, given
  his explicit instruction this session to find the real root cause rather than patch a threshold.

### 5. Full 690-record press-release run: real result, not written
- Two full-slice attempts, run ID `20260811-website-press-release-a02` (stale profile, pre-fix)
  and pilot `20260811-website-press-release-pilot-a04` (current profile, post-fix, 30 records).
- Both: `validate` **FAILED** — writable coverage ~56% (need 85%), human-review ~43-44% (cap 5%).
  Grounding and quality gates (leakage/chrome/incomplete/duplicates) are clean in both.
- The boilerplate fix (§2) is real and confirmed working, but it was never the dominant driver of
  the coverage failure — `information_gain` (§4) is, and that's still open.
- **Nothing has been written anywhere for press-release.** `write: NONE` in every attempt — the
  CLI structurally cannot reach the write path until `validate` passes.

### 6. GitHub secret-scanning alerts — investigated, NOT resolved (still open on GitHub)
Repo `arijitchowdhury80/content-engagement` (this repo, public) has 2 open alerts:
- MongoDB Atlas URI (`mongodb+srv://readonly:readonly@covid-19.hip2i.mongodb.net/covid19`) —
  confirmed this is MongoDB's own publicly-published COVID-19 tutorial demo credential, not a real
  secret. File it was in no longer exists in `HEAD`.
- Google API Key (`GOOGLE_FONTS_API_KEY`, value starts `AIzaSyDIx0...`) — confirmed this belongs to
  WorkRamp (Algolia Academy's LMS vendor), embedded in their own site's public client-side JS, not
  ours to rotate. File it was in no longer exists in `HEAD`.
- **Attempted to resolve both via `gh api PATCH .../secret-scanning/alerts/{1,2}` — blocked by the
  session's own auto-mode permission classifier** (a visible external-state change). Never
  followed up after that block. **Both alerts are still open on GitHub right now.** Links:
  `https://github.com/arijitchowdhury80/content-engagement/security/secret-scanning/1` and `/2`.

### 7. Asana push — blocked, not done
- `docs/customer-documentation/enrichment/chapter-3-content-enrichment.md` §13.5 has the full write-up
  of the title/description finding (§3 above), committed to disk, not yet pushed to Asana.
- Its frontmatter links to Asana task GID `1217211621995392`.
- No live Asana MCP connection exists in this session (checked directly, zero Asana tools
  available) — Asana MCP was never OAuth-configured, per earlier session diagnosis (2026-08-10),
  confirmed still true now.
- `ASANA_PAT` exists in `.env.local` but is **not a working token** — 18 characters (real Asana
  PATs are much longer), fails even the basic `/users/me` identity check, not just permission on
  the specific task. Looks like a placeholder that was never filled in.
- **To actually push this**: either fix `ASANA_PAT` with a real token, or complete Asana MCP OAuth
  setup (Asana developer console → register Client ID/Secret → `claude mcp add`).

## Current repo state (algolia-com, branch `skill/algolia-corpus-enrichment`)

- Last commit: `264ebaa` (pushed to `origin/skill/algolia-corpus-enrichment` on GitHub).
- **Working tree has real uncommitted changes from TWO different sources, tangled together:**
  - Mine, this session: `scripts/algolia_enrichment/filters.py` (the section-check addition, §2),
    `scripts/profiles/Website__press-release.yaml` (the boilerplate fix, §2), plus
    `docs/customer-documentation/enrichment/chapter-3-content-enrichment.md` (§3 write-up).
  - **Someone/something else, concurrently, not me**: `algolia_enrich.py`, `algolia_enrichment/
    corpus.py, model_io.py, pipeline.py, selection_registry.py, validate/payload.py`, several
    `profiles/Documentation__*.yaml` files, new files `docs/USER-GUIDE.md` and
    `references/taxonomy-schema.algolia-com.json`, plus edits inside the
    `customer-stories-case-study-a02` run folder. A `Documentation/doc-sdk` slice (30 records) now
    also exists and reconciles — not something this session ran.
- `corpus-status` is currently **green** ("PASS: every live page_type is profiled or excluded, and
  every slice reconciles") — Blog 30/50 (True), Customer Stories 225/237 (True), Documentation/
  doc-sdk 30/0 (True), Website/press-release 690/0 (True, because 0 written and 0 claimed matches).
- Test suite: 186/186 passing as of the last check this session.
- **Do not blindly commit everything** on resume — the working tree mixes this session's verified
  work with unreviewed concurrent changes from another actor. Diff and separate before committing.

## Where to pick this up

1. Decide on the `information_gain` floor (§4) — either build the reasoning-field diagnostic
   experiment first, or decide to make the floor per-profile configurable on the measured-behavior
   evidence alone (Arijit's call, not mine to default).
2. Decide on the description-backfill scope (§3) — press-release, blog, resources.
3. Decide on the deeper candidate-splitting fix for boilerplate-by-section (§2) — real architecture
   change to `candidates.py`, shared by every profile.
4. Resolve the 2 GitHub secret-scanning alerts (§6) — safe to just mark resolved now, given the
   investigation is already done and documented here.
5. Fix `ASANA_PAT` or Asana MCP (§7) if the Asana push still matters.
6. Sort out the tangled uncommitted working tree (see above) before committing anything new.
