import { copyQuestion } from './copyQuestion';

export interface DiscoveryCardProps {
  question: string;
  onAsk: (question: string) => void;
  disabled?: boolean;
}

/**
 * Discovery follow-up row. `question` is the last segment's own `followUp` —
 * a suggestion grounded in that segment's answer. Rendered INSIDE the same
 * card as the answer it follows (see SegmentView) so it reads as part of the
 * same turn, not a separate floating card. The visual treatment shares the
 * source-pill glass language while keeping the question itself unlabelled.
 */
export function DiscoveryCard({ question, onAsk, disabled }: DiscoveryCardProps) {
  return (
    <button
      type="button"
      onClick={() => {
        copyQuestion(question);
        onAsk(question);
      }}
      disabled={disabled}
      className="acs-followup-card group flex w-full items-center rounded-algolia-lg px-4 py-3 text-left transition-all duration-algolia-fast ease-algolia-ease disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="block min-w-0 text-algolia-sm font-algolia-bold leading-ac-body text-algolia-text">
        {question}
      </span>
    </button>
  );
}
