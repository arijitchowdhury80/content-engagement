/**
 * hostedJudgeClient — talks to the judge HTTP service
 * (`POST /api/judge`, `npm run judge:serve`, default port 8788) to grade an
 * assistant answer for grounding/coverage/depth/relevance.
 *
 * Wire contract (Read Receipt — lab/judge/README.md §4b "HTTP service",
 * lines 181-232):
 *   POST /api/judge  { question, panels:[{panelId, label?, answer,
 *     sources:[{id,title?,url?,text}]}], isRefusalTest?, rounds }
 *   -> LiveJudgeResult { rounds, panels:[{panelId, dims:{grounding,coverage,
 *     depth,relevance}, synthesizedScore, composite, preGateScore,
 *     gateTripped, borderline, flaggedClaims:[{claim,reason,certainty}],
 *     perJudge:[{role,score,note}], rationale, error?}] }
 * `Source.text` is what grounding is scored against — it must be the
 * record's real body, not just its title (README §5).
 *
 * Live judging is indicative (1 round, fast model) — see useJudge.ts.
 * This client NEVER throws into render: any network/HTTP/parse failure
 * resolves to an error verdict (`error` set, all scores 0) instead.
 *
 * `judgeAnswer` accepts an optional `JudgeRuntimeConfig` override that takes
 * precedence over the global env singleton. useJudge supplies this from the
 * IS renderState (via the chatConfidence widget) so all judge config flows
 * through the widget system rather than the global env singleton.
 */

import { getRuntimeEnv } from '../config/runtime';
import { activeInstance } from '../config/active';
import {
  pickRecordText,
  pickRecordTitle,
  pickRecordUrl,
  resolveRecordId,
} from '../shared/recordFields';
import type {
  JudgeAgentDescriptor,
  JudgeAnswerInput,
  JudgeErrorKind,
  JudgeSourceInput,
  JudgeVerdict,
} from './types';

// Shared judge types now live in ./types. Re-export them so existing importers
// of this module keep working (they can also import from ./types directly).
export type {
  JudgeAnswerInput,
  JudgeDimension,
  JudgeDims,
  JudgeErrorKind,
  JudgeFlaggedClaim,
  JudgePerJudge,
  JudgeRole,
  JudgeSourceInput,
  JudgeVerdict,
} from './types';

// ── Runtime config override ───────────────────────────────────────────────────

/**
 * Optional runtime config override passed to `judgeAnswer` by `useJudge`.
 * When present, these values take precedence over the global env singleton
 * (`getRuntimeEnv()`), allowing the chatConfidence IS widget to fully own the
 * judge configuration without mutating shared state.
 */
export interface JudgeRuntimeConfig {
  /** Which judge backend to use. */
  mode?: 'hosted' | 'algolia' | 'off';
  /** Override URL for the hosted judge service. */
  url?: string;
  /** Auth key for the hosted judge service. */
  apiKey?: string;
  /**
   * Judge agents used in algolia mode. Each agent acts as an LLM seam for the
   * @confidence-engine. An entry whose `role` names a temperament
   * (`skeptic` / `referee` / `advocate`) drives ONLY that judge; every other
   * judge (and the synthesizer) uses the default agent — the first role-less
   * entry, else the env/instance judge backend, else the first entry overall.
   * A single role-less entry therefore powers all three judges.
   */
  agents?: JudgeAgentDescriptor[];
}

// ── Env-based accessors (global fallback) ─────────────────────────────────────

interface JudgePanelRequest {
  panelId: string;
  label?: string;
  answer: string;
  sources: JudgeSourceInput[];
}

interface JudgeRequestBody {
  question: string;
  panels: JudgePanelRequest[];
  isRefusalTest?: boolean;
  rounds?: number;
}

interface LiveJudgeResultBody {
  rounds: number;
  panels: JudgeVerdict[];
}

/** Base URL of the judge HTTP service. Override with VITE_JUDGE_URL.
 *  Optional chaining on `import.meta.env` is deliberate: under Vite it's
 *  always defined (statically replaced at build time), but this same module
 *  is also exercised directly under plain Node/tsx for the live integration
 *  check (no Vite define pass) — there, `import.meta.env` is `undefined`,
 *  and without the `?.` this throws before the fallback ever runs. */
export function judgeServiceUrl(): string {
  return getRuntimeEnv()?.judgeUrl || import.meta.env?.VITE_JUDGE_URL || 'http://localhost:8788';
}

/**
 * Returns true only when the judge is explicitly configured and should fire.
 *
 * - When a `<algolia-chat-confidence>` IS widget is registered, its `mode`
 *   decides: any mode other than `'off'` is active.
 * - When no confidence widget is present, fall back to the environment: only
 *   configured when a non-default judge URL is explicitly set. The default
 *   `'http://localhost:8788'` is a dev-time sentinel and never a real
 *   deployment, so absence of an explicit URL means "not configured".
 *
 * This is the canonical gate for `useJudge` — if it returns false, the hook
 * never fires a request and the badge never renders.
 */
export function isJudgeConfigured(confidence: { mode?: string } | null | undefined): boolean {
  if (confidence != null) return confidence.mode !== 'off';
  const env = getRuntimeEnv();
  if (env?.judgeUrl) return true;
  // VITE_JUDGE_URL is a build-time override; a non-empty value is intentional.
  if (import.meta.env?.VITE_JUDGE_URL) return true;
  return false;
}

/** The shared secret the hosted judge requires as `x-judge-api-key` (judge service auth).
 *  Undefined when unset — an unauthenticated local judge needs no header. */
export function judgeApiKey(): string | undefined {
  const k = getRuntimeEnv()?.judgeApiKey ?? import.meta.env?.VITE_JUDGE_API_KEY;
  return k && k.trim() ? k : undefined;
}

/** Which judge backend the chip uses. `hosted` (default) = the judge HTTP
 * service. `algolia` = three parallel, role-specific Agent Studio judges
 * aggregated by the immutable v3.3 contract. */
export function judgeMode(): 'hosted' | 'algolia' {
  const mode = getRuntimeEnv()?.judgeMode ?? import.meta.env?.VITE_JUDGE_MODE;
  return mode === 'algolia' ? 'algolia' : 'hosted';
}

// ---------------------------------------------------------------------------
// Hit -> judge source mapping
// ---------------------------------------------------------------------------

/** Map one raw `a:` hit (as collected by agentStudio.ts's collectHits) into
 *  the judge's {id, title, url, text} source shape. Which attributes carry the
 *  title, link and body is resolved by shared/recordFields, so an index that
 *  names them differently still yields evidence the judges can score against. */
export function mapHitToJudgeSource(hit: Record<string, unknown>): JudgeSourceInput {
  return {
    id: resolveRecordId(hit),
    title: pickRecordTitle(hit),
    url: pickRecordUrl(hit),
    text: pickRecordText(hit),
  };
}

/**
 * Map raw hits into judge sources, collapsing repeats of the same record.
 *
 * A turn can run several searches, and `rawHits` accumulates them all, so the
 * same page routinely arrives more than once. Duplicates add no evidence but
 * still consume the per-source excerpt budget, which starves the judges of the
 * text they score grounding against. Keeping the first occurrence preserves
 * retrieval order; the longest text wins so a fuller copy is never dropped in
 * favour of a thin one.
 */
export function mapHitsToJudgeSources(hits: Record<string, unknown>[]): JudgeSourceInput[] {
  const byId = new Map<string, JudgeSourceInput>();
  for (const hit of hits) {
    const source = mapHitToJudgeSource(hit);
    const seen = byId.get(source.id);
    if (!seen) byId.set(source.id, source);
    else if (source.text.length > seen.text.length) byId.set(source.id, source);
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

function errorVerdict(panelId: string, message: string, kind: JudgeErrorKind): JudgeVerdict {
  return {
    panelId,
    dims: { grounding: 0, coverage: 0, depth: 0, relevance: 0 },
    synthesizedScore: 0,
    composite: 0,
    preGateScore: 0,
    gateTripped: false,
    borderline: false,
    flaggedClaims: [],
    perJudge: [],
    rationale: '',
    error: message,
    errorKind: kind,
  };
}

/** Map an HTTP status from the judge service to a UI error category. */
function kindFromStatus(status: number): JudgeErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  return 'server';
}

function buildJudgeRequestBody(input: JudgeAnswerInput, panelId: string): JudgeRequestBody {
  return {
    question: input.question,
    rounds: 1,
    ...(input.isRefusalTest !== undefined ? { isRefusalTest: input.isRefusalTest } : {}),
    panels: [
      {
        panelId,
        ...(input.label ? { label: input.label } : {}),
        answer: input.answer,
        sources: mapHitsToJudgeSources(input.hits),
      },
    ],
  };
}

function buildJudgeHeaders(apiKeyOverride?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKeyOverride ?? judgeApiKey();
  if (key) headers['x-judge-api-key'] = key;
  return headers;
}

async function parseJudgeResponse(res: Response, panelId: string): Promise<JudgeVerdict> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return errorVerdict(
      panelId,
      `Judge service error ${res.status}: ${text.slice(0, 300)}`,
      kindFromStatus(res.status),
    );
  }

  let parsed: LiveJudgeResultBody;
  try {
    parsed = (await res.json()) as LiveJudgeResultBody;
  } catch (err) {
    return errorVerdict(
      panelId,
      `Judge service returned an unparseable response: ${err instanceof Error ? err.message : String(err)}`,
      'bad-response',
    );
  }

  const verdict = parsed.panels?.[0];
  if (!verdict)
    return errorVerdict(panelId, 'Judge service returned no panel verdict.', 'bad-response');
  return verdict;
}

/** POST one judge request to the hosted VPS service and return the verdict. */
async function postToHostedJudge(
  input: JudgeAnswerInput,
  panelId: string,
  config: Pick<JudgeRuntimeConfig, 'url' | 'apiKey'> | undefined,
  fetchImpl: typeof fetch,
): Promise<JudgeVerdict> {
  const serviceUrl = config?.url ?? judgeServiceUrl();
  let res: Response;
  try {
    res = await fetchImpl(`${serviceUrl}/api/judge`, {
      method: 'POST',
      headers: buildJudgeHeaders(config?.apiKey),
      body: JSON.stringify(buildJudgeRequestBody(input, panelId)),
    });
  } catch (err) {
    return errorVerdict(panelId, err instanceof Error ? err.message : String(err), 'offline');
  }
  return parseJudgeResponse(res, panelId);
}

/**
 * Judge one assistant answer. Always resolves — network failures, non-2xx
 * responses, and malformed response bodies all become an error verdict
 * (`error` set) rather than a thrown exception, so a judge outage never
 * breaks the chat UI.
 *
 * When `config` is provided it takes precedence over the global env singleton
 * (`getRuntimeEnv()`). useJudge supplies this from the IS renderState so judge
 * configuration flows through the widget system without touching the env singleton.
 *
 * Mode dispatch:
 *   `off`     — returns a silent skip verdict (no network call)
 *   `algolia` — runs the @confidence-engine in-browser via Agent Studio LLM
 *   `hosted`  — POSTs to the VPS judge service (default)
 */
export async function judgeAnswer(
  input: JudgeAnswerInput,
  fetchImpl: typeof fetch = fetch,
  config?: JudgeRuntimeConfig,
): Promise<JudgeVerdict> {
  const effectiveMode = config?.mode ?? judgeMode();
  const panelId = input.panelId ?? 'main';

  if (effectiveMode === 'off') {
    return errorVerdict(panelId, activeInstance.strings.judge.disabledMessage, 'server');
  }

  if (effectiveMode === 'algolia') {
    const { judgeAnswerViaPanel } = await import('./panelJudge');
    return judgeAnswerViaPanel(input, config);
  }

  return postToHostedJudge(input, panelId, config, fetchImpl);
}
