/**
 * ConfidenceBadge — thin React wrapper around <algolia-confidence-badge>.
 *
 * All rendering logic lives in the custom element (defined in algolia-chat,
 * registered as a side-effect when `<algolia-chat>` loads). This component
 * only bridges React props → element properties / DOM events.
 *
 * The badge element is NOT imported here — it lives in algolia-chat (the
 * custom-element layer) and must be registered by the host application before
 * this component renders. In normal usage this happens automatically when
 * algolia-chat's bundle loads.
 */
import { useEffect, useRef } from 'react';
import type { JudgeVerdict } from '../types';
import { activeInstance } from '../../config/active';

/** Minimal interface for the <algolia-confidence-badge> custom element properties
 *  that this component writes. The full class is defined in algolia-chat. */
interface ConfidenceBadgeEl extends HTMLElement {
  verdict: JudgeVerdict | null;
  scoring: boolean;
  labels: Record<string, unknown>;
}

export interface ConfidenceBadgeProps {
  verdict?: JudgeVerdict;
  scoring?: boolean;
  onOpenJudge?: () => void;
}

export function ConfidenceBadge({ verdict, scoring = false, onOpenJudge }: ConfidenceBadgeProps) {
  const ref = useRef<ConfidenceBadgeEl | null>(null);

  // Forward the widget's active strings.judge subset as BadgeLabels so the
  // in-widget badge stays in sync with any i18n overrides applied at embed time.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const j = activeInstance.strings.judge;
    el.labels = {
      scoringAriaLabel: j.badgeScoringAriaLabel,
      label: j.badgeLabel,
      scoringStatus: j.badgeScoringStatus,
      scoreDenom: j.badgeScoreDenom,
      scoredTitleNormal: j.badgeScoredTitleNormal,
      scoredTitleGate: j.badgeScoredTitleGate,
      scoredAriaLabel: j.badgeScoredAriaLabel,
      flaggedCount: j.badgeFlaggedCount,
      unavailableAriaLabel: j.badgeUnavailableAriaLabel,
      unavailableFallbackTail: j.badgeUnavailableFallbackTail,
      unavailableFallbackHint: j.badgeUnavailableFallbackHint,
      errors: j.badgeErrors,
    };
  }, []);

  // Sync verdict and scoring into the element as properties whenever they change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.verdict = verdict ?? null;
    el.scoring = scoring;
  }, [verdict, scoring]);

  // Wire the open-judge DOM event to the onOpenJudge React callback.
  useEffect(() => {
    const el = ref.current;
    if (!el || !onOpenJudge) return;
    const handler = () => onOpenJudge();
    el.addEventListener('open-judge', handler);
    return () => el.removeEventListener('open-judge', handler);
  }, [onOpenJudge]);

  return <algolia-confidence-badge ref={ref} />;
}
