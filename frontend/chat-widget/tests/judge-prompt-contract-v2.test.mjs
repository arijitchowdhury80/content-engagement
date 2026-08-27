import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const promptRoot = resolve('agents/prompts/judge');
const roles = ['skeptic', 'referee', 'advocate'];
const shared = readFileSync(resolve(promptRoot, '_shared_judge_rubric_v2.md'), 'utf8');

test('shared rubric assigns semantic work to LLMs and mechanical work to code', () => {
  assert.match(shared, /perform semantic judgment only/i);
  assert.match(shared, /Do not calculate hashes, text offsets, averages, composite scores, gates/i);
  assert.match(shared, /return `claimText` by copying the smallest exact, contiguous substring/i);
  assert.match(shared, /Do not calculate offsets/i);
  assert.match(shared, /untrusted data/i);
  assert.match(shared, /Return exactly one sentence assessment for every manifest entry/i);
});

for (const role of roles) {
  test(`${role} prompt imports the same v2 contract and changes only its lens`, () => {
    const prompt = readFileSync(resolve(promptRoot, `instructions_judge_${role}.md`), 'utf8');
    assert.match(prompt, new RegExp(`YOUR LENS: ${role.toUpperCase()}`));
    assert.match(prompt, /\[\[SHARED_JUDGE_RUBRIC_V2\]\]/);
    assert.doesNotMatch(prompt, /usefulness/i);
    assert.doesNotMatch(prompt, /one thing you score/i);
  });
}

test('shared rubric defines identical four dimensions and strict output shape', () => {
  assert.match(shared, /^BLIND PANEL CONTRACT: ALGOLIA-JUDGE-V3\.8$/m);
  assert.doesNotMatch(shared, /ALGOLIA-JUDGE-V3\.3/);
  for (const dimension of ['Grounding', 'Completeness', 'Depth', 'Relevance']) {
    assert.match(shared, new RegExp(`\\n${dimension}\\n`));
  }
  assert.match(shared, /"sentenceAssessments"/);
  assert.match(shared, /"classification": "factual \| mixed \| non_factual"/);
  assert.match(shared, /"nonFactualSpans"/);
  assert.match(shared, /"evidencePassageIds"/);
  assert.match(shared, /"claimText"/);
  assert.match(shared, /"centralToAnswer"/);
  assert.doesNotMatch(shared, /"claimQuote"/);
  assert.doesNotMatch(shared, /"excerpt"/);
});

test('shared rubric scores dimensions independently and handles negotiated pricing fairly', () => {
  assert.match(shared, /DIMENSION INDEPENDENCE/);
  assert.match(shared, /Unsupported or contradicted information lowers Grounding/);
  assert.match(shared, /MUST NOT automatically lower Completeness, Depth, or Relevance/);
  assert.match(shared, /Lower another dimension only when that dimension has its own independent defect/);
  assert.match(shared, /do not lower Depth merely because no public fixed price exists/i);
  assert.match(shared, /comparison method, decision variables, or next step/);
});

test('shared rubric prevents rhetoric from becoming an unverifiable factual claim', () => {
  assert.match(shared, /A `non_factual` entry MUST return `claims: \[\]`/);
  assert.match(shared, /A `factual` entry MUST return at least one claim/);
  assert.match(shared, /A `mixed` entry MUST return at least one claim/);
  assert.match(shared, /Never use `unverifiable` merely because a heading, analogy, metaphor, question, transition, or rhetorical phrase/i);
  assert.match(shared, /Missing evidence can change a factual claim's verdict, but it can never turn rhetoric into a factual claim/i);
  assert.match(shared, /A dependent clause that continues or explains an analogy remains non-factual/i);
  assert.match(shared, /Do not convert figurative language into an implied outcome claim/i);
});
