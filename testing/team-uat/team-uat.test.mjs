import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
const canonical = readFileSync(new URL("./content-engagement-demo-uat-test-cases.md", import.meta.url), "utf8");
const standalone = readFileSync(new URL("./content-engagement-team-uat.html", import.meta.url), "utf8");
const deploymentRecordUrl = new URL("../../docs/evidence/deployments/team-uat/latest.json", import.meta.url);
const deployer = readFileSync(
  new URL("../../tools/deployment/deploy_team_uat.py", import.meta.url),
  "utf8",
);
const localParityServer = readFileSync(
  new URL("../../tools/local_chat_parity_server.py", import.meta.url),
  "utf8",
);
const all = [app, html, css, readme, canonical].join("\n");

const scenarioIds = ["T1", "T2", "B1", "B2", "C1", "C2", "S1", "S2"];
const categories = ["Technical", "Business", "Commercial", "Specialist"];
const triggers = [
  "product_page_10s_50_scroll",
  "product_to_documentation",
  "solution_page_10s_50_scroll",
  "solution_to_customer_story",
  "product_to_pricing",
  "solution_to_pricing",
  "developer_page_10s_50_scroll",
  "resource_page_10s_50_scroll",
];
const evidenceByJourney = {
  T1: {
    trigger: triggers[0],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T1/01",
    accepted: true,
  },
  T2: {
    trigger: triggers[1],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/T2/02",
    transition: true,
    accepted: true,
  },
  B1: {
    trigger: triggers[2],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B1/03",
    accepted: true,
  },
  B2: {
    trigger: triggers[3],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/B2/04",
    transition: true,
    accepted: true,
  },
  C1: {
    trigger: triggers[4],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C1/05",
    transition: true,
    accepted: true,
  },
  C2: {
    trigger: triggers[5],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/C2/06",
    transition: true,
    accepted: true,
  },
  S1: {
    trigger: triggers[6],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S1-retry/07",
    specialist: true,
    accepted: true,
  },
  S2: {
    trigger: triggers[7],
    base: "../../docs/evidence/visitor-intelligence/2026-08-19-jahia-headed-final/S2/08",
    specialist: true,
    accepted: true,
  },
};

function evidenceUrl(base, suffix) {
  return new URL(`${base}-${suffix}`, import.meta.url);
}

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function assertNonemptyFile(url, label) {
  assert.ok(existsSync(url), `${label}: missing ${url.pathname}`);
  assert.ok(statSync(url).size > 0, `${label}: empty ${url.pathname}`);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("canonical guide contains four categories and exactly eight scenarios", () => {
  assert.equal((canonical.match(/^### [TBCS][12] /gm) || []).length, 8);
  for (const id of scenarioIds) assert.match(canonical, new RegExp(`^### ${id} `, "m"));
  for (const category of categories) assert.match(canonical, new RegExp(`^## ${category}$`, "m"));
  for (const trigger of triggers) assert.match(canonical, new RegExp(trigger));
});

test("business transition instructions use routes that exist on the Jahia test surface", () => {
  assert.match(canonical, /\/industries\/grocery/);
  assert.match(canonical, /\/customers\/h-e-b-mexico/);
  assert.doesNotMatch(canonical, /\/solutions\/ecommerce/);
});

test("technical transition uses the exact same-origin AI Search documentation route", () => {
  assert.match(canonical, /\/products\/ai-search/);
  assert.match(canonical, /Read the AI Search docs/);
  assert.match(canonical, /\/sites\/www\/doc\/guides\/building-search-ui\/what-is-instantsearch\/js/);
  assert.match(canonical, /\/cms\/render\/live\/en\/sites\/www\/home\/doc\/guides\/building-search-ui\/what-is-instantsearch\/js\.html/);
  assert.match(canonical, /tmp-content-eng-algolia\.cloud\.jahia\.com/);
  assert.match(html, /Products → AI Search → Read the AI Search docs/);
  assert.doesNotMatch(`${html}\n${canonical}`, /UI Component Libraries → React|React card's \*\*Read the docs\*\*/);
});

test("presentation is an eight-slide briefing deck", () => {
  assert.equal((html.match(/<section class="slide(?: [^"]*)?"/g) || []).length, 8);
  for (let slide = 1; slide <= 8; slide += 1) assert.match(html, new RegExp(`id="slide-${slide}"`));
  assert.match(html, /Introduction|Four business stories/i);
  assert.match(html, /Before every journey/);
  assert.match(html, /Evidence collection/);
  assert.match(html, /Current acceptance baseline/);
  assert.match(app, /ArrowRight/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /slide-dot/);
});

test("standalone presentation can be sent and opened as one HTML file", () => {
  assert.match(standalone, /<style>[\s\S]+<\/style>/);
  assert.match(standalone, /<script>[\s\S]+<\/script>/);
  assert.match(standalone, /src="data:image\/svg\+xml;base64,/);
  assert.equal((standalone.match(/src="data:image\/png;base64,/g) || []).length, 8);
  assert.equal((standalone.match(/href="data:image\/png;base64,/g) || []).length, 8);
  for (const id of scenarioIds) {
    assert.match(standalone, new RegExp(`aria-label="Open embedded ${id} evidence preview"`));
  }
  assert.match(standalone, /href="data:text\/markdown;base64,/);
  assert.doesNotMatch(standalone, /(?:src|href)="(?:\.\.\/|\.\/|assets\/|styles\.css|app\.js)/);
  assert.doesNotMatch(standalone, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.equal((standalone.match(/<section class="slide(?: [^"]*)?"/g) || []).length, 8);
});

test("a deployment declared current matches the standalone artifact exactly", () => {
  assertNonemptyFile(deploymentRecordUrl, "team UAT deployment record");
  const deployment = readJson(deploymentRecordUrl);
  if (!deployment.applied && !deployment.verified) return;

  assert.equal(deployment.applied, true, "current deployment record must say it was applied");
  assert.equal(deployment.verified, true, "current deployment record must say it was verified");
  assert.match(deployment.liveUrl || "", /^https:\/\/tmp-content-eng-algolia\.cloud\.jahia\.com\//);

  const artifact = readFileSync(new URL("./content-engagement-team-uat.html", import.meta.url));
  const artifactHash = sha256(artifact);
  assert.equal(
    deployment.bytes,
    artifact.byteLength,
    `hosted UAT is stale: deployment has ${deployment.bytes} bytes, current artifact has ${artifact.byteLength}`,
  );
  assert.equal(
    deployment.sha256,
    artifactHash,
    `hosted UAT is stale: deployment source hash ${deployment.sha256} != current artifact ${artifactHash}`,
  );
  assert.equal(
    deployment.liveSha256,
    artifactHash,
    `hosted UAT is stale: live hash ${deployment.liveSha256} != current artifact ${artifactHash}`,
  );
});

test("standalone presentation has a narrow hidden Jahia deployment path", () => {
  assert.match(deployer, /content-engagement-team-uat\.html/);
  assert.match(deployer, /text\/html/);
  assert.match(deployer, /publish\(languages: \["en"\]/);
  assert.match(deployer, /--apply/);
  assert.doesNotMatch(deployer, /custom-code-block|blockHtml|site navigation/i);
});

test("local app exposes the standalone deck at an unlisted manual route", () => {
  assert.match(localParityServer, /UAT_STANDALONE/);
  assert.match(localParityServer, /"\/team-uat"/);
  assert.match(localParityServer, /"\/team-uat\/"/);
  assert.match(localParityServer, /content-engagement-team-uat\.html/);
});

test("slide 3 names the technical specialist flow from product page to documentation", () => {
  assert.match(html, /<h2 id="technical-heading">Testing a technical specialist flow: product page to product documentation\.<\/h2>/);
  assert.doesNotMatch(html, /From product interest to implementation depth/);
});

test("presentation scrolls as one anchored slide document", () => {
  assert.match(css, /scroll-snap-type:\s*y mandatory/);
  assert.match(css, /scroll-snap-align:\s*start/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /slidesHost\.scrollTo/);
  assert.doesNotMatch(css, /\.slide\s*\{[^}]*display:\s*none/s);
});

test("testers control their response instead of following a script", () => {
  for (const phrase of [
    "There is no scripted question",
    "no prescribed answer",
    "respond naturally",
    "any relevant chip or free text",
    "The system has to work with what you give it",
  ]) assert.match(all, new RegExp(phrase, "i"));

  assert.doesNotMatch(all, /Scenario tester question|ask the scenario question|required question to ask/i);
  assert.doesNotMatch(app, /question\s*:/);
});

test("all eight scenarios test the complete runtime chain", () => {
  for (const term of [
    "Reset",
    "Track",
    "Compile context",
    "Personalized greeting",
    "Handoff",
    "Orchestrator",
    "Specialist when appropriate",
    "Grounded answer",
    "Discovery question",
    "screenshot",
    "context packet",
    "specialist/tool trace",
  ]) assert.match(all, new RegExp(term, "i"));
});

test("deck has no checklist runner or task assignment machinery", () => {
  assert.doesNotMatch(html, /<input|<select|<textarea|export feedback|reset local progress/i);
  assert.doesNotMatch(app, /localStorage|sessionStorage|Blob|download/i);
  assert.doesNotMatch(all, /Aadhar|Harsh|Naveen|Rakesh|Tarun/i);
});

test("slides keep implementation details in the canonical guide", () => {
  const visibleDeckSource = html.replace(/\sdata-trigger="[^"]+"/g, "");
  for (const trigger of triggers) assert.doesNotMatch(visibleDeckSource, new RegExp(trigger));
  assert.equal((html.match(/data-trigger="[^"]+"/g) || []).length, 8);
  assert.doesNotMatch(html, /opportunity\/context packet|specialist\/tool trace|handoff preserves/i);
  assert.match(html, /Look for/);
});

test("each journey slide makes the two-test progression explicit", () => {
  assert.equal((html.match(/Run these as two separate tests/g) || []).length, 4);
  assert.equal((html.match(/<strong>Click path<\/strong>/g) || []).length, 8);
  assert.equal((html.match(/Reset the Assistant\./g) || []).length, 8);
});

test("specialist journeys use the same quantified dwell and scroll gate as the runtime", () => {
  for (const id of ["S1", "S2"]) {
    const start = html.indexOf(`<span>${id}</span>`);
    const end = html.indexOf("</article>", start);
    const scenario = html.slice(start, end);
    assert.match(scenario, /10\+ seconds/);
    assert.match(scenario, /50%/);
  }
});

test("UAT materials link nonempty final evidence for all eight journeys", () => {
  for (const [id, evidence] of Object.entries(evidenceByJourney)) {
    const root = evidence.base.split("/visitor-intelligence/")[1];
    assert.match(html, new RegExp(`${root}-answer\\.png`), id);
    assert.match(canonical, new RegExp(`${root}-answer\\.png`), id);
    assert.match(canonical, new RegExp(`${root}-trace\\.json`), id);

    for (const suffix of [
      "start.png",
      "source-qualified.png",
      "greeting.png",
      "answer.png",
      "continuity.png",
      "trace.json",
      "first-turn-verification.json",
      "reset-verification.json",
      "traffic-verification.json",
    ]) {
      assertNonemptyFile(evidenceUrl(evidence.base, suffix), `${id} final evidence`);
    }
    if (evidence.transition) {
      assertNonemptyFile(evidenceUrl(evidence.base, "destination.png"), `${id} transition evidence`);
    }
  }
  assert.match(html, /Authoritative hosted evidence/);
  assert.doesNotMatch(`${html}\n${canonical}`, /2026-08-1[78]-(?:runtime|b1)/i);
  assert.doesNotMatch(`${html}\n${canonical}`, /runtime-k/i);
});

test("each final trace proves its complete first-turn runtime contract", () => {
  for (const [id, evidence] of Object.entries(evidenceByJourney)) {
    const trace = readJson(evidenceUrl(evidence.base, "trace.json"));
    const verification = readJson(evidenceUrl(evidence.base, "first-turn-verification.json"));
    const activeOpportunity = trace.proactiveState?.opportunities?.at(-1);

    assert.equal(trace.journey, id, `${id}: trace journey identifier`);
    assert.equal(trace.expectedTrigger, evidence.trigger, `${id}: expected trigger`);
    assert.equal(activeOpportunity?.status, "active", `${id}: opportunity must finish active`);
    for (const state of ["qualified", "pending", "shown", "engaged", "handed_off", "active"]) {
      assert.ok(activeOpportunity?.lifecycle?.includes(state), `${id}: lifecycle missing ${state}`);
    }

    assert.equal(verification.pass, true, `${id}: first-turn verifier failed: ${verification.errors?.join("; ")}`);
    assert.deepEqual(verification.errors, [], `${id}: first-turn verifier errors`);
    assert.equal(verification.greetings?.afterVisitorResponse, 0, `${id}: greeting ran after visitor response`);
    for (const [opportunityId, requests] of Object.entries(verification.greetings?.byOpportunity || {})) {
      assert.equal(requests, 1, `${id}: ${opportunityId} has ${requests} greeting completions`);
    }
    assert.equal(verification.firstTurn?.orchestratorRequests, 1, `${id}: initial orchestrator request count`);
    assert.equal(verification.firstTurn?.handoffBlocks, 1, `${id}: initial handoff count`);
    assert.equal(verification.firstTurn?.responseStatus, 200, `${id}: orchestrator response status`);
    assert.ok(verification.firstTurn?.responseTextLength > 0, `${id}: orchestrator response is empty`);
    assert.equal(verification.discovery?.pass, true, `${id}: discovery verifier failed`);
    assert.equal(verification.discovery?.visibleQuestions, 1, `${id}: must show exactly one discovery question`);

    assert.ok(trace.continuity?.conversationIdBefore, `${id}: missing pre-navigation conversation ID`);
    assert.equal(
      trace.continuity?.conversationIdAfter,
      trace.continuity?.conversationIdBefore,
      `${id}: conversation ID changed across navigation`,
    );
    assert.ok(
      trace.continuity?.turnCountAfter > trace.continuity?.turnCountBefore,
      `${id}: continuity turn did not advance`,
    );
    assert.equal(trace.continuity?.restoredQueryVisible, true, `${id}: prior query was not restored`);

    if (evidence.specialist) {
      assert.equal(trace.specialistAccepted, true, `${id}: specialist acceptance missing`);
      assert.equal(verification.firstTurn?.routedToSpecialist, true, `${id}: specialist route missing`);
      assert.equal(verification.firstTurn?.specialistRequests, 1, `${id}: specialist request count`);
      assert.equal(verification.firstTurn?.specialistAction, "accept", `${id}: specialist action`);
    } else {
      assert.equal(verification.firstTurn?.orchestratorRequests, 1, `${id}: direct orchestrator cardinality`);
    }
  }
});

test("UAT materials state the fresh headed Jahia acceptance baseline", () => {
  assert.match(canonical, /final evidence set validates 8\/8 journeys/i);
  assert.match(canonical, /S1-retry.*authoritative S1 result/i);
  assert.match(html, /8 \/ 8[\s\S]+Hosted Jahia journeys passed/);
  assert.match(html, /8 \/ 8[\s\S]+Discovery and continuity passed/);
  assert.match(html, /2 \/ 2[\s\S]+Specialist routes safely gated/);
  assert.doesNotMatch(`${html}\n${canonical}\n${readme}`, /complete acceptance passed only 3\/8|strict grounding failures|failed coverage and relevance/i);
});

test("B1 uses the current grounding contract without scripting the tester", () => {
  assert.match(canonical, /current English, non-404 records from the declared production corpus/i);
  assert.match(canonical, /testers remain free to ask a different relevant question/i);
  assert.match(canonical, /one relevant discovery question/i);
  assert.match(html, /supported by current English sources and one useful discovery question/i);
  assert.doesNotMatch(`${html}\n${canonical}`, /required B1 question|must ask exactly/i);
});

test("fresh transition evidence separates replacement greetings from post-response calls", () => {
  for (const id of ["T2", "B2", "C1", "C2"]) {
    const evidence = evidenceByJourney[id];
    const traffic = readJson(evidenceUrl(evidence.base, "traffic-verification.json"));
    assert.equal(traffic.pass, true, `${id}: traffic verification`);
    assert.equal(traffic.greetings?.requests, 2, `${id}: source and destination greeting count`);
    assert.equal(Object.keys(traffic.greetings?.byOpportunity || {}).length, 2, `${id}: opportunity count`);
    assert.equal(traffic.greetings?.afterVisitorResponse, 0, `${id}: greeting after response`);
  }
});

test("transition journeys leave the source greeting unanswered until the destination greeting replaces it", () => {
  for (const id of ["T2", "B2", "C1", "C2"]) {
    const start = html.indexOf(`<span>${id}</span>`);
    const end = html.indexOf("</article>", start);
    const scenario = html.slice(start, end);
    assert.match(scenario, /leave (?:that|the source-page) greeting unanswered/i, id);
    assert.match(scenario, /destination greeting/i, id);
    assert.match(scenario, /only then respond/i, id);
  }

  for (const heading of [
    "T2 Product To Documentation",
    "B2 See How Another Brand Solved It",
    "C1 Product To Pricing",
    "C2 Solution To Pricing",
  ]) {
    const start = canonical.indexOf(`### ${heading}`);
    const next = canonical.indexOf("\n### ", start + 4);
    const scenario = canonical.slice(start, next === -1 ? canonical.length : next);
    assert.match(scenario, /leave (?:that|the source-page) greeting unanswered/i, heading);
    assert.match(scenario, /destination greeting/i, heading);
    assert.match(scenario, /only then respond/i, heading);
  }
});

test("presentation preserves Algolia visual and accessibility contracts", () => {
  assert.match(css, /--algolia-blue:\s*#003dff/i);
  assert.match(css, /font-family:\s*"Sora"/);
  assert.match(html, /class="title-logo" src="assets\/Algolia-logo-white\.svg"/);
  assert.match(html, /class="content-slide-logo" src="assets\/Algolia-logo-blue\.svg"/);
  assert.match(css, /\.title-slide[^{]*\{[^}]*background:\s*var\(--algolia-blue\)/s);
  assert.doesNotMatch(all, /DM Sans|IBM Plex Mono|class="brand-mark"|class="brand-logo"/);
  assert.doesNotMatch(css, /linear-gradient\(90deg|54px 54px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /aria-label="Previous slide"/);
  assert.match(html, /aria-label="Next slide"/);
});

test("presentation uses current Algolia product terminology", () => {
  assert.match(html, /Products → AI Search/);
  assert.match(html, /Read the AI Search docs/);
});

test("scope boundary remains explicit", () => {
  assert.match(all, /does not authorize runtime, prompt, Agent Studio, trigger,.*Jahia, or production changes/i);
});
