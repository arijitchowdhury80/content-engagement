/**
 * ProactiveGreeting — assistant-authored opening message, shown when something
 * upstream decides to engage the visitor before they have typed anything.
 *
 * Rendered beneath the welcome hero inside the empty-state scroll area (see
 * ChatPanel / ChatWidget). Suggestion chips let the visitor start the
 * conversation in one click.
 *
 * Presentational: every value arrives via props so the component can be reused
 * outside the proactive store (tests, Storybook, alternative host integrations).
 */
import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';
import { copyQuestion } from './copyQuestion';

export interface ProactiveGreetingProps {
  /** Assistant-authored greeting text. */
  greeting: string;
  /** Clickable follow-up questions. Empty array renders no chips. */
  suggestions: string[];
  /** Invoked with the chosen suggestion when a chip is clicked. */
  onPickSuggestion: (suggestion: string) => void;
  /**
   * Active persona name, rendered as an eyebrow above the greeting.
   * Omit to hide the eyebrow entirely.
   */
  personaLabel?: string | null;
}

export function ProactiveGreeting({
  greeting,
  suggestions,
  onPickSuggestion,
  personaLabel,
}: ProactiveGreetingProps) {
  const { widget } = activeInstance.strings;

  return (
    // The greeting appears asynchronously without user action, so announce it.
    // `polite` waits for a pause rather than interrupting the current utterance.
    <section
      aria-live="polite"
      aria-label={widget.proactiveGreetingLabel}
      className="flex w-full flex-col gap-3 pt-6 pb-4"
    >
      <div className="flex items-start gap-0">
        <div className="flex w-full flex-col gap-2">
          {personaLabel && (
            <span className="text-algolia-xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-accent">
              {interpolate(widget.proactivePersonaLabel, { persona: personaLabel })}
            </span>
          )}
          <div className="w-full text-algolia-sm text-algolia-text">{greeting}</div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    copyQuestion(s);
                    onPickSuggestion(s);
                  }}
                  className="min-h-algolia-control-sm rounded-algolia-full border border-algolia-border bg-algolia-accent-tint px-3 py-1.5 text-algolia-xs text-algolia-text shadow-algolia-1 transition-all duration-algolia-base ease-algolia-ease hover:-translate-y-0.5 hover:border-algolia-accent hover:shadow-algolia-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-algolia-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
