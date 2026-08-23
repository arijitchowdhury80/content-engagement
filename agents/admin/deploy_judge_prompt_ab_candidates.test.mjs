import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  SOURCE_JUDGE_IDS,
  DEFAULT_OUTPUT_ROOT,
  EXPECTED_APP_ID,
  EXPECTED_MODEL,
  EXPECTED_PROVIDER_ID,
  ROLE_SPECS,
  ROOT,
  assertExactReadback,
  assertMutationRequest,
  assertSafeLabel,
  buildAfterReadbackManifest,
  buildExpectedCandidate,
  candidateName,
  ensureDeploymentDirectories,
  loadCandidatePrompts,
  outputPaths,
  writeJson,
} from './deploy_judge_prompt_ab_candidates.mjs';

const prompts = loadCandidatePrompts();
const sourceFor = (role, overrides = {}) => ({
  id: SOURCE_JUDGE_IDS[role],
  name: `current ${role}`,
  status: 'published',
  systemPrompt: null,
  instructions: 'combined current prompt',
  model: EXPECTED_MODEL,
  providerId: EXPECTED_PROVIDER_ID,
  tools: [],
  config: {
    enableAlgoliaMcp: false,
    suggestions: {
      enabled: false,
      model: 'gpt-5.4-mini',
      system_prompt: '',
      generation: { max_count: 1 },
      context: { include_tool_outputs: true },
    },
  },
  ...overrides,
});

test('candidate system prompt is the unchanged shared v3 rubric', () => {
  const sharedRaw = readFileSync(resolve(ROOT, 'agents/prompts/judge/_shared_judge_rubric_v2.md'), 'utf8');
  const candidateRaw = readFileSync(resolve(ROOT, 'agents/prompts/judge/candidate/system_prompt_judge_v3.md'), 'utf8');
  assert.equal(candidateRaw, sharedRaw);
  assert.equal(prompts.systemPrompt, sharedRaw.trim());
  assert.match(prompts.systemPrompt, /^BLIND PANEL CONTRACT: ALGOLIA-JUDGE-V3/);
  assert.doesNotMatch(prompts.systemPrompt, /YOUR LENS:/);
});

test('candidate instructions contain only the unchanged role lens', () => {
  for (const [role, spec] of Object.entries(ROLE_SPECS)) {
    const current = readFileSync(resolve(ROOT, `agents/prompts/judge/instructions_judge_${role}.md`), 'utf8');
    const currentLens = current.split('[[SHARED_JUDGE_RUBRIC_V2]]')[0].trim();
    assert.equal(prompts.instructions[role], currentLens, `${role} lens changed`);
    assert.match(prompts.instructions[role], new RegExp(`^YOUR LENS: ${spec.label.toUpperCase()}`));
    assert.doesNotMatch(prompts.instructions[role], /BLIND PANEL CONTRACT|FOUR DIMENSIONS|OUTPUT\s*$/m);
  }
});

test('candidate payload separates prompts and pins the approved OpenAI inference values', () => {
  for (const role of Object.keys(ROLE_SPECS)) {
    const source = sourceFor(role);
    const expected = buildExpectedCandidate({ role, release: 'test-a', source, prompts });
    assert.equal(expected.systemPrompt, prompts.systemPrompt);
    assert.equal(expected.instructions, prompts.instructions[role]);
    assert.equal(expected.model, EXPECTED_MODEL);
    assert.equal(expected.providerId, EXPECTED_PROVIDER_ID);
    assert.deepEqual(expected.tools, []);
    assert.equal(expected.config.suggestions.enabled, false);
    assert.equal(expected.config.enableAlgoliaMcp, false);
    assert.match(expected.name, /Candidate test-a$/);
  }
});

test('source model or provider drift blocks candidate planning before any inheritance', () => {
  assert.throws(
    () => buildExpectedCandidate({
      role: 'skeptic',
      release: 'test-model-drift',
      source: sourceFor('skeptic', { model: 'different-model' }),
      prompts,
    }),
    /model drifted.*gpt-5\.4-mini.*different-model/,
  );
  assert.throws(
    () => buildExpectedCandidate({
      role: 'skeptic',
      release: 'test-provider-drift',
      source: sourceFor('skeptic', { providerId: 'different-provider' }),
      prompts,
    }),
    /provider drifted.*e14c1f5e-7c24-4451-a342-940e427f769b.*different-provider/,
  );
  const expected = buildExpectedCandidate({
    role: 'skeptic',
    release: 'test-pinned-inference',
    source: sourceFor('skeptic'),
    prompts,
  });
  assert.equal(expected.config.suggestions.model, EXPECTED_MODEL);
});

test('candidate creation rejects an unpublished source judge', () => {
  assert.throws(
    () => buildExpectedCandidate({
      role: 'advocate',
      release: 'test-unpublished',
      source: sourceFor('advocate', { status: 'draft' }),
      prompts,
    }),
    /not published/,
  );
});

test('source judge IDs are read-only and can never be mutation targets', () => {
  for (const id of Object.values(SOURCE_JUDGE_IDS)) {
    assert.equal(assertMutationRequest('GET', `/agents/${id}`), true);
    for (const [method, path] of [
      ['PATCH', `/agents/${id}`],
      ['DELETE', `/agents/${id}`],
      ['POST', `/agents/${id}/publish`],
      ['PUT', `/agents/${id}`],
    ]) {
      assert.throws(() => assertMutationRequest(method, path), /permanently prohibited/);
    }
  }
});

test('only create and owned candidate publish/delete mutations are allowed', () => {
  const ownedId = 'candidate-created-by-this-run';
  const owned = new Set([ownedId]);
  assert.equal(assertMutationRequest('POST', '/agents', owned), true);
  assert.equal(assertMutationRequest('POST', `/agents/${ownedId}/publish`, owned), true);
  assert.equal(assertMutationRequest('DELETE', `/agents/${ownedId}`, owned), true);
  assert.throws(() => assertMutationRequest('PATCH', `/agents/${ownedId}`, owned), /Unsupported candidate mutation/);
  assert.throws(() => assertMutationRequest('DELETE', '/agents/unowned-agent', owned), /not restricted/);
});

test('exact readback validates every protected field', () => {
  const expected = buildExpectedCandidate({
    role: 'referee',
    release: 'test-readback',
    source: sourceFor('referee'),
    prompts,
  });
  assert.equal(assertExactReadback(expected, expected, 'referee'), true);
  const mutations = {
    systemPrompt: 'different system prompt',
    instructions: 'different instructions',
    model: 'different-model',
    providerId: 'different-provider',
    tools: [{ type: 'forbidden-tool' }],
    config: { suggestions: { enabled: true } },
  };
  for (const [field, value] of Object.entries(mutations)) {
    assert.throws(
      () => assertExactReadback({ ...expected, [field]: value }, expected, 'referee'),
      new RegExp(field),
    );
  }
});

test('sanitized after-readback manifest binds release, prompts, and all candidate summaries', () => {
  const agents = Object.fromEntries(Object.keys(ROLE_SPECS).map((role) => {
    const expected = buildExpectedCandidate({ role, release: 'test-manifest', source: sourceFor(role), prompts });
    return [role, { id: `candidate-${role}`, ...expected }];
  }));
  const promptHashes = {
    systemPrompt: 'system-hash',
    instructions: { skeptic: 's-hash', referee: 'r-hash', advocate: 'a-hash' },
  };
  const manifest = buildAfterReadbackManifest({
    runId: 'test-run',
    release: 'test-manifest',
    appId: EXPECTED_APP_ID,
    promptHashes,
    agents,
  });
  assert.deepEqual(Object.keys(manifest), ['schemaVersion', 'runId', 'release', 'appId', 'promptHashes', 'agents']);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.runId, 'test-run');
  assert.equal(manifest.release, 'test-manifest');
  assert.equal(manifest.appId, EXPECTED_APP_ID);
  assert.deepEqual(manifest.promptHashes, promptHashes);
  assert.deepEqual(Object.keys(manifest.agents), Object.keys(ROLE_SPECS));
  for (const [role, summary] of Object.entries(manifest.agents)) {
    assert.equal(summary.id, `candidate-${role}`);
    assert.equal(summary.model, EXPECTED_MODEL);
    assert.equal(summary.providerId, EXPECTED_PROVIDER_ID);
    assert.equal(summary.toolCount, 0);
    assert.match(summary.systemPromptHash, /^[a-f0-9]{64}$/);
    assert.match(summary.instructionsHash, /^[a-f0-9]{64}$/);
    assert.equal('systemPrompt' in summary, false);
    assert.equal('instructions' in summary, false);
  }
  promptHashes.systemPrompt = 'mutated-after-build';
  assert.equal(manifest.promptHashes.systemPrompt, 'system-hash');
});

test('after-readback manifest rejects wrong app or incomplete role set', () => {
  const agent = {
    id: 'candidate-skeptic',
    ...buildExpectedCandidate({ role: 'skeptic', release: 'test-manifest-guard', source: sourceFor('skeptic'), prompts }),
  };
  assert.throws(
    () => buildAfterReadbackManifest({
      runId: 'test-run', release: 'test-manifest-guard', appId: 'WRONG', promptHashes: {}, agents: {},
    }),
    /locked to 0EXRPAXB56/,
  );
  assert.throws(
    () => buildAfterReadbackManifest({
      runId: 'test-run',
      release: 'test-manifest-guard',
      appId: EXPECTED_APP_ID,
      promptHashes: {},
      agents: { skeptic: agent },
    }),
    /requires all three candidate agents/,
  );
});

test('candidate names are role-distinct and runtime output stays under ignored comparison runs', () => {
  const names = Object.keys(ROLE_SPECS).map((role) => candidateName(role, 'test-name'));
  assert.equal(new Set(names).size, 3);
  assert.equal(DEFAULT_OUTPUT_ROOT, resolve(ROOT, 'production_comparison/runs'));
  assert.match(outputPaths('safe-run-id').base, /production_comparison\/runs\/safe-run-id\/candidate-deploy$/);
  assert.equal(assertSafeLabel('safe_2026-08-23.a', 'Run ID'), 'safe_2026-08-23.a');
  assert.throws(() => outputPaths('../escape'), /Run ID/);
});

test('all deployment directories and artifacts are private regardless of prior modes', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'candidate-deploy-permissions-'));
  const paths = {
    base: resolve(root, 'candidate-deploy'),
    evidence: resolve(root, 'candidate-deploy/evidence'),
    private: resolve(root, 'candidate-deploy/private'),
  };
  try {
    mkdirSync(paths.evidence, { recursive: true, mode: 0o777 });
    mkdirSync(paths.private, { recursive: true, mode: 0o777 });
    for (const path of [paths.base, paths.evidence, paths.private]) chmodSync(path, 0o777);

    ensureDeploymentDirectories(paths);
    for (const path of [paths.base, paths.evidence, paths.private]) {
      assert.equal(statSync(path).mode & 0o777, 0o700, `${path} is not mode 0700`);
    }

    const artifacts = [
      resolve(paths.evidence, 'deployment-plan.json'),
      resolve(paths.evidence, 'after-readback.json'),
      resolve(paths.evidence, 'validation.json'),
      resolve(paths.evidence, 'rollback.json'),
      resolve(paths.evidence, 'failed-apply.json'),
      resolve(paths.evidence, 'rollback-readback.json'),
      resolve(paths.private, 'dry-run-before-snapshot.json'),
      resolve(paths.private, 'rollback-manifest.json'),
    ];
    for (const path of artifacts) {
      writeFileSync(path, '{}\n', { mode: 0o666 });
      chmodSync(path, 0o666);
      writeJson(path, { pass: true });
      assert.equal(statSync(path).mode & 0o777, 0o600, `${path} is not mode 0600`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
