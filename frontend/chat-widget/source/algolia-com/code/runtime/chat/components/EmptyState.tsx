import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';

export interface EmptyStateProps {
  onPick: (question: string) => void;
  /**
   * When true the welcome hero (slot or default eyebrow/heading/description) is
   * suppressed so a proactive greeting from `emptyStateFooter` becomes the first
   * thing the visitor reads. This replaces the host-side `suppressWelcome`
   * workaround: `ChatPanel` passes `hideWelcome={!!emptyStateFooter}` so the
   * context engine no longer needs to set `show-welcome="false"` itself.
   */
  hideWelcome?: boolean;
}

/** Welcome copy and trust disclaimer. Shown only before the first turn.
 *
 *  When a `[slot="welcome"]` element is present in the host page's light DOM,
 *  the eyebrow / heading / description are replaced by the slotted HTML so
 *  consumers can project a fully custom welcome (avatar image, branded copy,
 *  etc.). Sample questions remain in their persistent position directly above
 *  the composer, both before and after the first message. */
export function EmptyState({ hideWelcome }: EmptyStateProps) {
  const s = activeInstance.strings.empty;

  // When a proactive greeting is the primary content (hideWelcome=true), the
  // welcome hero is hidden so the greeting is the first thing the visitor reads.
  // This makes the host-side `suppressWelcome` / `show-welcome="false"` workaround
  // unnecessary — ChatPanel sets this flag when emptyStateFooter is present.
  const showWelcome = !hideWelcome && activeInstance.welcome.show;

  return (
    <div className="mx-auto flex w-full max-w-algolia-measure flex-col items-center gap-5 px-4 text-center">
      {showWelcome &&
        (activeInstance.welcome.present ? (
          // Native shadow-DOM slot: projects <... slot="welcome"> from the light DOM.
          // TypeScript knows <slot> as a standard HTML element so no cast needed.
          <slot name="welcome" />
        ) : (
          <>
            <span className="text-algolia-xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-accent">
              {s.eyebrow}
            </span>
            <h1 className="m-0 font-algolia-sans text-algolia-hero font-algolia-bold leading-algolia-heading text-algolia-text">
              {interpolate(s.heading, { corpus: activeInstance.corpusName })}
            </h1>
            <p className="m-0 text-algolia-xs text-algolia-text-muted">{s.helper}</p>
          </>
        ))}

      <p className="m-0 text-algolia-xs text-algolia-text-muted">{activeInstance.disclaimer}</p>
    </div>
  );
}
