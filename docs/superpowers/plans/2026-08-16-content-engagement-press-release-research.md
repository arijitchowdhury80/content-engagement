# Content Engagement Press Release Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch the 30 most recent Algolia.com press releases with Scout, extract their structure into a sourced corpus table, and produce the Algolia press-release structure we will use before drafting Content Engagement copy.

**Architecture:** Use Scout as the only live page fetcher. Store one compact research run with raw Scout JSON, extracted markdown, a corpus table, a structural analysis, and a press-release structure/rubric. Drafting starts only after the structure is reviewed and approved.

**Tech Stack:** Scout CLI, Node.js or shell for local artifact normalization, Markdown, CSV/JSON, SHA-256 checksums.

**Spec:** User request from 2026-08-16 plus project context in `docs/program/vision.md` and canonical testing contract `testing/2026-08-15-proactive-concierge-e2e-test-system.md`.

## Global Constraints

- Content Engagement is the business thesis.
- The internal parallel Algolia.com environment is the proving ground.
- Production Algolia.com is the intended final execution after promotion gates are earned.
- Testing provides the evidence.
- The demo provides the narrative.
- Documentation provides the durable explanation.
- The press release provides the external articulation.
- Do not say production Algolia.com is the proving ground.
- Use Scout for live Algolia.com press-release fetches.
- Do not use or cite the removed `~/.claude/prompt-library` testing-contract path.
- Do not modify runtime code, Agent Studio, Jahia, production Algolia.com, or the test system.
- Do not draft the release until the 30-release structure and writing rubric are complete.
- Do not invent metrics, outcomes, customers, dates, launch status, or executive quotes.
- Keep artifacts minimal: one run folder, one corpus table, one structure analysis, one drafting structure.

---

## File Structure

Create one research run folder:

```text
docs/research/content-engagement-press-release/2026-08-16/
  README.md
  source-selection.json
  press-release-corpus.csv
  press-release-corpus.json
  scout/
    raw/
    markdown/
    checksums.sha256
  analysis/
    structure-analysis.md
    algolia-press-release-structure.md
    writing-rubric.md
    content-questions.md
```

Responsibilities:

- `README.md`: run purpose, constraints, commands, verification summary.
- `source-selection.json`: the 30 selected releases, sorted most recent to oldest, with selection evidence.
- `press-release-corpus.csv`: human-readable table for Arijit.
- `press-release-corpus.json`: structured version for analysis and later verification.
- `scout/raw/*.json`: exact Scout scrape payloads.
- `scout/markdown/*.md`: extracted markdown from each Scout payload.
- `scout/checksums.sha256`: hashes for raw and markdown files.
- `analysis/structure-analysis.md`: what the 30 releases reveal about Algolia's press-release patterns.
- `analysis/algolia-press-release-structure.md`: the canonical structure we will use for this release.
- `analysis/writing-rubric.md`: rules for voice, claims, quotes, evidence, boilerplate, CTA, and prohibited moves.
- `analysis/content-questions.md`: questions to answer before drafting Content Engagement content.

---

### Task 1: Initialize The Research Run

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/README.md`
- Create: `docs/research/content-engagement-press-release/2026-08-16/scout/raw/.gitkeep`
- Create: `docs/research/content-engagement-press-release/2026-08-16/scout/markdown/.gitkeep`
- Create: `docs/research/content-engagement-press-release/2026-08-16/analysis/.gitkeep`

**Interfaces:**
- Consumes: project framing in `docs/program/vision.md` and `testing/2026-08-15-proactive-concierge-e2e-test-system.md`.
- Produces: a single canonical artifact folder for the rest of the work.

- [ ] **Step 1: Confirm Scout is available**

Run:

```bash
command -v scout
scout --help | sed -n '1,80p'
```

Expected: `scout` resolves to an executable and lists commands including `map`, `crawl`, and `scrape`.

- [ ] **Step 2: Create run directories**

Run:

```bash
mkdir -p docs/research/content-engagement-press-release/2026-08-16/scout/raw
mkdir -p docs/research/content-engagement-press-release/2026-08-16/scout/markdown
mkdir -p docs/research/content-engagement-press-release/2026-08-16/analysis
touch docs/research/content-engagement-press-release/2026-08-16/scout/raw/.gitkeep
touch docs/research/content-engagement-press-release/2026-08-16/scout/markdown/.gitkeep
touch docs/research/content-engagement-press-release/2026-08-16/analysis/.gitkeep
```

Expected: the run folder exists and contains only research artifacts.

- [ ] **Step 3: Write the run README**

Add this content to `README.md`:

```markdown
# Content Engagement Press Release Research Run

Date: 2026-08-16

Purpose: Fetch and analyze the 30 most recent Algolia.com press releases using Scout, then derive the press-release structure and writing rubric for the Content Engagement external articulation.

Framing:
- Content Engagement is the business thesis.
- The internal parallel Algolia.com environment is the proving ground.
- Production Algolia.com is the intended final execution after promotion gates are earned.
- Testing provides evidence.
- The demo provides narrative.
- Documentation provides durable explanation.
- The press release provides external articulation.

Constraints:
- Scout is the only live page fetcher for the corpus.
- Do not draft the press release before structure approval.
- Do not invent metrics, outcomes, customers, dates, launch status, or quotes.
- Do not modify runtime code, Agent Studio, Jahia, production Algolia.com, or the test system.

Artifacts:
- source-selection.json
- press-release-corpus.csv
- press-release-corpus.json
- scout/raw/
- scout/markdown/
- scout/checksums.sha256
- analysis/structure-analysis.md
- analysis/algolia-press-release-structure.md
- analysis/writing-rubric.md
- analysis/content-questions.md
```

- [ ] **Step 4: Verify the run folder**

Run:

```bash
find docs/research/content-engagement-press-release/2026-08-16 -maxdepth 3 -type f | sort
```

Expected: `README.md` and three `.gitkeep` files are listed.

---

### Task 2: Discover And Select The 30 Most Recent Press Releases

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/source-selection.json`

**Interfaces:**
- Consumes: live Algolia.com URL discovery from Scout.
- Produces: a date-sorted list of exactly 30 canonical Algolia press-release URLs for Task 3.

- [ ] **Step 1: Discover candidate release URLs with Scout map**

Run the narrow patterns first:

```bash
scout map https://www.algolia.com --pages 1000 --pattern /about/news/ > /tmp/algolia-news-map.json
scout map https://www.algolia.com --pages 1000 --pattern /press/ > /tmp/algolia-press-map.json
scout map https://www.algolia.com --pages 1000 --pattern /news/ > /tmp/algolia-generic-news-map.json
```

Expected: at least one output contains Algolia.com news or press-release URLs.

- [ ] **Step 2: If narrow discovery finds fewer than 30 press releases, crawl likely index pages**

Run:

```bash
scout crawl https://www.algolia.com --depth 2 --pages 200 --pattern news --js --timeout 60000 > /tmp/algolia-news-crawl.json
scout crawl https://www.algolia.com --depth 2 --pages 200 --pattern press --js --timeout 60000 > /tmp/algolia-press-crawl.json
```

Expected: enough candidate URLs exist to identify at least 30 press releases.

- [ ] **Step 3: Build candidate list**

Extract candidate URLs from Scout outputs and keep only `https://www.algolia.com/` URLs that are press releases or newsroom announcements. Exclude blog posts, customer stories, docs, pricing pages, product pages, webinars, and event listings unless Algolia presents them as a press release.

Selection fields for each candidate:

```json
{
  "candidate_url": "https://www.algolia.com/...",
  "selection_source": "/tmp/algolia-news-map.json",
  "selection_reason": "Algolia.com news or press-release URL",
  "status": "candidate"
}
```

- [ ] **Step 4: Scout-scrape candidate pages only as needed for dates and canonical URLs**

For each candidate that may be in the top 30, run:

```bash
scout scrape "$URL" --js --timeout 45000 > "/tmp/algolia-release-candidate-$N.json"
```

Expected: each candidate scrape includes markdown and metadata sufficient to extract headline, date, and canonical or served URL.

- [ ] **Step 5: Sort by publication date descending and choose 30**

Create `source-selection.json` with this shape:

```json
{
  "schema": "AlgoliaPressReleaseSourceSelection.v1",
  "generated_at": "2026-08-16T00:00:00Z",
  "selection_rule": "30 most recent Algolia.com press releases discovered live with Scout, sorted by publication date descending",
  "excluded_rule": "Exclude non-press-release pages even if they appear in news discovery",
  "sources": [
    {
      "rank": 1,
      "canonical_url": "https://www.algolia.com/...",
      "served_url": "https://www.algolia.com/...",
      "headline": "Headline from page",
      "publication_date": "YYYY-MM-DD",
      "date_evidence": "Page date text or metadata field",
      "selection_source": "Scout map/crawl/scrape file",
      "notes": "Included as press release"
    }
  ],
  "excluded_candidates": [
    {
      "url": "https://www.algolia.com/...",
      "reason": "Blog post, customer story, event, duplicate, or older than selected 30"
    }
  ]
}
```

The final `sources` array must contain exactly 30 items.

- [ ] **Step 6: Verify selection quality**

Run:

```bash
node -e '
const fs = require("fs");
const p = "docs/research/content-engagement-press-release/2026-08-16/source-selection.json";
const data = JSON.parse(fs.readFileSync(p, "utf8"));
if (data.sources.length !== 30) throw new Error(`Expected 30 sources, got ${data.sources.length}`);
const urls = new Set(data.sources.map(s => s.canonical_url));
if (urls.size !== 30) throw new Error("Duplicate canonical_url values found");
for (const s of data.sources) {
  if (!s.canonical_url.startsWith("https://www.algolia.com/")) throw new Error(`Non-Algolia URL: ${s.canonical_url}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.publication_date)) throw new Error(`Bad date for ${s.canonical_url}`);
}
const dates = data.sources.map(s => s.publication_date);
const sorted = [...dates].sort().reverse();
if (dates.join("\n") !== sorted.join("\n")) throw new Error("Sources are not sorted newest to oldest");
console.log("PASS source-selection: 30 unique Algolia.com press releases sorted newest to oldest");
'
```

Expected: `PASS source-selection: 30 unique Algolia.com press releases sorted newest to oldest`.

---

### Task 3: Fetch The 30 Selected Releases With Scout

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/scout/raw/*.json`
- Create: `docs/research/content-engagement-press-release/2026-08-16/scout/markdown/*.md`
- Create: `docs/research/content-engagement-press-release/2026-08-16/scout/checksums.sha256`

**Interfaces:**
- Consumes: `source-selection.json`.
- Produces: exact Scout payloads and markdown for Task 4 and Task 5.

- [ ] **Step 1: Fetch each selected release**

For each selected release, run:

```bash
node - <<'NODE'
const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const root = "docs/research/content-engagement-press-release/2026-08-16";
const selection = JSON.parse(fs.readFileSync(`${root}/source-selection.json`, "utf8"));

function slug(rank, url) {
  const pathname = new URL(url).pathname.replace(/^\/|\/$/g, "");
  const clean = pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${String(rank).padStart(2, "0")}-${clean || "release"}`;
}

for (const source of selection.sources) {
  const name = slug(source.rank, source.canonical_url);
  const rawPath = path.join(root, "scout", "raw", `${name}.json`);
  const mdPath = path.join(root, "scout", "markdown", `${name}.md`);
  console.error(`Scout fetching ${source.rank}: ${source.canonical_url}`);
  const proc = spawnSync("scout", ["scrape", source.canonical_url, "--js", "--timeout", "45000"], {
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024
  });
  if (proc.status !== 0) {
    throw new Error(`Scout failed for ${source.canonical_url}: ${proc.stderr || proc.stdout}`);
  }
  const marker = "{\n  \"success\"";
  const start = proc.stdout.indexOf(marker);
  if (start === -1) throw new Error(`Scout output did not include JSON for ${source.canonical_url}`);
  const payload = JSON.parse(proc.stdout.slice(start));
  fs.writeFileSync(rawPath, JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(mdPath, String(payload.markdown || "") + "\n");
}
NODE
```

Expected: 30 raw JSON files and 30 markdown files are created.

- [ ] **Step 2: Validate every Scout payload**

Run:

```bash
node - <<'NODE'
const fs = require("fs");
const path = require("path");

const root = "docs/research/content-engagement-press-release/2026-08-16";
const rawDir = path.join(root, "scout", "raw");
const files = fs.readdirSync(rawDir).filter(f => f.endsWith(".json")).sort();
if (files.length !== 30) throw new Error(`Expected 30 raw files, got ${files.length}`);
for (const file of files) {
  const payload = JSON.parse(fs.readFileSync(path.join(rawDir, file), "utf8"));
  if (payload.success !== true) throw new Error(`${file}: Scout success was not true`);
  if (!payload.markdown || payload.markdown.length < 1000) throw new Error(`${file}: markdown too short`);
  if (!payload.url || !String(payload.url).includes("algolia.com")) throw new Error(`${file}: served URL missing or not Algolia`);
}
console.log("PASS scout payloads: 30 successful Algolia.com markdown captures");
NODE
```

Expected: `PASS scout payloads: 30 successful Algolia.com markdown captures`.

- [ ] **Step 3: Record checksums**

Run:

```bash
cd docs/research/content-engagement-press-release/2026-08-16
find scout/raw scout/markdown -type f \( -name '*.json' -o -name '*.md' \) -print0 | sort -z | xargs -0 shasum -a 256 > scout/checksums.sha256
cd -
```

Expected: `scout/checksums.sha256` contains 60 file hashes.

---

### Task 4: Build The Corpus Table

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/press-release-corpus.csv`
- Create: `docs/research/content-engagement-press-release/2026-08-16/press-release-corpus.json`

**Interfaces:**
- Consumes: `source-selection.json`, `scout/raw/*.json`, and `scout/markdown/*.md`.
- Produces: a table Arijit can review and a structured corpus for analysis.

- [ ] **Step 1: Extract structured fields**

For every release, capture:

```text
rank
canonical_url
served_url
headline
publication_date
subtitle_or_deck
dateline
lead_paragraph_summary
announcement_type
body_section_sequence
quote_count
quote_speakers
quote_roles
customer_or_partner_mentions
product_or_capability_mentions
proof_types
metrics_claimed
cta_text
cta_url
boilerplate_present
contact_footer_present
source_raw_file
source_markdown_file
scout_captured_at
notes
```

Proof-type vocabulary:

```text
customer_quote
executive_quote
partner_quote
analyst_award
survey_or_report
product_capability
funding_or_financial
event_or_conference
customer_metric
platform_integration
market_trend
no_quantified_proof
```

- [ ] **Step 2: Write CSV and JSON**

Create `press-release-corpus.csv` with one header row and exactly 30 data rows.

Create `press-release-corpus.json` with this shape:

```json
{
  "schema": "AlgoliaPressReleaseCorpus.v1",
  "generated_at": "2026-08-16T00:00:00Z",
  "source_count": 30,
  "records": [
    {
      "rank": 1,
      "canonical_url": "https://www.algolia.com/...",
      "served_url": "https://www.algolia.com/...",
      "headline": "Headline",
      "publication_date": "YYYY-MM-DD",
      "subtitle_or_deck": "Deck text or empty string",
      "dateline": "Dateline text or empty string",
      "lead_paragraph_summary": "One-sentence factual summary",
      "announcement_type": "product|partnership|customer|award|funding|report|event|leadership|other",
      "body_section_sequence": ["headline", "deck", "date", "lead", "context", "quote", "proof", "quote", "cta", "boilerplate", "contact"],
      "quote_count": 2,
      "quote_speakers": ["Name"],
      "quote_roles": ["Title"],
      "customer_or_partner_mentions": ["Company"],
      "product_or_capability_mentions": ["Capability"],
      "proof_types": ["executive_quote", "product_capability"],
      "metrics_claimed": ["Exact metric text or empty array"],
      "cta_text": "CTA text or empty string",
      "cta_url": "CTA URL or empty string",
      "boilerplate_present": true,
      "contact_footer_present": true,
      "source_raw_file": "scout/raw/...",
      "source_markdown_file": "scout/markdown/...",
      "scout_captured_at": "timestamp from payload or file creation",
      "notes": "Short evidence note"
    }
  ]
}
```

- [ ] **Step 3: Verify table completeness**

Run:

```bash
node - <<'NODE'
const fs = require("fs");
const root = "docs/research/content-engagement-press-release/2026-08-16";
const corpus = JSON.parse(fs.readFileSync(`${root}/press-release-corpus.json`, "utf8"));
if (corpus.source_count !== 30) throw new Error(`source_count must be 30, got ${corpus.source_count}`);
if (corpus.records.length !== 30) throw new Error(`records must be 30, got ${corpus.records.length}`);
const required = ["rank","canonical_url","served_url","headline","publication_date","announcement_type","body_section_sequence","quote_count","proof_types","source_raw_file","source_markdown_file"];
for (const record of corpus.records) {
  for (const key of required) {
    if (record[key] === undefined || record[key] === null || record[key] === "") throw new Error(`Missing ${key} for rank ${record.rank}`);
  }
  if (!fs.existsSync(`${root}/${record.source_raw_file}`)) throw new Error(`Missing raw file for rank ${record.rank}`);
  if (!fs.existsSync(`${root}/${record.source_markdown_file}`)) throw new Error(`Missing markdown file for rank ${record.rank}`);
}
const csvLines = fs.readFileSync(`${root}/press-release-corpus.csv`, "utf8").trim().split(/\r?\n/);
if (csvLines.length !== 31) throw new Error(`CSV must have 31 lines including header, got ${csvLines.length}`);
console.log("PASS corpus table: 30 complete records with source files");
NODE
```

Expected: `PASS corpus table: 30 complete records with source files`.

---

### Task 5: Analyze Algolia Press-Release Structure

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/analysis/structure-analysis.md`

**Interfaces:**
- Consumes: `press-release-corpus.json` and all markdown files.
- Produces: sourced findings about Algolia press-release conventions.

- [ ] **Step 1: Read all 30 markdown files**

Read the markdown files from newest to oldest and annotate:

```text
Opening formula:
Headline construction:
Deck construction:
Lead paragraph role:
Second paragraph role:
Quote placement:
Proof placement:
Business-value phrasing:
Product/capability phrasing:
Customer/partner evidence:
CTA style:
Boilerplate/contact pattern:
One-off editorial choices:
```

- [ ] **Step 2: Separate stable conventions from one-offs**

Use this rule:

```text
Stable convention: appears in at least 18 of 30 releases, or appears across at least 4 different announcement types.
Common option: appears in 8 to 17 releases.
One-off choice: appears in 1 to 7 releases and is tied to a specific announcement type, event, or editorial context.
```

- [ ] **Step 3: Write `structure-analysis.md`**

Use this outline:

```markdown
# Algolia Press Release Structure Analysis

## Corpus

- Source count: 30
- Date range: YYYY-MM-DD to YYYY-MM-DD
- Selection rule: 30 most recent Algolia.com press releases discovered live with Scout
- Source table: ../press-release-corpus.csv

## Stable Conventions

| Convention | Evidence Count | Source Ranks | Notes |
|---|---:|---|---|

## Common Options

| Pattern | Evidence Count | Source Ranks | Best Use |
|---|---:|---|---|

## One-Off Editorial Choices

| Pattern | Source Rank | Why It Is One-Off |
|---|---:|---|

## Voice And Style

## Announcement Framing

## Quote Patterns

## Proof Standards

## Business-Value Language

## CTA And Boilerplate Pattern

## Implications For Content Engagement

## Risks For Our Draft
```

- [ ] **Step 4: Verify sourcing density**

Run a manual check:

```text
Every stable convention must cite source ranks.
Every writing implication must trace back to at least one stable convention or common option.
Every statement about metrics must quote exact metric text in press-release-corpus.json, not memory.
```

Expected: no unsourced structural claim remains.

---

### Task 6: Create The Algolia Press-Release Structure

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/analysis/algolia-press-release-structure.md`

**Interfaces:**
- Consumes: `structure-analysis.md`.
- Produces: the page structure we will use before thinking through Content Engagement content.

- [ ] **Step 1: Write the reusable structure**

Use this outline:

```markdown
# Algolia Press Release Structure For Content Engagement

## Recommended Structure

1. Headline
2. Subtitle or deck
3. Dateline and release date
4. Lead paragraph
5. Market or customer problem paragraph
6. Algolia thesis paragraph
7. Executive quote 1
8. Product or experience detail paragraph
9. Evidence paragraph
10. Customer, partner, or sponsor quote slot
11. Conversion or availability paragraph
12. CTA
13. About Algolia boilerplate
14. Media contact footer

## Section Rules

## What Each Section Must Prove

## Allowed Claim Types

## Claims Requiring Test Evidence

## Claims Requiring Executive Approval

## Placeholder Slots For Later Content

## Anti-Patterns To Avoid
```

- [ ] **Step 2: Define section rules**

Each section must include:

```text
Purpose:
Algolia convention source:
Allowed content:
Forbidden content:
Evidence required:
Drafting note:
```

- [ ] **Step 3: Mark future content slots clearly**

Use bracketed slots only for future content decisions:

```text
[ARJIT/Piyush-approved quote slot]
[test-evidence-backed claim slot]
[demo narrative slot]
[documentation-backed explanation slot]
[CTA slot]
```

The structure can contain slots. It must not contain draft release prose.

- [ ] **Step 4: Verify no draft prose slipped in**

Run:

```bash
rg -n "announced today|launches|unveiled|said Arijit|said Piyush|customers can now|available today" docs/research/content-engagement-press-release/2026-08-16/analysis/algolia-press-release-structure.md
```

Expected: no matches unless they appear inside an explicitly labeled anti-pattern example.

---

### Task 7: Create The Writing Rubric

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/analysis/writing-rubric.md`

**Interfaces:**
- Consumes: corpus table, structure analysis, and recommended structure.
- Produces: writing rules for the later press-release draft.

- [ ] **Step 1: Write voice rules**

Cover:

```text
Headline voice
Deck voice
Lead paragraph compression
Quote style
Business-value vocabulary
Product detail depth
Proof and evidence rules
CTA style
Boilerplate handling
```

- [ ] **Step 2: Write claim-control rules**

Include these rules:

```text
No metric unless sourced from test findings, Algolia-owned documentation, or the 30-release corpus.
No launch status unless explicitly approved.
No customer claim unless a customer is named in approved source material.
No quote unless speaker, role, and quote text are approved.
No production-Algolia.com claim unless promotion through testing has happened or the text clearly says intended destination.
No broad category claim unless supported by evidence or framed as thesis.
```

- [ ] **Step 3: Write approval rules**

Include:

```text
Arijit approves business thesis and founder quote.
Piyush approves sponsor framing and sponsor quote.
Testing evidence gates any performance, quality, conversion, or production-readiness claim.
Brand/factual verification runs before the draft is called ready.
```

- [ ] **Step 4: Verify rubric covers every planned section**

Run a manual check against `algolia-press-release-structure.md`.

Expected: every section has a corresponding rule for voice, evidence, and approval.

---

### Task 8: Create Content Questions Before Drafting

**Files:**
- Create: `docs/research/content-engagement-press-release/2026-08-16/analysis/content-questions.md`

**Interfaces:**
- Consumes: recommended structure and writing rubric.
- Produces: the questions Arijit must answer before content drafting begins.

- [ ] **Step 1: Write the questions**

Use these categories:

```markdown
# Content Questions Before Drafting

## Announcement Posture

## Audience

## Business Thesis

## Product Experience

## Internal Parallel Environment

## Testing Evidence

## Demo Narrative

## Documentation Narrative

## Production Destination

## Quote Approvals

## CTA

## Claims We Are Not Allowed To Make Yet
```

- [ ] **Step 2: Include exact decision questions**

Required questions:

```text
Is this release an internal mock, embargo-style draft, or external launch-style draft?
Should the headline say Content Engagement, Concierge, or another category name?
What is the target audience: Algolia executives, customers, analysts, partners, or internal stakeholders?
What proof from testing is already available, and what is still pending?
What demo moment best carries the narrative?
What documentation page should be treated as durable explanation?
Is production Algolia.com described as a future destination or omitted until promotion?
Who is allowed to be quoted?
What CTA is allowed?
Which claims are off-limits until testing is complete?
```

- [ ] **Step 3: Verify the questions do not draft content**

Run:

```bash
rg -n "Algolia announced|Algolia launches|Content Engagement enables|said" docs/research/content-engagement-press-release/2026-08-16/analysis/content-questions.md
```

Expected: no matches.

---

### Task 9: Review Package And Approval Gate

**Files:**
- Modify: `docs/research/content-engagement-press-release/2026-08-16/README.md`

**Interfaces:**
- Consumes: all prior artifacts.
- Produces: a concise review packet and explicit approval gate before drafting.

- [ ] **Step 1: Update README with verification results**

Add:

```markdown
## Verification

- Source selection: PASS or FAIL with command output.
- Scout payloads: PASS or FAIL with command output.
- Corpus table: PASS or FAIL with command output.
- Structure analysis: PASS or FAIL with reviewer notes.
- Drafting gate: WAITING FOR ARIJIT APPROVAL.
```

- [ ] **Step 2: Prepare Arijit review summary**

Summarize:

```text
1. Date range of 30 releases.
2. Most common announcement types.
3. Stable Algolia press-release structure.
4. Quote patterns.
5. Proof standards.
6. Business-value language.
7. Recommended Content Engagement structure.
8. Questions blocking content drafting.
```

- [ ] **Step 3: Stop before drafting**

Completion gate:

```text
Do not write the Content Engagement press release until Arijit approves:
1. source-selection.json,
2. press-release-corpus.csv,
3. structure-analysis.md,
4. algolia-press-release-structure.md,
5. writing-rubric.md,
6. content-questions.md.
```

Expected: the next conversation is about content decisions, not first-draft prose.

---

## Definition Of Done

- Exactly 30 most recent Algolia.com press releases are selected and sorted newest to oldest.
- All 30 pages are fetched with Scout.
- Raw Scout payloads and markdown are preserved.
- Checksums are recorded.
- The corpus table contains 30 complete rows.
- Structure analysis distinguishes stable conventions, common options, and one-offs.
- The recommended press-release structure is created before content.
- The writing rubric blocks unsupported claims.
- Content questions are ready for Arijit.
- No press-release draft prose is created during this plan.

## Execution Choice

Plan execution should use one of two paths:

1. **Subagent-Driven (recommended)**: dispatch a fresh worker for source discovery/fetch, a second for corpus extraction, and a third for structural analysis, with review between tasks.
2. **Inline Execution**: execute the tasks in this session with checkpoints after source selection, after Scout fetch, after corpus table, and after structure analysis.
