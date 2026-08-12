# Port spec: ACS 3-agent + judge architecture → Algolia.com

Status: DRAFT — 2 open decisions (Section 4) before any build step runs. App/index/keys/naming are now CONFIRMED against the live system, not assumed.

## 0. Scope (confirmed with Arijit, 2026-08-04)

- **Reused:** the architecture only — classifier→specialist handoff mechanism, judge corroboration gate, the provisioning-script *pattern*.
- **New:** agent identities + prompts adapted to Algolia.com's own content.
- **Correction (verified live, 2026-08-04):** this is NOT a separate Algolia app. `0EXRPAXB56` is ACS's own existing app — same one running `ACS-*`, the judge panel, and the proactive concierge. It also already hosts 43 other agents, including a pre-existing `www Chat` / `www Confidence` / `www Person` orchestrator+person-agent system (Sajid's architecture, unrelated to this port) — **left untouched, out of scope**. What's actually separate is the **index**: ACS uses `ACS_*`-prefixed indices/agents; this port uses its own indices and its own agent name prefix, same parent app.
- **Explicitly out of scope this round:** no new repo, no copy of the ACS codebase, no new frontend/chat UI, no touching the `www Chat`/`Person`/`Confidence` agents. Agents-only — provisioned in the same Agent Studio app for something else to consume.

## 1. Architecture reuse map

| Piece | ACS reference | Reuse plan |
|---|---|---|
| Classifier/handoff | `scripts/agents/instructions_classifier.md`, `ACS-classifier-neural` — internal-only, no search tool, decides the `SPECIALIST:` deep-dive offer synchronously | Same mechanism, new agent instance. Agent Studio agents are app-scoped — cannot share the live ACS classifier across apps, must create a new one in Algolia.com's app. |
| Judge | `lab/judge` (advocate/skeptic/referee, ≥2-of-3 corroboration gate, deterministic grounding gate in `detGround.ts`) | Reused with ~zero code change. One known coupling: `detGround.ts` has a hardcoded domain-term allowlist (`ReactSpectrum`, `SpectrumTwo`) used for grounding/negation heuristics — Spectrum-specific, extend or leave alone depending on whether Algolia.com content needs its own technical-term list. |
| Provisioning script | `agentConfig.mjs` + `build_acs_agents.mjs` (`PERSONAS` array, clone-base bootstrap, PATCH-in-place-never-delete, two-sided suggestions hard gate) | Reused as a **pattern**, not a shared parameterized module. `INDEX` is a module-level constant baked directly into `scopeTools()` — not an argument today. Forking into new files (Section 3) is lower-risk than parameterizing the existing ones in place, since ACS and Algolia.com are permanently separate apps with no shared runtime to protect by sharing code. |

## 2. New agent identities (names + index confirmed by Arijit, 2026-08-04)

**Corrected 2026-08-05 (prior version of this section was wrong — Academy is NOT standalone):** Generalist is the ONE front door, unchanged. Classifier's job expands from binary to 3-way: after Generalist answers, it decides whether to offer `SPECIALIST:<query>` (product/technical deep-dive), `ACADEMY:<query>` (learning-content deep-dive), or neither. Academy is reached exactly the way Specialist is — a classifier-brokered handoff from Generalist, never a separate entry point.

| ACS (reference) | Algolia.com (new) |
|---|---|
| `ACS-generic-neural` ("Generic") — no source filter, sees whole corpus | `Algolia_Generalist` ("Algolia Assistant") — same role, no source filter, full index. The ONLY front door. |
| `ACS-technical-neural` ("Technical") — filtered to React code sources | `Algolia_Specialist` ("Algolia Product Specialist") — filtered to the technical/product slice (Section 3). Reached via classifier handoff from Generalist. |
| *(no ACS equivalent — new 3rd deep-dive target)* | `Algolia_Academy` — filtered to `source:"Academy"` (142 records). Reached via classifier handoff from Generalist, same mechanism as Specialist — NOT a standalone front door. |
| `ACS-classifier-neural` — internal-only, binary handoff decision | `Algolia_Classifier` — internal-only, **3-way** decision: `SPECIALIST:`, `ACADEMY:`, or plain follow-up. This is a real prompt-logic change from ACS's binary original, not a copy-paste — `instructions_algolia_classifier.md` needs its own decision tree, not a port of ACS's `instructions_classifier.md` as-is. |
| ACS judge panel (advocate/skeptic/referee) | Same 3 judge roles, new agents in this app, scoped to this index — name TBD (e.g. `Algolia_Judge_Advocate/Referee/Skeptic`), not yet confirmed with Arijit |

No collision: checked live — none of these 6 names exist among the app's 43 agents.

**Index:** `Algolia_Prod_Copy_Vanilla` (confirmed live, exact casing) — the copy currently in use. Its sibling `Algolia_Prod_Copy_Enhanced` also exists, not used for this port.

## 3. Index schema (queried live, 2026-08-04) and filter design

`Algolia_Prod_Copy_Vanilla` — 12,114 records (dedup'd; several `attributesForFaceting` use `afterDistinct`). Relevant facets:

- **`source`** (clean, 8 values — this is the scoping facet, analog to ACS's `source`): `Documentation` (4337), `Blog` (2800), `Support` (1695), `Website` (1202), `Developers` (865), `Resources` (835), `Customer Stories` (237), `Academy` (142).
- **`category`** (49 values, finer-grained — e.g. `Doc`, `Engineering`, `Product`, `AI`, `Shopify`, `Magento`, `Crawler`, `Security` — not proposed as the primary filter, too granular for a 2-way split, but useful if Specialist's scope needs narrowing further later).
- **`environment`** (multiple snapshot values coexist in the SAME index: `prod20260722` 14394, `nonprod20260220` 2133, `prod20260621` 191, `nonprod9` 130, `prod03042026` 96, `nonprod` 22) — **open decision, see Section 4**: without an environment filter, both agents will retrieve stale/nonprod snapshots mixed with current content.
- **`language_code`**: `en` (12931), `fr` (2044), `de` (1992) — **open decision, see Section 4**.

Proposed filter split (mirrors ACS's Generic/no-filter vs. Technical/`source:"ReactSpectrumS2" OR "ReactSpectrumV3"` pattern, now 3-way):
- `Algolia_Generalist`: no `source` filter — full index (all 8 sources, including Academy — Academy content isn't excluded from Generalist, it's just ALSO independently reachable via its own agent).
- `Algolia_Specialist` ("Algolia Product Specialist"): `source:"Documentation" OR source:"Developers"` — the technical/product-reference slice.
- `Algolia_Academy`: `source:"Academy"` only (142 records).

## 4. Decisions — ALL RESOLVED 2026-08-05

- [x] **Environment filter** — every agent's search tool filters `environment:"prod20260722"` (14,394 records, the current live-site crawl). Combined with the per-agent `source` filter (Section 3).
- [x] **Language scope** — English-only: every agent's search tool also filters `language_code:"en"`.
- [x] **Judge agent names** — `Algolia_Judge_Advocate` / `Algolia_Judge_Referee` / `Algolia_Judge_Skeptic`.
- [x] Academy filter placement — own filter (`source:"Academy"`), reached via classifier handoff, not folded into Specialist or standalone.
- [x] Academy standalone vs. handoff target — Academy is a classifier handoff target from Generalist, same mechanism as Specialist. NOT standalone.

**Final filters, all 3 answering agents (`source` AND `environment:"prod20260722"` AND `language_code:"en"`):**
- `Algolia_Generalist`: `environment:"prod20260722" AND language_code:"en"` (no `source` filter — full corpus)
- `Algolia_Specialist`: `(source:"Documentation" OR source:"Developers") AND environment:"prod20260722" AND language_code:"en"`
- `Algolia_Academy`: `source:"Academy" AND environment:"prod20260722" AND language_code:"en"`

Nothing left blocking. Next step is the build (Section 5).

## 4c. BUILT + LIVE (2026-08-05)

All 7 agents created and published in app `0EXRPAXB56`, verified live (agent count 43 → 50, exact match):

| Agent | ID |
|---|---|
| `Algolia_Generalist` | `40bdd425-1929-46e5-91ff-c95f0d8c85f1` |
| `Algolia_Specialist` | `7ec82dc4-b67a-4f54-b321-a131e1d92464` |
| `Algolia_Academy` | `4cfbd31a-9571-4409-ad32-d0b295e2244a` |
| `Algolia_Classifier` | `bf323931-43fc-4799-a0ed-0e3564ce54e9` |
| `Algolia_Judge_Advocate` | `ea166058-0809-41d5-ae0d-ea88915b2d24` |
| `Algolia_Judge_Referee` | `30f60755-adb6-41fc-899d-b5418f41867b` |
| `Algolia_Judge_Skeptic` | `6dfd4a1e-8549-4771-998c-5a8ac233c3ae` |

Built via `scripts/agents/build_algolia_com_agents.mjs` (forked from `build_acs_agents.mjs`, config in `scripts/agents/algoliaComConfig.mjs`). Prompts: `scripts/agents/instructions_algolia_{generalist,specialist,academy,classifier}.md`, `scripts/agents/suggestions_algolia_{generalist,specialist,academy}.md`, `scripts/agents/_shared_grounding_algolia.md`. Judges reuse ACS's existing `scripts/agents/judge/instructions_judge_{advocate,referee,skeptic}.md` verbatim (confirmed no Spectrum/Adobe/React references). Not yet done: bait-query verification harness (Section 5 step 3).

## 4b. Confirmed requirement for `instructions_algolia_generalist.md` (2026-08-05)

Real Gong call data (`docs/sample_questions.md`) shows the #1 and #2 most-asked questions over the last 6 months are **"who are your competitors"** (52 cites) and **"how does your pricing model work"** (42 cites) — by a wide margin over everything else. Neither is answerable from `Algolia_Prod_Copy_Vanilla` (doc/blog/dev/support content, not sales/pricing collateral). Confirmed with Arijit: `Algolia_Generalist` needs an explicit refuse-and-route instruction for competitive-comparison and pricing questions — strict refusal per this project's grounding rule (no training-data facts, no guessing), routed to a human/sales contact rather than a bare "I don't know." This is now a hard requirement for that prompt file, not optional polish.

## 5. Concrete build steps (next session, once Section 4 is resolved)

1. **No new env vars needed** — same app, so the existing `ALGOLIA_APP_ID` / `ALGOLIA_ADMIN_API_KEY` in `.env.local` already work for provisioning.
2. New files, mirroring the existing pattern 1:1 (fork, don't parameterize — `INDEX` is baked into `scopeTools()` as a module constant in the current code, and ACS/Algolia.com must never risk sharing that constant):
   - `scripts/agents/algoliaComConfig.mjs` — mirrors `agentConfig.mjs`: `INDEX = 'Algolia_Prod_Copy_Vanilla'`, `CLONE_BASE`, `MAIN_MODEL`, `PERSONAS` (`Algolia_Classifier`/`Algolia_Generalist`/`Algolia_Specialist`/`Algolia_Academy` with the filters from Section 3), `RETIRE = []`.
   - `scripts/agents/build_algolia_com_agents.mjs` — mirrors `build_acs_agents.mjs`, same `ALGOLIA_APP_ID`/`ALGOLIA_ADMIN_API_KEY`, different `PERSONAS` source.
   - New prompt files: `instructions_algolia_generalist.md`, `instructions_algolia_specialist.md`, `instructions_algolia_academy.md`, `instructions_algolia_classifier.md` (3-way decision tree — see Section 2), `suggestions_algolia_generalist.md`, `suggestions_algolia_specialist.md`, `suggestions_algolia_academy.md` — written fresh, grounded in Algolia.com's real content (confirmed categories: Documentation, Engineering, Product, AI, Ecommerce integrations, Crawler, Security, etc.).
   - Judge prompts (`scripts/agents/judge/instructions_judge_{advocate,skeptic,referee}.md`) — rubric is grounding-agnostic; port with zero or near-zero edits.
3. Run `node scripts/agents/build_algolia_com_agents.mjs`, verify via `--list`, then smoke-test with a bait-query harness (this project's standing rule: grounding is enforced by agent instructions and verified via bait-query, not custom client code — port the `agent_admin.mjs bait` pattern from AC2/ACS).
4. No frontend change. Agents are provisioned and left for whatever existing or future Algolia.com surface calls them.

## 6. Explicitly not doing (per scope answers, 2026-08-04)

- No new repo / no copy of the ACS codebase
- No new frontend, chat UI, or `InstanceConfig` instance
- No change to ACS's own live agents, index, or app
- No change to the pre-existing `www Chat` / `www Confidence` / `www Person` agents (Sajid's architecture) — different system, left untouched
