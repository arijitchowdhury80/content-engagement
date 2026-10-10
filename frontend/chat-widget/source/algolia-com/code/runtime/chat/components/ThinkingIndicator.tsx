import { useEffect, useState } from 'react';
import type { ProcessingProgressSignal } from '../turnRunner';
import type { AnswerSegment, AnswerSource } from '../types';

export interface TraceStage {
  key: 'planning' | 'searching' | 'reading' | 'synthesizing' | 'composing' | 'writing';
  label: string;
  detail: string;
}

export const TRACE_STAGES: readonly TraceStage[] = [
  { key: 'planning', label: 'Planning retrieval', detail: 'Break the question into source checks' },
  { key: 'searching', label: 'Searching', detail: 'Look for useful evidence' },
  {
    key: 'reading',
    label: 'Reading retrieved sources',
    detail: 'Check the strongest retrieved evidence',
  },
  {
    key: 'synthesizing',
    label: 'Synthesizing evidence',
    detail: 'Compare retrieved snippets against the question',
  },
  {
    key: 'composing',
    label: 'Composing grounded answer',
    detail: 'Build answer structure and citations',
  },
  { key: 'writing', label: 'Writing answer', detail: 'Stream the answer when evidence is ready' },
];

export function processingTraceStage(signal: ProcessingProgressSignal): number {
  if (signal.hasText || signal.status === 'streaming' || signal.status === 'success') return 5;
  return signal.searchCount > 0 ? 2 : 1;
}

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function useElapsedTime(): string {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = globalThis.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);
  return formatElapsed(elapsedMs);
}

function sourceLabel(sources: readonly AnswerSource[], searchCount: number): string {
  const count = searchCount || sources.length;
  return `${count} ${count === 1 ? 'source' : 'sources'}`;
}

function traceDetail(
  stage: TraceStage,
  sources: readonly AnswerSource[],
  searchCount: number,
): string {
  if (stage.key === 'searching' && searchCount > 0)
    return `Found ${sourceLabel(sources, searchCount)}`;
  if (stage.key === 'reading' && (searchCount > 0 || sources.length > 0)) {
    return `Reading ${sourceLabel(sources, searchCount)}`;
  }
  return stage.detail;
}

export interface ThinkingIndicatorProps {
  status?: AnswerSegment['status'];
  searchCount: number;
  sources?: readonly AnswerSource[];
  text?: string;
}

/** Connected processing trace driven by retrieval and answer state, not rotating copy. */
export function ThinkingIndicator({
  status = 'loading',
  searchCount,
  sources = [],
  text = '',
}: ThinkingIndicatorProps) {
  const elapsed = useElapsedTime();
  const stageIndex = processingTraceStage({ status, searchCount, hasText: !!text.trim() });
  const visibleStages = TRACE_STAGES.slice(0, stageIndex + 1);
  const currentLabel = visibleStages.at(-1)?.label ?? TRACE_STAGES[0].label;

  return (
    <div
      className="acs-reasoning pb-2"
      role="status"
      aria-label={`Work ${elapsed}. ${currentLabel}`}
    >
      <div className="acs-reasoning__header text-algolia-2xs font-algolia-medium text-algolia-text-muted">
        <span className="acs-reasoning__timer">Work {elapsed}</span>
      </div>
      <div className="acs-trace mt-2 flex flex-col" aria-hidden="true">
        {visibleStages.map((stage, index) => {
          const state = index < stageIndex ? 'done' : 'active';
          return (
            <div
              key={stage.key}
              className={`acs-step acs-step--${state} grid min-h-8 grid-cols-[16px_minmax(0,1fr)] gap-2`}
              data-stage={index}
            >
              <span className="acs-step__rail flex flex-col items-center pt-2" aria-hidden="true">
                <span className="acs-step__dot h-2 w-2 rounded-algolia-full" />
                {index < visibleStages.length - 1 && (
                  <span className="acs-step__line mt-1.5 min-h-5 w-0.5 flex-1" />
                )}
              </span>
              <span className="acs-step__copy flex min-w-0 flex-col">
                <span className="acs-step__label text-algolia-xs font-algolia-bold leading-tight text-algolia-text-secondary">
                  {stage.label}
                </span>
                <span className="acs-step__detail mt-px text-algolia-xs italic leading-tight text-algolia-text-muted">
                  {traceDetail(stage, sources, searchCount)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <style>{`
        .acs-reasoning__timer { font-variant-numeric: tabular-nums; }
        .acs-step__dot, .acs-step__line { background: var(--algolia-border); }
        .acs-step--done .acs-step__dot { background: var(--algolia-positive); }
        .acs-step--active .acs-step__dot {
          background: var(--algolia-accent);
          box-shadow: 0 0 0 5px color-mix(in srgb, var(--algolia-accent) 12%, transparent);
        }
      `}</style>
    </div>
  );
}
