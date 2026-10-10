/** Three-role Agent Studio judge panel using the immutable v3.3 judge core. */
import { AgentStudioRequestError, runToolLoop } from '../shared/agentStudio';
import { getAgentConfig } from '../shared/agents';
import type { JudgeAnswerInput, JudgeRuntimeConfig } from './hostedJudgeClient';
import type { JudgePerJudge, JudgeVerdict } from './types';
import type { JudgeErrorKind } from './types';

interface JudgeCore {
  ROLES: readonly string[];
  createEvaluationPackage: (input: Record<string, unknown>) => Promise<Record<string, any>>;
  validateJudgeAgents: (agents: unknown[]) => {
    ok: boolean;
    errors: string[];
    byRole: Record<string, { id: string; role: string }>;
  };
  buildJudgeInput: (
    evaluation: Record<string, any>,
    role: string,
    attemptId: string,
    validationFeedback?: string[],
  ) => Record<string, unknown>;
  validateJudgeReport: (
    role: string,
    report: unknown,
    evaluation: Record<string, any>,
  ) => { ok: boolean; errors: string[]; value: Record<string, any> | null };
  aggregateJudgeReports: (reports: unknown[]) => Record<string, any>;
}

function judgeCore(): JudgeCore | null {
  return (globalThis as typeof globalThis & { AlgoliaJudgeCore?: JudgeCore }).AlgoliaJudgeCore ?? null;
}

function errorVerdict(
  panelId: string,
  message: string,
  errorKind: JudgeErrorKind = 'bad-response',
): JudgeVerdict {
  return {
    panelId,
    dims: {},
    synthesizedScore: 0,
    composite: 0,
    preGateScore: 0,
    gateTripped: false,
    borderline: false,
    flaggedClaims: [],
    perJudge: [],
    rationale: '',
    error: message,
    errorKind,
  };
}

function parseReport(text: string): unknown {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(source);
}

function meanScore(scores: Record<string, number>): number {
  const values = Object.values(scores).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

async function runRole(
  core: JudgeCore,
  role: string,
  agentId: string,
  evaluation: Record<string, any>,
): Promise<RoleResult> {
  let feedback: string[] = [];
  let errorKind: JudgeErrorKind = 'bad-response';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const input = core.buildJudgeInput(evaluation, role, `${role}-${attempt}`, feedback);
      const result = await runToolLoop(
        getAgentConfig(agentId),
        { query: JSON.stringify(input) },
        {},
        { maxSteps: 1, completionRetry: 'caller-owned' },
      );
      const validation = core.validateJudgeReport(role, parseReport(result.content), evaluation);
      if (validation.ok) return validation;
      feedback = validation.errors;
      errorKind = 'bad-response';
    } catch (error) {
      errorKind = classifyRoleError(error);
      feedback = errorKind === 'bad-response'
        ? [error instanceof Error ? error.message : String(error)]
        : [];
      if (attempt === 1) await waitForRoleRetry(error, role);
    }
  }
  return {
    ok: false,
    errors: feedback.length ? feedback : [`${role} judge failed`],
    value: null,
    errorKind,
  };
}

interface RoleResult {
  ok: boolean;
  errors: string[];
  value: Record<string, any> | null;
  errorKind?: JudgeErrorKind;
}

const ROLE_RETRY_STAGGER_MS: Record<string, number> = {
  skeptic: 0,
  referee: 150,
  advocate: 300,
};

function classifyRoleError(error: unknown): JudgeErrorKind {
  if (error instanceof AgentStudioRequestError) {
    if (error.status === 401 || error.status === 403) return 'auth';
    if (error.status === 429) return 'rate-limit';
    return 'server';
  }
  if (error instanceof TypeError) return 'offline';
  return 'bad-response';
}

function roleRetryDelayMs(error: unknown, role: string): number {
  if (!(error instanceof AgentStudioRequestError)) return 0;
  const suggested = error.retryAfterMs ?? (error.status === 429 ? 1000 : 500);
  return suggested + (ROLE_RETRY_STAGGER_MS[role] ?? 0);
}

async function waitForRoleRetry(error: unknown, role: string): Promise<void> {
  const delayMs = roleRetryDelayMs(error, role);
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function unavailableErrorKind(reports: RoleResult[]): JudgeErrorKind {
  const failures = reports.filter((report) => !report.ok).map((report) => report.errorKind);
  const precedence: JudgeErrorKind[] = ['auth', 'rate-limit', 'offline', 'server', 'bad-response'];
  return precedence.find((kind) => failures.filter((value) => value === kind).length >= 2) ??
    failures.find((kind): kind is JudgeErrorKind => Boolean(kind)) ?? 'bad-response';
}

function unavailableMessage(kind: JudgeErrorKind, aggregate: Record<string, any>): string {
  if (kind === 'rate-limit') {
    return 'Agent Studio rate-limited the judge panel after one bounded retry per role.';
  }
  if (kind === 'auth') return 'Agent Studio rejected the judge credentials.';
  if (kind === 'offline') return 'The judge panel could not reach Agent Studio.';
  if (kind === 'server') return 'Agent Studio returned a judge service error.';
  return aggregate.rationale || 'Fewer than two judges returned valid reports.';
}

function toVerdict(
  panelId: string,
  aggregate: Record<string, any>,
  reports: RoleResult[],
): JudgeVerdict {
  if (aggregate.status === 'unavailable' || !Number.isFinite(aggregate.composite)) {
    const kind = unavailableErrorKind(reports);
    return errorVerdict(panelId, unavailableMessage(kind, aggregate), kind);
  }
  const dims = aggregate.dims || {};
  const perJudge: JudgePerJudge[] = (aggregate.perJudge || []).map((report: Record<string, any>) => ({
    role: report.role,
    score: meanScore(report.dimensionScores || {}),
    note: report.summary || '',
  }));
  return {
    panelId,
    dims,
    dimensions: Object.entries(dims).map(([id, score]) => ({ id, label: id, score: Number(score) })),
    synthesizedScore: aggregate.composite,
    composite: aggregate.composite,
    preGateScore: aggregate.composite,
    gateTripped: false,
    borderline: Boolean(aggregate.provisional),
    flaggedClaims: (aggregate.flaggedClaims || []).map((finding: Record<string, any>) => ({
      claim: finding.claim || '',
      reason: (finding.reasons || []).join(' ') || 'Judge panel requested review.',
      certainty: Math.min(1, Math.max(0, Number(finding.judgeCount || 0) / 3)),
    })),
    perJudge,
    rationale: aggregate.rationale || '',
    grounded: aggregate.groundingStatus === 'grounded',
    termsChecked: aggregate.flaggedClaims?.length || 0,
    groundingMode: 'three-role-panel-v3.3',
  };
}

export async function judgeAnswerViaPanel(
  input: JudgeAnswerInput,
  config?: JudgeRuntimeConfig,
): Promise<JudgeVerdict> {
  const panelId = input.panelId ?? 'main';
  const core = judgeCore();
  if (!core) return errorVerdict(panelId, 'Judge core v3.3 is unavailable.');
  const agentValidation = core.validateJudgeAgents(config?.agents ?? []);
  if (!agentValidation.ok) return errorVerdict(panelId, agentValidation.errors.join('; '));

  const evaluation = await core.createEvaluationPackage({
    question: input.question,
    answer: input.answer,
    hits: input.hits,
  });
  if (evaluation.capacity?.fits === false) {
    return errorVerdict(panelId, 'Judge evidence packet exceeds the configured capacity.');
  }

  const reports = await Promise.all(core.ROLES.map((role) =>
    runRole(core, role, agentValidation.byRole[role].id, evaluation),
  ));
  return toVerdict(panelId, core.aggregateJudgeReports(reports), reports);
}
