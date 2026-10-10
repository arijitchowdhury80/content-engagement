import { useState } from 'react';
import { activeInstance } from '../../config/active';
import { copyQuestion } from './copyQuestion';

export interface SampleQuestionsProps {
  onPick: (question: string) => void;
  disabled?: boolean;
}

export interface SampleQuestionsGridProps {
  onPick: (question: string) => void;
  disabled?: boolean;
  className?: string;
}

/** The grouped question grid itself — shared by the in-conversation popover
 *  below and the inline empty-state rendering in EmptyState.tsx.
 *
 *  Deliberately single-column at every size: this panel's rendered width
 *  (320-420px docked, ~85vw normal, 100vw maximized) is independent of the
 *  browser viewport width, so a `sm:` viewport breakpoint can't tell whether
 *  there's actually room for 2 columns — it went 2-up and unreadable even in
 *  a 420px docked panel because the outer page viewport was wide. */
export function SampleQuestionsGrid({ onPick, disabled, className }: SampleQuestionsGridProps) {
  const groups = activeInstance.sampleQuestions;
  if (groups.length === 0) return null;

  return (
    <div className={`grid gap-x-6 gap-y-5 sm:grid-cols-2 ${className ?? ''}`}>
      {groups.map((group) => (
        <div key={group.section} className="flex flex-col gap-2">
          <span className="text-algolia-2xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-accent">
            {group.section}
          </span>
          <div className="flex flex-col gap-1">
            {group.questions.map((q) => (
              <button
                key={q}
                type="button"
                disabled={disabled}
                onClick={() => {
                  copyQuestion(q);
                  onPick(q);
                }}
                className="group flex items-center gap-2 rounded-algolia-md px-2.5 py-2 text-left text-algolia-sm text-algolia-text-secondary transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-accent-tint hover:text-algolia-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className="text-algolia-text-muted transition-colors duration-algolia-fast ease-algolia-ease group-hover:text-algolia-accent"
                  aria-hidden="true"
                >
                  →
                </span>
                <span className="min-w-0">{q}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Persistent sample-question affordance directly above the composer. */
export function SampleQuestions({ onPick, disabled }: SampleQuestionsProps) {
  const [open, setOpen] = useState(false);
  const groups = activeInstance.sampleQuestions;
  if (groups.length === 0) return null;

  const toggle = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className="relative z-20 inline-flex items-center gap-1.5 rounded-algolia-full border border-algolia-border bg-algolia-surface px-3.5 py-1.5 text-algolia-xs font-algolia-medium text-algolia-text-secondary shadow-algolia-1 transition-colors duration-algolia-fast ease-algolia-ease hover:border-algolia-accent hover:text-algolia-text"
    >
      <span className="text-algolia-accent" aria-hidden="true">
        ✦
      </span>
      {activeInstance.strings.sampleQuestions.toggleLabel}
      <span className="text-algolia-text-muted" aria-hidden="true">
        {open ? '⌄' : '⌃'}
      </span>
    </button>
  );

  return (
    <div className="relative flex justify-center">
      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute bottom-full left-1/2 z-20 mb-3 max-h-[24rem] w-[min(100%,52rem)] -translate-x-1/2 overflow-y-auto rounded-algolia-xl border border-algolia-border bg-algolia-surface p-5 shadow-algolia-3"
            role="dialog"
            aria-label={activeInstance.strings.sampleQuestions.dialogLabel}
          >
            <SampleQuestionsGrid
              onPick={(q) => {
                setOpen(false);
                onPick(q);
              }}
              disabled={disabled}
            />
          </div>
        </>
      )}

      {toggle}
    </div>
  );
}
