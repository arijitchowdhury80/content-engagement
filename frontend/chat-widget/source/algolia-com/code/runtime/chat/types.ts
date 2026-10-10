/**
 * Core data contracts for the chat UI. Stack-agnostic protocol/shape
 * definitions consumed by components, useChat, and the judge layer.
 */

/** The key of the agent that produced a segment. Matches AgentDescriptor.key —
 *  `'primary'` for the front agent, the specialist's own key (e.g. `'code'`,
 *  `'design'`) for deep-dive segments. Identity is never color-only in the UI:
 *  every chip pairs this with an icon + text label resolved via getAgentByKey. */
export type AgentKind = string;

/** A prior turn as sent back to Agent Studio in `messages[]`. Defined with the
 *  Agent Studio wire client (shared/agentStudio) and re-exported here for the
 *  chat UI's convenience. */
export type { HistoryEntry } from '../shared/agentStudio';

/** One grounded citation, normalized from a raw Agent Studio `a:` hit. */
export interface AnswerSource {
  /** Stable dedup id — prefers objectID, falls back to url. */
  id: string;
  title: string;
  url?: string;
  /** The hit's configured `source` facet. */
  source?: string;
}

/** Lifecycle of a single agent's contribution within a turn. */
export type SegmentStatus = 'loading' | 'streaming' | 'success' | 'error';

/** One agent's answer segment. A turn has one Primary segment, and a second
 *  Specialist segment only when the user accepts the deep-dive offer. */
export interface AnswerSegment {
  /** Stable public identity used to preserve this rendered message across navigation. */
  messageId?: string;
  agent: AgentKind;
  status: SegmentStatus;
  /** Streamed answer text (already clean — no in-band sentinel to strip). */
  text: string;
  sources: AnswerSource[];
  /** Count of tool-result frames (`a:`) seen — drives the "searched · N sources"
   *  trace line independent of dedup count. */
  searchCount: number;
  /** Present when status === 'error'. Human-readable, never a raw stack. */
  error?: string;
  /** Raw, un-normalized `a:` hit objects for this segment (as collected by
   *  agentStudio.ts's collectHits) — kept alongside the normalized `sources`
   *  above ONLY so the live judge can read each hit's full body/content text.
   *  `sources` (AnswerSource) intentionally drops that body text; the judge
   *  needs it to score grounding against the real record text. */
  rawHits?: Record<string, unknown>[];
  /** Contextual next questions (2-3 discovery angles, or fewer when the hits
   *  only support one good follow-up) rendered as one-click discovery cards,
   *  generated from THIS segment's own answer + hits. Lives on the segment
   *  (not the turn) so it stays anchored to the answer it followed up on —
   *  a turn-level field rendered "after all segments" would visually drift
   *  below a specialist deep-dive segment appended later, looking like a
   *  non-sequitur reply to the specialist instead of to this segment. */
  followUps?: string[];
}

/** One full user turn: the question plus the assistant answer, and — only if
 *  the user opts into a deeper dive — a second specialist segment.
 *
 *  Deep-dive is HUMAN-GATED: the orchestrator proposes a specialist by calling
 *  the ask_specialist tool, but that call blocks and the specialist NEVER runs
 *  until the user clicks "yes". State machine:
 *    deepDiveOffered=false                        → no offer (nothing to do)
 *    deepDiveOffered=true,  handoff=false          → offer shown, awaiting user
 *    deepDiveOffered=false, deepDiveDeclined=true  → user declined the offer
 *    handoff=true                                  → user accepted; specialist ran
 */
export interface ChatTurn {
  id: string;
  /** Stable public identity for the visitor message paired with this turn. */
  userMessageId?: string;
  query: string;
  segments: AnswerSegment[];
  /** True once the specialist deep-dive has actually run (segment[1] exists). */
  handoff: boolean;
  /** The front agent proposed a deep-dive and we're awaiting the user's choice. */
  deepDiveOffered: boolean;
  /** The user dismissed the deep-dive offer for this turn. */
  deepDiveDeclined?: boolean;
  /** Query to send the specialist when the user accepts the deep-dive. */
  deepDiveQuery?: string;
  /** The key of the specialist the orchestrator asked for. */
  deepDiveSpecialist?: string;
}
