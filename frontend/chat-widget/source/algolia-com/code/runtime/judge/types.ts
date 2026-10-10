/**
 * judge/types — pure, runtime-free type definitions shared across the judge
 * feature (client, components, hooks) and consumed by the chat UI.
 *
 * These live here (not in hostedJudgeClient.ts) so that type consumers —
 * ChatMessage, ChatPanel, ChatWidget, ConfidenceBadge, JudgeDrawer, etc. —
 * do not have to import the network client module just to reference a shape.
 */

export type JudgeRole = 'skeptic' | 'referee' | 'advocate';

/**
 * One role-specific judge descriptor. The approved panel requires exactly one
 * distinct Agent Studio agent for skeptic, referee, and advocate.
 */
export interface JudgeAgentDescriptor {
  /** Agent Studio agent UUID. */
  id: string;
  /**
   * Required judge role: skeptic, referee, or advocate.
   */
  role?: string;
  /** Human-readable label for debugging / drawer display. */
  label?: string;
}

/** Per-dimension mean scores (0–10), keyed by the backend's dimension ids.
 *  The hosted judge (judge.contentengagement.info) currently returns the
 *  3-dimension rubric — `grounding` / `confidence` / `breadthDepth` — but this
 *  is kept loose (Record) so a rubric change on the backend renders whatever it
 *  sends instead of crashing on a missing key. */
export type JudgeDims = Record<string, number>;

export interface JudgeDimension {
  id: string;
  label: string;
  score: number;
}

/** A claim the Skeptic flagged as unsupported by the sources. The live backend
 *  names the 0–1 score `confidence`; older/batch shapes use `certainty`. Read
 *  whichever is present (see JudgeDrawer). */
export interface JudgeFlaggedClaim {
  claim: string;
  reason: string;
  certainty?: number;
  confidence?: number;
}

export interface JudgePerJudge {
  role: JudgeRole;
  score: number;
  note: string;
}

/** Coarse category for a failed judge call, so the UI can say *why* Confidence
 *  is missing (auth vs offline vs rate-limited vs server) instead of a flat
 *  "unavailable". Client-only — the backend never sets this. */
export type JudgeErrorKind = 'auth' | 'rate-limit' | 'offline' | 'server' | 'bad-response';

export interface JudgeVerdict {
  panelId: string;
  dims: JudgeDims;
  dimensions?: JudgeDimension[];
  synthesizedScore: number;
  /** The "Confidence" composite (0-10), post-gate. */
  composite: number;
  preGateScore: number;
  gateTripped: boolean;
  borderline: boolean;
  flaggedClaims: JudgeFlaggedClaim[];
  perJudge: JudgePerJudge[];
  rationale: string;
  /** Set only when THIS panel failed (service error, bad response shape, etc). */
  error?: string;
  /** Category of the failure (set alongside `error`), for a specific UI label. */
  errorKind?: JudgeErrorKind;

  // ── Deterministic grounding (optional; newer judge backends only) ──────────
  //
  // A judge backend may additionally run a DETERMINISTIC grounding check: for
  // every term in the answer that cannot legitimately be paraphrased — code
  // identifiers, CamelCase API names, scaled numbers — verify verbatim that the
  // term occurs in a cited source. Unlike the LLM panel's score, that check is a
  // pure function of (answer, sources): the same input always yields the same
  // result. Where a backend reports it, the badge states it instead of the
  // composite, because it is the one part of the verdict that is reproducible.
  //
  // All fields are optional. A backend that does not run the check simply omits
  // them and the badge falls back to the composite exactly as before.

  /** True when every verbatim-checkable term was located in a cited source. */
  grounded?: boolean;
  /** How many terms the deterministic check examined. 0 = nothing checkable
   *  (a prose-only answer or a refusal), which is NOT the same as "verified". */
  termsChecked?: number;
  /** The terms that appear in the answer but in none of the cited sources. */
  unsupportedTerms?: JudgeUnsupportedTerm[];
  /** Which mechanism produced the served verdict, when the backend reports it. */
  groundingMode?: string;

  /**
   * True when this verdict carries ONLY the deterministic grounding result and
   * the LLM panel is still running.
   *
   * The two halves of a verdict cost wildly different amounts: the grounding
   * check is a string search (measured: 8ms), while the three-judge panel is
   * three LLM calls (measured: 18-32s each). A backend that can serve the cheap
   * half separately lets the badge — which displays only the grounding result —
   * appear immediately instead of waiting half a minute for a composite the
   * badge does not show.
   *
   * While this is true, `composite` / `dims` / `perJudge` are NOT yet meaningful
   * and must not be rendered as zeros.
   */
  panelPending?: boolean;
}

/** One term the deterministic grounding check could not locate in any source. */
export interface JudgeUnsupportedTerm {
  /** The literal term as it appears in the answer, e.g. `allowsCustomValue`. */
  term: string;
  /** Optional class of term (identifier / number / API name), backend-defined. */
  kind?: string;
}

export interface JudgeSourceInput {
  id: string;
  title?: string;
  url?: string;
  /** Substantive body the grounding gate checks claims against. */
  text: string;
}

export interface JudgeAnswerInput {
  question: string;
  answer: string;
  /** Raw `a:` hits for the answer being judged (AnswerSegment.rawHits). */
  hits: Record<string, unknown>[];
  isRefusalTest?: boolean;
  panelId?: string;
  label?: string;
}
