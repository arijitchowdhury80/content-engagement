/**
 * agentStudio — browser-direct Agent Studio completions client (ai-sdk-5).
 *
 * Wire contract (ai-sdk-5 Streamable SSE, confirmed by live spike 2026-07-30):
 *   POST https://{APP_ID}.algolia.net/agent-studio/1/agents/{ID}/completions
 *         ?compatibilityMode=ai-sdk-5
 *   Headers: Content-Type: application/json, X-Algolia-Application-Id,
 *            X-Algolia-API-Key (search-only)
 *   Body (first turn):
 *     { messages: [{ role:'user', parts:[{type:'text',text:'...'}] }] }
 *   Body (after client-side tool result):
 *     { messages: [...history,
 *         { role:'assistant', parts:[
 *           { type:`tool-${toolName}`, toolCallId,
 *             state:'output-available', input, output }
 *         ]},
 *       ] }
 *
 *   These are ai-sdk **v5** UIMessage parts. The v4 spelling
 *   ({type:'tool-invocation', toolInvocationId, state:'result', args, result})
 *   type-checks locally but is rejected by the API with a 422.
 *
 *   Returns: SSE lines "data: {JSON}" where each JSON has a `type` field:
 *     start            — conversation start
 *     start-step       — LLM step start
 *     text-start       — text segment starts (id field)
 *     text-delta       — incremental text (delta field)
 *     text-end         — text segment ends
 *     tool-input-start — tool call begins streaming
 *     tool-input-delta — partial tool input (inputTextDelta)
 *     tool-input-available — full tool call ready (toolCallId, toolName, input)
 *     tool-output-available — built-in tool result (toolCallId, output)
 *     data-tool-output-metadata — metadata frame, can be ignored
 *     data-suggestions — follow-up suggestions (data.suggestions[])
 *     finish-step      — LLM step done
 *     finish           — conversation done
 *
 * Browsers FORBID setting a custom User-Agent header (forbidden header) —
 * do not add one here.
 */

import type {
  OrchestratorRuntimeContext,
  OrchestratorTransport,
} from '../config/orchestratorTransport';

// ── Wire types ─────────────────────────────────────────────────────────────────

/**
 * A prior turn sent back to Agent Studio in `messages[]`.
 * Re-exported from `chat/types` for backward compatibility.
 */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/** A pending client-side tool call emitted by the agent. */
export interface ToolInvocation {
  tool_call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
}

/** Accumulated result of one completions call (or one tool loop step). */
export interface ParsedCompletion {
  content: string;
  toolInvocations: ToolInvocation[];
  hits: Record<string, unknown>[];
  suggestions: string[];
  error?: string;
}

// ── URL builder ───────────────────────────────────────────────────────────────

export function getAgentStudioUrl(appId: string, agentId: string): string {
  return `https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-5`;
}

// ── Message builders ──────────────────────────────────────────────────────────

/** v5 user message part. */
interface TextPart {
  type: 'text';
  text: string;
}

/**
 * Agent Studio's per-turn context contract. It is intentionally flat: nested
 * payloads, identifiers, and large telemetry packets belong in the client
 * runtime, not in the model request.
 */
export type TurnContext = Record<string, string>;

/**
 * v5 assistant tool part.
 *
 * This is the ai-sdk **v5** UIMessage shape, which differs from v4 in every
 * field name that matters: the discriminator carries the tool name
 * (`tool-<name>`, not a literal `tool-invocation`), the id is `toolCallId`
 * (not `toolInvocationId`), and args/result are `input`/`output` under a
 * lifecycle `state`. Sending the v4 shape is accepted by TypeScript but
 * rejected by the API with a 422 naming every branch of the part union.
 */
interface ToolPart {
  type: `tool-${string}`;
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
}

/** v5 message shapes used in the messages array. */
type V5Message =
  { role: 'user'; parts: TextPart[]; metadata?: { turnContext: TurnContext } }
  | { role: 'assistant'; parts: Array<TextPart | ToolPart> };

/**
 * Convert a `HistoryEntry` (role/content flat form) into the v5 parts format.
 * Assistant messages that were recorded from a previous turn become a single
 * text part; user messages likewise. Tool-call messages from prior steps in the
 * current turn are already typed as `V5Message` and pass through unchanged.
 */
function historyEntryToV5(entry: HistoryEntry): V5Message {
  if (entry.role === 'user') {
    return { role: 'user', parts: [{ type: 'text', text: entry.content }] };
  }
  // Assistant history entries are plain text (prior turn summaries).
  return { role: 'assistant', parts: [{ type: 'text', text: entry.content }] };
}

/**
 * Build the messages array for a completions request.
 *
 * `history` contains prior turns as flat HistoryEntry pairs.
 * `query` is the current user question.
 * `stepMessages` carries any in-progress tool-call/tool-result messages from
 *   earlier steps in the current turn's tool loop.
 */
function buildMessages(
  history: HistoryEntry[],
  query: string,
  stepMessages: V5Message[] = [],
  turnContext?: TurnContext,
): V5Message[] {
  const prior = history.map(historyEntryToV5);
  const current: V5Message = {
    role: 'user',
    parts: [{ type: 'text', text: query }],
    ...(turnContext && Object.keys(turnContext).length > 0 ? { metadata: { turnContext } } : {}),
  };
  return [...prior, current, ...stepMessages];
}

// ── SSE parser ────────────────────────────────────────────────────────────────

interface ParseState {
  content: string;
  toolInvocations: ToolInvocation[];
  hits: Record<string, unknown>[];
  suggestions: string[];
  error: string | undefined;
}

/** Parse a single `data:` SSE line. Returns null when not a data line. */
function parseV5DataLine(rawLine: string): Record<string, unknown> | null {
  const line = rawLine.trim();
  if (!line.startsWith('data:')) return null;
  const payload = line.slice('data:'.length).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract hit objects from a `tool-output-available` output value.
 *
 * Every object retrieval returns is kept. Algolia is schemaless, so there is no
 * attribute whose absence means "not a record" — an earlier version required a
 * `title` or `url` and silently discarded entire indexes that name those fields
 * something else. Deciding what is worth citing is the renderer's job and
 * deciding what is worth believing is the judges'; neither can do it with data
 * that never arrives.
 */
function collectHits(result: unknown, sink: Record<string, unknown>[]): void {
  if (!result || typeof result !== 'object') return;
  const routeHit = (h: unknown) => {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return;
    const rec = h as Record<string, unknown>;
    // A multi-index search returns one result envelope per query. The records
    // are inside the envelope; the envelope itself is not one.
    if (Array.isArray(rec.hits)) {
      (rec.hits as unknown[]).forEach(routeHit);
      return;
    }
    sink.push(rec);
  };
  if (Array.isArray(result)) {
    result.forEach(routeHit);
    return;
  }
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj.hits)) {
    (obj.hits as unknown[]).forEach(routeHit);
    return;
  }
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) (obj[key] as unknown[]).forEach(routeHit);
  }
}

type EventHandler = (
  ev: Record<string, unknown>,
  state: ParseState,
  onText?: (acc: string) => void,
) => void;

/**
 * Handlers for the SSE event types we care about.
 *
 * Every other event is metadata, lifecycle, or a streaming delta we rebuild
 * from its `*-available` counterpart — start, start-step, text-start, text-end,
 * tool-input-start, tool-input-delta, data-tool-output-metadata, finish-step,
 * and finish are all deliberately absent.
 */
const EVENT_HANDLERS: Record<string, EventHandler> = {
  'text-delta': (ev, state, onText) => {
    if (typeof ev.delta !== 'string') return;
    state.content += ev.delta;
    onText?.(state.content);
  },

  'tool-input-available': (ev, state) => {
    state.toolInvocations.push({
      tool_call_id: (ev.toolCallId as string) ?? '',
      tool_name: (ev.toolName as string) ?? '',
      args: (ev.input as Record<string, unknown>) ?? {},
    });
  },

  'tool-output-available': (ev, state) => {
    collectHits(ev.output, state.hits);
  },

  'data-suggestions': (ev, state) => {
    const data = ev.data as Record<string, unknown> | undefined;
    const suggestions = data?.suggestions;
    if (!Array.isArray(suggestions)) return;
    for (const s of suggestions) {
      if (typeof s === 'string') state.suggestions.push(s);
    }
  },

  error: (ev, state) => {
    const msg = ev.message ?? ev.error;
    state.error = typeof msg === 'string' ? msg : JSON.stringify(msg);
  },
};

/** Apply one parsed SSE event to the running parse state. */
function applyEvent(
  ev: Record<string, unknown>,
  state: ParseState,
  onText?: (acc: string) => void,
): void {
  if (typeof ev.type !== 'string') return;
  EVENT_HANDLERS[ev.type]?.(ev, state, onText);
}

/**
 * Fold an array of raw SSE lines into a `ParsedCompletion`.
 * `onText` is called after each text-delta with the accumulated content.
 *
 * Only lines starting with `data:` and containing valid JSON are processed;
 * all others are silently skipped.
 */
export function parseCompletionStream(
  lines: string[],
  onText?: (accumulated: string) => void,
): ParsedCompletion {
  const state: ParseState = {
    content: '',
    toolInvocations: [],
    hits: [],
    suggestions: [],
    error: undefined,
  };
  for (const rawLine of lines) {
    const ev = parseV5DataLine(rawLine);
    if (ev) applyEvent(ev, state, onText);
  }
  return {
    content: state.content,
    toolInvocations: state.toolInvocations,
    hits: state.hits,
    suggestions: state.suggestions,
    error: state.error,
  };
}

// ── Streaming reader ──────────────────────────────────────────────────────────

/** Read a ReadableStream line by line, incrementally parsing events. */
async function readStreamLines(
  body: ReadableStream<Uint8Array>,
  onText?: (accumulated: string) => void,
  onProgress?: (partial: ParsedCompletion) => void,
): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const lines: string[] = [];
  let lastContentLen = -1;
  let lastHitsLen = -1;

  const state: ParseState = {
    content: '',
    toolInvocations: [],
    hits: [],
    suggestions: [],
    error: undefined,
  };

  const flush = () => {
    const contentChanged = state.content.length !== lastContentLen;
    const hitsChanged = state.hits.length !== lastHitsLen;
    if (!contentChanged && !hitsChanged) return;
    lastContentLen = state.content.length;
    lastHitsLen = state.hits.length;
    onProgress?.({ ...state });
  };

  const consumeLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    lines.push(line);
    const ev = parseV5DataLine(line);
    if (!ev) return;
    applyEvent(ev, state, onText);
    flush();
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const split = buffer.split('\n');
      buffer = split.pop() ?? '';
      split.forEach(consumeLine);
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim()) lines.push(buffer.trim());
  return lines;
}

// ── Network calls ─────────────────────────────────────────────────────────────

export interface CompletionsConfig {
  appId: string;
  searchKey: string;
  agentId: string;
}

export interface CompletionsRequest {
  history?: HistoryEntry[];
  query: string;
  /** Hidden, current-turn-only context sent using Agent Studio's ai-sdk-5 contract. */
  turnContext?: TurnContext;
  /** Local correlation only; passed as the transport's third argument, never serialized. */
  runtimeContext?: OrchestratorRuntimeContext;
}

export interface CompletionCallbacks {
  onText?: (accumulated: string) => void;
  onProgress?: (partial: ParsedCompletion) => void;
}

export interface CallCompletionsOptions {
  callbacks?: CompletionCallbacks;
  /** Injected fetch implementation — defaults to global fetch (override in tests). */
  fetchImpl?: typeof fetch;
  /** In-progress tool messages from the current tool loop. */
  stepMessages?: V5Message[];
}

/** HTTP failure returned by Agent Studio, including retry guidance when supplied. */
export class AgentStudioRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, responseText: string, retryAfter: string | null) {
    super(`Agent Studio error ${status}: ${responseText.substring(0, 500)}`);
    this.name = 'AgentStudioRequestError';
    this.status = status;
    this.retryAfterMs = parseRetryAfterMs(retryAfter);
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** POST to Agent Studio completions and stream the response. */
export async function callCompletions(
  config: CompletionsConfig,
  req: CompletionsRequest,
  opts: CallCompletionsOptions = {},
): Promise<ParsedCompletion> {
  const { callbacks, fetchImpl = fetch, stepMessages = [] } = opts;
  const messages = buildMessages(req.history ?? [], req.query, stepMessages, req.turnContext);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Algolia-Application-Id': config.appId,
    'X-Algolia-API-Key': config.searchKey,
  };

  const res = await (fetchImpl as OrchestratorTransport)(getAgentStudioUrl(config.appId, config.agentId), {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages }),
  }, req.runtimeContext);

  const body = await streamableBody(res);
  const lines = await readStreamLines(body, callbacks?.onText, callbacks?.onProgress);
  return parseCompletionStream(lines);
}

/** Return the response body, turning an error status or empty body into a throw. */
async function streamableBody(res: Response): Promise<ReadableStream<Uint8Array>> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AgentStudioRequestError(res.status, text, res.headers.get('Retry-After'));
  }
  if (!res.body) {
    throw new Error('Agent Studio response has no body to stream');
  }
  return res.body;
}

/**
 * Call completions with one automatic retry on the known Agent Studio flake
 * (~1-in-8 baseline): empty response with no error, or a thrown error.
 */
export async function callWithRetry(
  config: CompletionsConfig,
  req: CompletionsRequest,
  onText?: (accumulated: string) => void,
  onProgress?: (partial: ParsedCompletion) => void,
): Promise<ParsedCompletion> {
  const opts: CallCompletionsOptions = { callbacks: { onText, onProgress } };
  try {
    const result = await callCompletions(config, req, opts);
    if (!result.error && !result.content.trim() && result.toolInvocations.length === 0) {
      return await callCompletions(config, req, opts);
    }
    return result;
  } catch {
    return await callCompletions(config, req, opts);
  }
}

// ── Tool loop ─────────────────────────────────────────────────────────────────

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

export type ToolRegistry = Record<string, ToolHandler>;

export interface RunToolLoopOptions {
  /** Maximum number of LLM→tool→LLM round-trips (default 4). */
  maxSteps?: number;
  /** Per-tool handler timeout in ms (default 30 000). */
  toolTimeoutMs?: number;
  /** Streaming callbacks, rebased across steps so content never rewinds. */
  callbacks?: CompletionCallbacks;
  /** Injected fetch implementation — defaults to global fetch (override in tests). */
  fetchImpl?: typeof fetch;
  /**
   * `automatic` keeps the general chat transport's one transient retry.
   * `caller-owned` performs one wire call per step so a higher-level protocol,
   * such as the three-role judge panel, remains the sole retry authority.
   */
  completionRetry?: 'automatic' | 'caller-owned';
}

/** `RunToolLoopOptions` with every default applied. */
interface ResolvedLoopOptions {
  maxSteps: number;
  toolTimeoutMs: number;
  callbacks?: CompletionCallbacks;
  fetchImpl: typeof fetch;
  completionRetry: 'automatic' | 'caller-owned';
}

function resolveLoopOptions(opts: RunToolLoopOptions): ResolvedLoopOptions {
  return {
    maxSteps: opts.maxSteps ?? 4,
    toolTimeoutMs: opts.toolTimeoutMs ?? 30_000,
    callbacks: opts.callbacks,
    fetchImpl: opts.fetchImpl ?? fetch,
    completionRetry: opts.completionRetry ?? 'automatic',
  };
}

/** Structured error returned to the agent when a handler times out or throws. */
interface ToolError {
  success: false;
  error: { code: string; message: string };
}

/** Build a tool-error result the agent can interpret. */
function toolError(code: string, message: string): ToolError {
  return { success: false, error: { code, message } };
}

/**
 * Rebase a step's streaming callbacks onto what previous steps already produced.
 *
 * Every step gets a fresh parser whose content starts empty, but consumers treat
 * the streamed value as the entire answer so far and overwrite what they hold.
 * Without this, the first step after a tool call visibly erases the prose that
 * preceded it — the final value is still correct, but the user watches the
 * answer rewind mid-stream.
 */
function offsetCallbacks(
  callbacks: CompletionCallbacks | undefined,
  soFar: ParsedCompletion,
): CompletionCallbacks | undefined {
  if (!callbacks) return undefined;
  const { onText, onProgress } = callbacks;
  const contentBefore = soFar.content;
  const hitsBefore = soFar.hits.slice();

  return {
    onText: onText ? (text) => onText(contentBefore + text) : undefined,
    onProgress: onProgress
      ? (partial) =>
          onProgress({
            ...partial,
            content: contentBefore + partial.content,
            hits: [...hitsBefore, ...partial.hits],
          })
      : undefined,
  };
}

function isEmptyCompletion(result: ParsedCompletion): boolean {
  return (
    !result.error &&
    !result.content.trim() &&
    result.toolInvocations.length === 0 &&
    result.hits.length === 0 &&
    result.suggestions.length === 0
  );
}

function isRetryableCompletionError(error: unknown): boolean {
  if (error instanceof AgentStudioRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/Agent Studio error (\d{3})/)?.[1];
  if (!status) return true;
  const code = Number(status);
  return code === 408 || code === 429 || code >= 500;
}

async function callCompletionStep(
  config: CompletionsConfig,
  req: CompletionsRequest,
  opts: CallCompletionsOptions,
  retry: ResolvedLoopOptions['completionRetry'],
): Promise<ParsedCompletion> {
  if (retry === 'caller-owned') return callCompletions(config, req, opts);
  try {
    const result = await callCompletions(config, req, opts);
    return isEmptyCompletion(result) ? await callCompletions(config, req, opts) : result;
  } catch (error) {
    if (!isRetryableCompletionError(error)) throw error;
    return callCompletions(config, req, opts);
  }
}

/** Run one tool handler with a timeout. Never throws — returns a toolError on failure. */
async function runHandler(
  name: string,
  handler: ToolHandler,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  // The timer must be cleared once the race settles. Left running, every tool
  // call holds a live timeout for its full duration even after the handler has
  // resolved — which keeps a Node event loop alive and accumulates in the browser.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([handler(args), timeout]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError('HANDLER_ERROR', msg);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a full tool loop against one Agent Studio agent.
 *
 * On each step the agent is called; any tool invocations whose names match
 * `registry` are executed concurrently, and the results are sent back as a
 * follow-up call. Unrecognised tool names (built-in Algolia tools, etc.) are
 * not sent back — the agent already has their results via `tool-output-available`.
 *
 * The loop terminates when:
 *  - the agent emits no new client-side tool invocations, OR
 *  - `maxSteps` iterations are exhausted (guard against infinite loops).
 *
 * Content, hits, and suggestions accumulate across all steps so callers see the
 * full answer once the loop completes.
 */
/**
 * Run every client-side tool call concurrently and shape the results into the
 * ai-sdk-5 UIMessage parts the API validates against.
 *
 * `output-available` carries the completed result directly — no preceding
 * `input-available` part is needed.
 */
async function executeToolCalls(
  clientCalls: ToolInvocation[],
  registry: ToolRegistry,
  toolTimeoutMs: number,
): Promise<ToolPart[]> {
  const results = await Promise.all(
    clientCalls.map((tc) =>
      runHandler(tc.tool_name, registry[tc.tool_name], tc.args, toolTimeoutMs).then((result) => ({
        tc,
        result,
      })),
    ),
  );

  return results.map(({ tc, result }) => ({
    type: `tool-${tc.tool_name}`,
    toolCallId: tc.tool_call_id,
    state: 'output-available',
    input: tc.args,
    output: result,
  }));
}

export async function runToolLoop(
  config: CompletionsConfig,
  req: CompletionsRequest,
  registry: ToolRegistry,
  opts: RunToolLoopOptions = {},
): Promise<ParsedCompletion> {
  const { maxSteps, toolTimeoutMs, callbacks, fetchImpl, completionRetry } = resolveLoopOptions(opts);

  const accumulated: ParsedCompletion = {
    content: '',
    toolInvocations: [],
    hits: [],
    suggestions: [],
    error: undefined,
  };

  // Ongoing message parts for the current turn (assistant tool calls + tool results).
  const stepMessages: V5Message[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const stepResult = await callCompletionStep(config, req, {
      callbacks: offsetCallbacks(callbacks, accumulated),
      fetchImpl,
      stepMessages,
    }, completionRetry);

    // Accumulate across steps.
    accumulated.content += stepResult.content;
    accumulated.hits.push(...stepResult.hits);
    accumulated.suggestions.push(...stepResult.suggestions);
    if (stepResult.error && !accumulated.error) accumulated.error = stepResult.error;

    // Find client-side tool calls (names in our registry).
    const clientCalls = stepResult.toolInvocations.filter((tc) => tc.tool_name in registry);

    if (clientCalls.length === 0) break; // No more client-side work — done.

    const toolParts = await executeToolCalls(clientCalls, registry, toolTimeoutMs);
    stepMessages.push({ role: 'assistant', parts: toolParts });

    // An accepted, completed ask_specialist call is not like other tools: its
    // result is a FINISHED answer that renders in its own segment, not data
    // for the orchestrator to keep synthesizing into more of its own text. A
    // further step here would call the model again with that result in
    // context, and — observed live, not hypothetical — the model doesn't
    // reliably stay quiet; it writes a second, redundant answer to the
    // original question, which then displays doubled up ahead of the
    // specialist's own segment. Ending the loop here prevents that
    // generation from happening at all, rather than requesting it and then
    // hiding it. (Declined or errored ask_specialist calls fall through and
    // continue the loop as normal — the orchestrator is explicitly meant to
    // keep going and answer from its own sources in both of those cases.)
    const specialistHandled = toolParts.some((p) => {
      if (p.type !== 'tool-ask_specialist') return false;
      const output = p.output as { declined?: boolean; success?: boolean } | undefined;
      return !output?.declined && output?.success !== false;
    });
    if (specialistHandled) break;
  }

  return accumulated;
}
