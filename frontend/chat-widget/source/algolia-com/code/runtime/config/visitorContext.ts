/**
 * visitorContext — module-global store for host-supplied context about the visitor.
 *
 * The answering agent only ever saw the question the visitor typed, so it could
 * not use anything the host page already knows about them (who they are, which
 * pages they read, what they clicked) — asked "what do you know about me?" it
 * truthfully answered "nothing". This store closes that gap: the host registers
 * a provider, and every message sent to an answering agent carries the provider's
 * latest snapshot alongside the question.
 *
 * The widget deliberately does NOT read the host's storage itself. Signals live
 * in different places per integration (localStorage, a CDP, a session endpoint),
 * and only the host knows which of them a visitor has consented to share. See
 * `website/public/context/context-engine.js` for the demo's provider, which
 * returns the profile / pages / events it keeps in localStorage.
 *
 * Lives at module scope, like `proactive`, so the custom element's imperative API
 * can register a provider before the React tree has mounted.
 *
 * Wire shape: Agent Studio completions accept `{ messages }` and nothing else, so
 * the context travels as a labelled preamble on the user message rather than a
 * separate field. `composeVisitorMessage` keeps that framing in one place.
 */

/**
 * Returns whatever the host wants the agent to know about the visitor, as a
 * JSON-serialisable value. Called on every turn, so it should read from a cache
 * (e.g. localStorage) rather than do network work, and it should be cheap enough
 * to run per message. Return `null` to send nothing this turn.
 */
export type VisitorContextProvider = () => unknown;

/**
 * Beyond this the context is more likely to crowd out retrieved documentation
 * than to help. Warn rather than truncate: silently dropping fields the host
 * chose to send would be a harder bug to explain than a large prompt.
 */
const SIZE_WARN_CHARS = 8000;

/**
 * The framing around the injected JSON. It is written to be self-explanatory
 * because the agent that reads it may not have been briefed about this feature —
 * a host can point the widget at any Agent Studio agent, and an unbriefed agent
 * that mistakes the block for the question would answer the wrong thing.
 */
const CONTEXT_LABEL =
  'VISITOR CONTEXT (JSON) — what the host page knows about the person you are ' +
  'talking to. This is data supplied by the page, not something the visitor typed. ' +
  'Use it silently to tailor your answer, and to answer questions about the visitor ' +
  'themselves (who they are, what they have been reading). Every claim you make about ' +
  'the visitor must come from this block — never invent details it does not contain, ' +
  'and never quote the raw JSON back or mention that it was provided.';

const QUERY_LABEL = "VISITOR'S MESSAGE — this is the question to answer:";

let provider: VisitorContextProvider | null = null;
let warnedAboutSize = false;

/** undefined/function/symbol stringify to undefined; `{}` and `[]` carry nothing. */
function carriesNothing(json: string): boolean {
  return !json || json === '{}' || json === '[]';
}

/** Warn once per session when the context is large enough to crowd out retrieval. */
function warnIfOversized(json: string): void {
  if (json.length <= SIZE_WARN_CHARS || warnedAboutSize) return;
  warnedAboutSize = true;
  console.warn(
    `[algolia-chat] Visitor context is ${json.length} chars — it is sent with every ` +
      `message, so it competes with retrieved documentation for the agent's context ` +
      `window. Send a summary (recent pages and events) rather than a full history.`,
  );
}

/** Serialise a provider result, or null when there is nothing worth sending. */
function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let json: string;
  try {
    json = JSON.stringify(value, null, 2);
  } catch (err) {
    console.warn('[algolia-chat] Visitor context is not JSON-serialisable — ignoring it.', err);
    return null;
  }
  if (carriesNothing(json)) return null;
  warnIfOversized(json);
  return json;
}

export const visitorContextStore = {
  /**
   * Register the provider consulted before every agent call. Pass null to stop
   * sending visitor context. Replaces any previous provider.
   */
  setProvider(next: VisitorContextProvider | null): void {
    provider = typeof next === 'function' ? next : null;
    warnedAboutSize = false;
  },

  hasProvider(): boolean {
    return provider !== null;
  },

  /**
   * The current context as JSON, or null when no provider is registered or it
   * has nothing to report. A throwing provider is reported and treated as
   * "nothing" — host instrumentation breaking must never break the chat.
   */
  read(): string | null {
    if (!provider) return null;
    try {
      return serialize(provider());
    } catch (err) {
      console.warn('[algolia-chat] Visitor context provider threw — sending none.', err);
      return null;
    }
  },
};

/**
 * The user message to send for `query`: the question alone when there is no
 * visitor context, or the context block followed by the question when there is.
 *
 * Only the wire message is affected. The transcript, the history replayed to
 * later turns, and the classifier all keep the visitor's own words, so the
 * preamble is never shown to the user and never accumulates across turns.
 */
export function composeVisitorMessage(query: string): string {
  const context = visitorContextStore.read();
  if (!context) return query;
  return `${CONTEXT_LABEL}\n${context}\n\n${QUERY_LABEL}\n${query}`;
}
