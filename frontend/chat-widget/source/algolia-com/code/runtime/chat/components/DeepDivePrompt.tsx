import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';

export interface DeepDivePromptProps {
  /** Display label of the specialist being offered. */
  specialistLabel: string;
  /** The refined question/topic the deep-dive would cover, if known. */
  topic?: string;
  onAccept: () => void;
  onDecline: () => void;
  disabled?: boolean;
}

/** Human-gated deep-dive consent card. When the front assistant judges that a
 *  question warrants a specialist, we don't auto-run it — we ASK. Nothing runs
 *  without explicit user consent. */
export function DeepDivePrompt({
  specialistLabel,
  topic,
  onAccept,
  onDecline,
  disabled,
}: DeepDivePromptProps) {
  const specialist = specialistLabel;
  return (
    <div
      className="flex flex-col gap-3 rounded-algolia-xl border border-algolia-border bg-algolia-accent-tint p-4 shadow-algolia-1 backdrop-blur-md"
      role="group"
      aria-label={activeInstance.strings.deepDive.label}
    >
      <p className="m-0 text-algolia-sm text-algolia-text">
        {interpolate(activeInstance.strings.deepDive.body, {
          specialist,
          topic: topic?.trim() || activeInstance.strings.deepDive.fallbackTopic,
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="algolia-glow-accent inline-flex items-center gap-1.5 rounded-algolia-full bg-algolia-accent px-3.5 py-1.5 text-algolia-xs font-algolia-medium text-algolia-text-on-accent transition-opacity duration-algolia-fast ease-algolia-ease hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">⚙</span>
          {activeInstance.strings.deepDive.accept}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={disabled}
          className="rounded-algolia-full px-3 py-1.5 text-algolia-xs font-algolia-medium text-algolia-text-secondary transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-surface-hover hover:text-algolia-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          {activeInstance.strings.deepDive.decline}
        </button>
      </div>
    </div>
  );
}
