import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';
import { useAgentByKeyOrPrimary } from '../useAgentByKey';
import type { AgentKind } from '../types';

export interface ErrorCardProps {
  agent: AgentKind;
  error?: string;
  onRetry: () => void;
}

function visibleErrorMessage(label: string, error?: string): string {
  if (/\b(?:429|rate[- ]?limit)/i.test(error ?? '')) {
    return `${label} is rate-limited right now. Please wait a moment and retry.`;
  }
  return interpolate(activeInstance.strings.error.body, { agent: label });
}

/** Inline error card for a SERVICE failure (network/HTTP error reaching an
 *  agent). Visually distinct from a valid grounded refusal. Never shows a
 *  raw stack trace — a fixed, friendly message plus a Retry button. */
export function ErrorCard({ agent, error, onRetry }: ErrorCardProps) {
  const label = useAgentByKeyOrPrimary(agent).label;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-algolia-sm border border-algolia-negative bg-algolia-negative-bg px-3.5 py-2.5 text-algolia-sm text-algolia-negative"
    >
      <span>{visibleErrorMessage(label, error)}</span>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-algolia-control-sm rounded-algolia-sm border border-algolia-negative bg-transparent px-3.5 font-algolia-medium text-algolia-negative transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-negative hover:text-algolia-text-on-accent"
      >
        {activeInstance.strings.error.retry}
      </button>
    </div>
  );
}
