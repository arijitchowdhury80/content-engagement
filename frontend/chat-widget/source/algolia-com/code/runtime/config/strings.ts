/**
 * WidgetStrings — all user-facing text the widget renders, grouped by
 * component. English defaults are provided in `defaultStrings`.
 *
 * Consumers supply a DeepPartial override via the `strings` JSON attribute (or
 * a `<script type="application/json" slot="strings">` child) on `<algolia-chat>`.
 * Only the keys being translated need to be present — untouched keys fall back
 * to their English defaults.
 *
 * Templated strings use `{varName}` tokens. Call `interpolate(template, vars)`
 * to substitute values at render time.
 */

// ---------------------------------------------------------------------------
// Deep-partial helper (used in RuntimeConfig for the strings override type)
// ---------------------------------------------------------------------------

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

// ---------------------------------------------------------------------------
// WidgetStrings interface
// ---------------------------------------------------------------------------

export interface JudgeBadgeErrors {
  auth: { tail: string; hint: string };
  'rate-limit': { tail: string; hint: string };
  offline: { tail: string; hint: string };
  server: { tail: string; hint: string };
  'bad-response': { tail: string; hint: string };
}

export interface WidgetStrings {
  widget: {
    /** FAB button aria-label */
    openChat: string;
    /** FAB button aria-label while the concierge agent is analysing context */
    analyzing: string;
    /**
     * Eyebrow above a proactive greeting, identifying which persona is
     * speaking. `{persona}` is replaced with the active persona label.
     */
    proactivePersonaLabel: string;
    /** Screen-reader announcement prefix for a proactive greeting. */
    proactiveGreetingLabel: string;
    /** Auto-engage toggle label when the feature is ON (clicking turns it off). */
    autoEngageOn: string;
    /** Auto-engage toggle label when the feature is OFF (clicking turns it on). */
    autoEngageOff: string;
    /** Modal dialog aria-label */
    modalLabel: string;
    /** Warning shown when Algolia credentials or agent config is missing */
    missingConfig: string;
  };
  header: {
    /** Reset button aria-label — use {brand} for brand name */
    resetAria: string;
    /** Reset button tooltip title */
    resetTitle: string;
    /** Header logo alt text — use {brand} for brand name */
    logoAlt: string;
    /** Close button aria-label */
    close: string;
    /** New-conversation button aria-label */
    newChatAria: string;
    /** New-conversation button tooltip title */
    newChatTitle: string;
    /** Minimize/dock button aria-label (normal → docked) */
    minimize: string;
    /** Maximize button aria-label (normal → maximized) */
    maximize: string;
    /** Restore button aria-label (maximized → normal) */
    restore: string;
    /** Expand button aria-label (docked → normal) */
    expand: string;
  };
  empty: {
    /** Eyebrow/kicker label above the main heading */
    eyebrow: string;
    /** Main heading — use {corpus} for the corpus name */
    heading: string;
    /** Helper text below the heading */
    helper: string;
    /**
     * Suffix appended after each sample-question chip's label text.
     * Default is " →". Set to "" to omit the suffix entirely.
     */
    chipSuffix: string;
  };
  sampleQuestions: {
    /** Popover dialog aria-label */
    dialogLabel: string;
    /** Toggle button visible label */
    toggleLabel: string;
  };
  composer: {
    /** Screen-reader label for the textarea */
    label: string;
    /** Textarea placeholder */
    placeholder: string;
    /** Submit button aria-label */
    sendAria: string;
    /** Submit button visible label */
    send: string;
  };
  thinking: {
    /** Phase 1, real signal: no search results back yet. Use {product} for the product title. */
    phaseSearching: string;
    /** Phase 2, real signal: search results are back, the model is composing the answer.
     *  Use {count} for the already-pluralized "N source(s)" phrase (computed in
     *  ThinkingIndicator.tsx, not a plain number — `interpolate` has no plural support). */
    phaseReading: string;
  };
  error: {
    /** Inline error body — use {agent} for the agent label */
    body: string;
    /** Retry button label */
    retry: string;
    /** Error when no primary agent is configured */
    noPrimaryAgent: string;
  };
  deepDive: {
    /** Group aria-label for the deep-dive consent card */
    label: string;
    /** Consent prompt body — use {specialist} for the specialist label, {topic} for the topic */
    body: string;
    /** Accept button label */
    accept: string;
    /** Decline button label */
    decline: string;
    /** Fallback specialist name when agent label is unknown */
    fallbackSpecialist: string;
    /** Fallback topic phrase when no specific topic is available */
    fallbackTopic: string;
  };
  discovery: {
    /** Eyebrow on the diagnostic follow-up card */
    eyebrow: string;
  };
  message: {
    /** Empty-result notice when an agent returns no text */
    empty: string;
    /** Empty-result retry button label */
    tryAgain: string;
  };
  user: {
    /** Alt text for a provided user avatar image */
    avatarAlt: string;
    /** Aria-label for the anonymous user avatar fallback icon */
    anonymousAlt: string;
  };
  sources: {
    /** Sources section aria-label */
    sectionLabel: string;
    /** Sources section heading */
    heading: string;
    /** Collapse release-notes toggle label */
    showLess: string;
    /** Expand singular release note toggle — use {count} */
    moreOne: string;
    /** Expand plural release notes toggle — use {count} */
    moreMany: string;
    /** Fallback source-group label when no facet matches */
    fallbackGroup: string;
    /** Fallback pill title when a hit has no title */
    fallbackTitle: string;
    /**
     * Source-group toggle aria-label template.
     * Use {label}, {count}, {action} (resolved to collapse/expand).
     */
    groupAria: string;
    /** Value of {action} when group is open */
    collapse: string;
    /** Value of {action} when group is closed */
    expand: string;
  };
  judge: {
    // ── Drawer ─────────────────────────────────────────────────────────────
    /** Drawer dialog aria-label */
    drawerAriaLabel: string;
    /** Backdrop button aria-label */
    backdropAriaLabel: string;
    /** Drawer panel heading */
    drawerHeading: string;
    /** Drawer close button aria-label */
    drawerCloseAriaLabel: string;
    /** Error state heading inside the drawer */
    errorHeading: string;
    /** Error body shown when judging is turned off (mode="off") */
    disabledMessage: string;
    /** Error body shown when mode="algolia" but no backend judge agent is set */
    noBackendMessage: string;
    /** Composite score subtitle when material source support needs review */
    overallCapped: string;
    /** Composite score subtitle under normal conditions */
    overallMean: string;
    /**
     * Source-review explanation under the score.
     * Use {preGate} and {composite}.
     */
    preGateFloor: string;
    /**
     * Explanation paragraph when material source support needs review.
     * Use {preGate} and {composite}.
     */
    explanationGateTripped: string;
    /** Explanation paragraph under normal conditions */
    explanationNormal: string;
    /** Dimensions section heading */
    dimensionsHeading: string;
    /** Panel section heading — use {count} */
    panelHeading: string;
    /** Flagged claims section heading — use {count} */
    flaggedHeading: string;
    /** Notice shown when review is needed but no specific claim was flagged */
    noFlaggedNotice: string;
    /** Deterministic grounding section heading */
    groundingHeading: string;
    /** Source review completed — use {checked} for how many terms were checked */
    groundingPassed: string;
    /** Source review needed — use {count} for how many terms were not located */
    groundingFailed: string;
    /** Shown in place of the score while the LLM panel is still running */
    panelPendingMessage: string;
    /** Synthesis rationale section heading */
    synthesisHeading: string;
    /** Footer disclaimer text */
    footerDisclaimer: string;
    /** Badge shown when material source support needs review */
    gateBadgeUnsupported: string;
    /** BORDERLINE gate badge */
    gateBadgeBorderline: string;
    /** Badge shown when source review found no missing terms */
    gateBadgeGrounded: string;
    /** Certainty suffix in flagged-claims list */
    certaintySuffix: string;
    /**
     * Dimension bar aria-label template.
     * Use {label} and {score}.
     */
    dimScoreAria: string;
    /** Score denominator used in dimension bars and per-judge scores */
    judgeScoreDenom: string;
    /** Dimension label overrides keyed by rubric key */
    dimLabels: Record<string, string>;
    /** Judge role label overrides keyed by role ('skeptic' | 'referee' | 'advocate') */
    judgeLabels: Record<string, string>;
    /** Judge lens description overrides keyed by role */
    judgeLenses: Record<string, string>;

    // ── Badge ───────────────────────────────────────────────────────────────
    /** Scoring state aria-label */
    badgeScoringAriaLabel: string;
    /** Badge label text (shown in all states) */
    badgeLabel: string;
    /** Scoring state status text */
    badgeScoringStatus: string;
    /** Score denominator on the scored badge */
    badgeScoreDenom: string;
    /**
     * Scored badge tooltip under normal conditions.
     * Use {score}.
     */
    badgeScoredTitleNormal: string;
    /**
     * Scored badge tooltip when grounding needs review.
     * Use {score} and {flagged}.
     */
    badgeScoredTitleGate: string;
    /**
     * Scored badge button aria-label.
     * Use {score}.
     */
    badgeScoredAriaLabel: string;
    /**
     * Flagged-claims badge text.
     * Use {count}.
     */
    badgeFlaggedCount: string;
    /**
     * Unavailable badge aria-label.
     * Use {reason}.
     */
    badgeUnavailableAriaLabel: string;
    /** Fallback tail when error kind is unknown */
    badgeUnavailableFallbackTail: string;
    /** Fallback hint tooltip when error kind is unknown */
    badgeUnavailableFallbackHint: string;
    /** Per-error-kind tail and hint text */
    badgeErrors: JudgeBadgeErrors;
  };
  toolUI: {
    /** Default submit button label for tool-driven forms */
    submitLabel: string;
    /** Default cancel button label for tool-driven forms */
    cancelLabel: string;
  };
}

// ---------------------------------------------------------------------------
// English defaults (mirrors every hardcoded string in the codebase)
// ---------------------------------------------------------------------------

export const defaultStrings: WidgetStrings = {
  widget: {
    openChat: 'Open AI chat',
    analyzing: 'Preparing a suggestion for you…',
    proactivePersonaLabel: '{persona} assistant',
    proactiveGreetingLabel: 'Suggested by the assistant',
    autoEngageOn: 'Auto-suggestions on — click to stop the chat opening on its own',
    autoEngageOff: 'Auto-suggestions off — click to let the chat open on its own',
    modalLabel: 'AI chat',
    missingConfig:
      'Missing Algolia configuration. Set app-id and search-api-key on <algolia-chat>, and add at least one <algolia-agent role="primary"> child.',
  },
  header: {
    resetAria: '{brand} \u2014 reset conversation',
    resetTitle: 'Start over \u2014 clear this conversation',
    logoAlt: '{brand} logo',
    close: 'Close chat',
    newChatAria: 'Start a new conversation',
    newChatTitle: 'New conversation',
    minimize: 'Minimize to corner',
    maximize: 'Maximize',
    restore: 'Restore window',
    expand: 'Expand to full view',
  },
  empty: {
    eyebrow: 'Grounded search',
    heading: 'Ask about {corpus}',
    helper: 'Try one of these, or ask your own question below.',
    chipSuffix: ' →',
  },
  sampleQuestions: {
    dialogLabel: 'Sample questions',
    toggleLabel: 'Sample questions',
  },
  composer: {
    label: 'Ask a question',
    placeholder: 'Ask a question...',
    sendAria: 'Send message',
    send: 'Send',
  },
  thinking: {
    phaseSearching: 'Searching {product} docs',
    phaseReading: 'Reading {count}',
  },
  error: {
    body: 'Couldn\u2019t reach the {agent} agent. This is a service error, not an answer.',
    retry: 'Retry',
    noPrimaryAgent: 'No primary agent configured. Add an <algolia-agent role="primary"> child.',
  },
  deepDive: {
    label: 'Deep-dive offer',
    body: 'Our {specialist} can help you go deeper on {topic} — want me to bring them in?',
    accept: 'Yes, go deeper',
    decline: 'No thanks',
    fallbackSpecialist: 'specialist',
    fallbackTopic: 'that',
  },
  discovery: {
    eyebrow: 'To narrow this down',
  },
  message: {
    empty: 'No response came back this time.',
    tryAgain: 'Try again',
  },
  user: {
    avatarAlt: 'Your profile photo',
    anonymousAlt: 'Anonymous user',
  },
  sources: {
    sectionLabel: 'Grounded sources',
    heading: 'Sources',
    showLess: 'show less',
    moreOne: '+{count} release note',
    moreMany: '+{count} release notes',
    fallbackGroup: 'Other',
    fallbackTitle: 'Source',
    groupAria: '{label}: {count} sources \u2014 {action} this group',
    collapse: 'collapse',
    expand: 'expand',
  },
  judge: {
    drawerAriaLabel: 'Grounding review breakdown',
    backdropAriaLabel: 'Close judge breakdown',
    drawerHeading: 'Grounding review',
    drawerCloseAriaLabel: 'Close',
    errorHeading: 'Judge unavailable',
    disabledMessage: 'Judge is disabled.',
    noBackendMessage:
      'No judge backend agent configured (set VITE_JUDGE_AGENT_ID or activeInstance.judgeBackend).',
    overallCapped: 'Overall \u00b7 material source support needs review',
    overallMean: 'Overall \u00b7 mean of 3 judges',
    preGateFloor:
      'Panel mean was {preGate}; displayed confidence is {composite} while material source support needs review.',
    explanationGateTripped:
      'The dimension bars and per-judge scores below are the panel\u2019s actual marks (mean {preGate}). The displayed confidence is {composite} because the deterministic source check marked material source support for review. The answer remains visible so the finding can be assessed in context.',
    explanationNormal:
      '3 blind judges (Skeptic \u00b7 Referee \u00b7 Advocate) score each dimension 1\u201310. The composite is their mean; deterministic source-review findings remain advisory and visible alongside the answer.',
    dimensionsHeading: 'Dimensions \u00b7 mean of 3',
    panelHeading: 'The panel ({count} judges)',
    flaggedHeading: 'Flagged claims ({count})',
    noFlaggedNotice:
      'Grounding needs review, but no specific claim was identified. The Skeptic could not map part of the answer to the provided sources, which can also indicate thin or partial source material.',
    groundingHeading: 'Grounding review',
    groundingPassed:
      'All {checked} verbatim-checkable term(s) in this answer were located in the cited sources during review.',
    groundingFailed: '{count} term(s) need review against the cited sources:',
    panelPendingMessage: 'Scoring the answer with the judge panel\u2026',
    synthesisHeading: 'Synthesis rationale',
    footerDisclaimer:
      'Live judging is indicative (1 round, fast model). Run the batch harness for the authoritative score.',
    gateBadgeUnsupported: 'NEEDS REVIEW',
    gateBadgeBorderline: 'REVIEW',
    gateBadgeGrounded: 'REVIEWED',
    certaintySuffix: 'certainty',
    dimScoreAria: '{label}: {score} out of 10',
    judgeScoreDenom: '/10',
    dimLabels: {
      grounding: 'Grounding',
      confidence: 'Confidence',
      breadthDepth: 'Breadth & depth',
      coverage: 'Coverage',
      depth: 'Depth',
      relevance: 'Relevance',
    },
    judgeLabels: {
      skeptic: 'Skeptic',
      referee: 'Referee',
      advocate: 'Advocate',
    },
    judgeLenses: {
      skeptic:
        'Adversarial \u2014 assumes claims wrong until sourced. This judge flags material source-support issues for review.',
      referee: 'Neutral \u2014 applies the rubric literally.',
      advocate: 'Generous \u2014 rewards genuine depth, never excuses fabrication.',
    },
    badgeScoringAriaLabel: 'Confidence score in progress',
    badgeLabel: 'Confidence',
    badgeScoringStatus: '\u00b7 scoring\u2026',
    badgeScoreDenom: '/10',
    badgeScoredTitleNormal: 'Confidence {score}/10 \u2014 click for the 3-judge breakdown.',
    badgeScoredTitleGate:
      'Confidence {score}/10 \u2014 grounding needs review ({flagged} flagged). Click for the full breakdown.',
    badgeScoredAriaLabel: 'Confidence {score} out of 10. Open the judge breakdown.',
    badgeFlaggedCount: '\u26a0 {count} to review',
    badgeUnavailableAriaLabel: 'Confidence score unavailable ({reason})',
    badgeUnavailableFallbackTail: '\u00b7 unavailable',
    badgeUnavailableFallbackHint: 'Judge service unavailable',
    badgeErrors: {
      auth: {
        tail: '\u00b7 auth required',
        hint: 'The judge service rejected the request (401/403). Set VITE_JUDGE_API_KEY for the hosted judge, or run a local judge.',
      },
      'rate-limit': {
        tail: '\u00b7 rate limited',
        hint: 'The judge service is rate-limiting this client (429). Wait a moment and try again.',
      },
      offline: {
        tail: '\u00b7 offline',
        hint: 'Couldn\u2019t reach the judge service (network/CORS/DNS). Check VITE_JUDGE_URL and that the judge is running.',
      },
      server: {
        tail: '\u00b7 service error',
        hint: 'The judge service returned an error (5xx). It may be down or misconfigured.',
      },
      'bad-response': {
        tail: '\u00b7 unavailable',
        hint: 'The judge service replied, but the response could not be read.',
      },
    },
  },
  toolUI: {
    submitLabel: 'Submit',
    cancelLabel: 'Cancel',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Substitute `{varName}` tokens in a template string.
 *
 * @example
 * interpolate('Ask about {corpus}', { corpus: 'Documentation' }) // 'Ask about Documentation'
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/**
 * Deep-merge two WidgetStrings objects.
 * Only plain-object nodes are recursed; Record<string, string> leaf maps are
 * replaced in full when the override provides them.
 */
export function mergeStrings(
  base: WidgetStrings,
  override: DeepPartial<WidgetStrings>,
): WidgetStrings {
  const b = base as unknown as Record<string, unknown>;
  const o = override as unknown as Record<string, unknown>;
  return deepMergeObjects(b, o) as unknown as WidgetStrings;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMergeObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    const bv = base[key];
    if (ov === undefined) continue;
    if (isPlainObject(ov) && isPlainObject(bv)) {
      result[key] = deepMergeObjects(bv, ov);
    } else {
      result[key] = ov;
    }
  }
  return result;
}
