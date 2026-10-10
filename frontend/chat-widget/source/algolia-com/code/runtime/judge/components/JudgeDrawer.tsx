import { useEffect, useState } from 'react';
import type { JudgeDims, JudgePerJudge, JudgeRole, JudgeVerdict } from '../types';
import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';

/**
 * JudgeDrawer — the full grounding-judge breakdown for ONE answer, opened by
 * clicking that answer's ConfidenceBadge. Right-side slide-over.
 *
 * Surfaces: the composite "Confidence" score (mean of 3 blind judges, capped
 * by the grounding hard-floor), the 4 rubric dimensions, the per-judge scores
 * (Skeptic / Referee / Advocate), flagged claims, and the synthesis rationale.
 */
export interface JudgeDrawerProps {
  open: boolean;
  verdict: JudgeVerdict | null;
  question: string;
  onClose: () => void;
}

const DIM_PREFERRED = ['grounding', 'confidence', 'breadthDepth', 'coverage', 'depth', 'relevance'];

function toDimEntry(key: string, dims: JudgeDims): { key: string; label: string; score: number } {
  const dimLabels = activeInstance.strings.judge.dimLabels;
  return { key, label: dimLabels[key] ?? key, score: dims[key] };
}

function orderedDims(dims: JudgeDims): Array<{ key: string; label: string; score: number }> {
  const seen = new Set<string>();
  const preferred = DIM_PREFERRED.filter((k) => k in dims && Number.isFinite(dims[k])).map((k) => {
    seen.add(k);
    return toDimEntry(k, dims);
  });
  const extra = Object.keys(dims)
    .filter((k) => !seen.has(k) && Number.isFinite(dims[k]))
    .map((k) => toDimEntry(k, dims));
  return [...preferred, ...extra];
}

const JUDGE_ORDER: JudgeRole[] = ['skeptic', 'referee', 'advocate'];

type Tone = 'positive' | 'notice' | 'negative';
function scoreTone(score: number): Tone {
  if (score >= 7.5) return 'positive';
  if (score >= 5) return 'notice';
  return 'negative';
}
const TEXT_TONE: Record<Tone, string> = {
  positive: 'text-algolia-positive',
  notice: 'text-algolia-notice',
  negative: 'text-algolia-negative',
};
const BAR_TONE: Record<Tone, string> = {
  positive: 'bg-algolia-positive',
  notice: 'bg-algolia-notice',
  negative: 'bg-algolia-negative',
};

function DimBar({ label, score }: { label: string; score: number }) {
  const tone = scoreTone(score);
  const pct = Math.max(0, Math.min(100, (score / 10) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-algolia-xs">
        <span className="font-algolia-medium text-algolia-text-secondary">{label}</span>
        <span className={TEXT_TONE[tone]}>
          <span className="font-algolia-bold">{score.toFixed(1)}</span>
          <span className="text-algolia-text-muted">
            {activeInstance.strings.judge.judgeScoreDenom}
          </span>
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-algolia-full bg-algolia-surface-2"
        role="img"
        aria-label={interpolate(activeInstance.strings.judge.dimScoreAria, {
          label,
          score: score.toFixed(1),
        })}
      >
        <div
          className={`h-full rounded-algolia-full ${BAR_TONE[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function GateBadge({ gateTripped, borderline }: { gateTripped: boolean; borderline: boolean }) {
  const js = activeInstance.strings.judge;
  if (gateTripped) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-algolia-sm border border-algolia-negative bg-algolia-negative-bg px-2.5 py-1 text-algolia-xs font-algolia-bold text-algolia-negative">
        <span aria-hidden="true">✗</span>
        <span>{js.gateBadgeUnsupported}</span>
      </span>
    );
  }
  if (borderline) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-algolia-sm border border-algolia-notice bg-algolia-notice-bg px-2.5 py-1 text-algolia-xs font-algolia-bold text-algolia-notice">
        <span aria-hidden="true">⚠</span>
        <span>{js.gateBadgeBorderline}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-algolia-sm border border-algolia-positive bg-algolia-positive-bg px-2.5 py-1 text-algolia-xs font-algolia-bold text-algolia-positive">
      <span aria-hidden="true">✓</span>
      <span>{js.gateBadgeGrounded}</span>
    </span>
  );
}

function JudgeAccordion({ j }: { j: JudgePerJudge }) {
  const [open, setOpen] = useState(false);
  const tone = scoreTone(j.score);
  return (
    <li className="overflow-hidden rounded-algolia-sm border border-algolia-border bg-algolia-surface-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-algolia-surface-hover"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-algolia-text-muted">
            {open ? '▾' : '▸'}
          </span>
          <span className="text-algolia-sm font-algolia-bold text-algolia-text">
            {activeInstance.strings.judge.judgeLabels[j.role] ?? j.role}
          </span>
        </span>
        <span className={`text-algolia-sm font-algolia-bold ${TEXT_TONE[tone]}`}>
          {j.score.toFixed(1)}
          {activeInstance.strings.judge.judgeScoreDenom}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-algolia-border px-3 py-2">
          <p className="m-0 text-algolia-2xs text-algolia-text-muted">
            {activeInstance.strings.judge.judgeLenses[j.role] ?? ''}
          </p>
          {j.note && <p className="m-0 text-algolia-xs text-algolia-text-secondary">{j.note}</p>}
        </div>
      )}
    </li>
  );
}

function PerJudgeList({ perJudge }: { perJudge: JudgePerJudge[] }) {
  const ordered = JUDGE_ORDER.map((role) => perJudge.find((j) => j.role === role)).filter(
    (j): j is JudgePerJudge => Boolean(j),
  );
  if (ordered.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-algolia-xs font-algolia-bold uppercase tracking-wide text-algolia-text-secondary">
        {interpolate(activeInstance.strings.judge.panelHeading, { count: ordered.length })}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {ordered.map((j) => (
          <JudgeAccordion key={j.role} j={j} />
        ))}
      </ul>
    </div>
  );
}

function ScoreHeader({ verdict }: { verdict: JudgeVerdict }) {
  const composite = verdict.composite;
  const compTone = verdict.gateTripped ? 'negative' : scoreTone(composite);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-algolia-xs font-algolia-medium text-algolia-text-muted">
          {verdict.gateTripped
            ? activeInstance.strings.judge.overallCapped
            : activeInstance.strings.judge.overallMean}
        </span>
        <span className={`text-algolia-2xl font-algolia-bold ${TEXT_TONE[compTone]}`}>
          {composite.toFixed(1)}
          <span className="text-algolia-sm font-algolia-medium text-algolia-text-muted">
            {activeInstance.strings.judge.judgeScoreDenom}
          </span>
        </span>
        {verdict.gateTripped && (
          <span className="text-algolia-2xs text-algolia-text-muted">
            {interpolate(activeInstance.strings.judge.preGateFloor, {
              preGate: verdict.preGateScore.toFixed(1),
              composite: composite.toFixed(1),
            })}
          </span>
        )}
      </div>
      <GateBadge gateTripped={verdict.gateTripped} borderline={verdict.borderline} />
    </div>
  );
}

function FlaggedClaims({ claims }: { claims: JudgeVerdict['flaggedClaims'] }) {
  if (claims.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-algolia-xs font-algolia-bold uppercase tracking-wide text-algolia-text-secondary">
        {interpolate(activeInstance.strings.judge.flaggedHeading, { count: claims.length })}
      </h3>
      {claims.map((c, i) => (
        <div
          key={i}
          className="rounded-algolia-sm border border-algolia-border bg-algolia-surface-2 px-3 py-2"
        >
          <p className="m-0 text-algolia-sm text-algolia-text">&quot;{c.claim}&quot;</p>
          <p className="m-0 mt-1 text-algolia-xs text-algolia-text-secondary">
            {c.reason}{' '}
            <span className="text-algolia-text-muted">
              · {Math.round(Math.min(1, Math.max(0, c.certainty ?? c.confidence ?? 0)) * 100)}%{' '}
              {activeInstance.strings.judge.certaintySuffix}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Grounding result — available immediately, and the only part of the verdict
 * the badge asserts. Rendered above the panel so the drawer is useful the
 * moment it opens, whether or not the LLM panel has landed.
 */
function GroundingSummary({ verdict }: { verdict: JudgeVerdict }) {
  if (verdict.grounded === undefined) return null;
  const unsupported = verdict.unsupportedTerms ?? [];
  const S = activeInstance.strings.judge;
  return (
    <div
      className={`rounded-algolia-sm border px-3 py-2.5 ${
        verdict.grounded
          ? 'border-algolia-positive bg-algolia-positive-bg'
          : 'border-algolia-negative bg-algolia-negative-bg'
      }`}
    >
      <h3 className="m-0 mb-1 text-algolia-xs font-algolia-bold uppercase tracking-wide text-algolia-text-secondary">
        {S.groundingHeading}
      </h3>
      <p className="m-0 text-algolia-sm text-algolia-text">
        {verdict.grounded
          ? interpolate(S.groundingPassed, { checked: verdict.termsChecked ?? 0 })
          : interpolate(S.groundingFailed, { count: unsupported.length })}
      </p>
      {unsupported.length > 0 && (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {unsupported.map((t) => (
            <li key={t.term} className="font-algolia-mono text-algolia-xs text-algolia-negative">
              {t.term}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Placeholder shown where the composite and per-judge detail will appear. */
function PanelPending() {
  return (
    <div className="rounded-algolia-sm border border-algolia-border bg-algolia-surface-2 px-3 py-2.5">
      <p className="m-0 text-algolia-sm text-algolia-text-secondary" aria-live="polite">
        <span className="motion-safe:animate-pulse">
          {activeInstance.strings.judge.panelPendingMessage}
        </span>
      </p>
    </div>
  );
}

function VerdictBody({ verdict }: { verdict: JudgeVerdict }) {
  // The grounding half arrives synchronously; the LLM panel takes tens of
  // seconds. Rendering `composite` while it is still pending would show a
  // confident 0.0/10 that is simply not a result yet.
  if (verdict.panelPending) {
    return (
      <div className="flex flex-col gap-5 px-5 py-5">
        <GroundingSummary verdict={verdict} />
        <PanelPending />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5 py-5">
      <ScoreHeader verdict={verdict} />

      <GroundingSummary verdict={verdict} />

      <p className="m-0 rounded-algolia-sm bg-algolia-surface-2 px-3 py-2 text-algolia-2xs text-algolia-text-muted">
        {verdict.gateTripped
          ? interpolate(activeInstance.strings.judge.explanationGateTripped, {
              preGate: verdict.preGateScore.toFixed(1),
              composite: verdict.composite.toFixed(1),
            })
          : activeInstance.strings.judge.explanationNormal}
      </p>

      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-algolia-xs font-algolia-bold uppercase tracking-wide text-algolia-text-secondary">
          {activeInstance.strings.judge.dimensionsHeading}
        </h3>
        {orderedDims(verdict.dims).map((d) => (
          <DimBar key={d.key} label={d.label} score={d.score} />
        ))}
      </div>

      <PerJudgeList perJudge={verdict.perJudge} />

      <FlaggedClaims claims={verdict.flaggedClaims} />

      {verdict.gateTripped && verdict.flaggedClaims.length === 0 && (
        <div className="rounded-algolia-sm border border-algolia-notice bg-algolia-notice-bg px-3 py-2 text-algolia-xs text-algolia-notice">
          {activeInstance.strings.judge.noFlaggedNotice}
        </div>
      )}

      {verdict.rationale && (
        <div className="rounded-algolia-sm border border-algolia-border bg-algolia-surface-2 px-3 py-2.5">
          <h3 className="m-0 mb-1 text-algolia-xs font-algolia-bold uppercase tracking-wide text-algolia-text-secondary">
            {activeInstance.strings.judge.synthesisHeading}
          </h3>
          <p className="m-0 text-algolia-sm text-algolia-text-secondary">{verdict.rationale}</p>
        </div>
      )}

      <p className="m-0 text-algolia-2xs text-algolia-text-muted">
        {activeInstance.strings.judge.footerDisclaimer}
      </p>
    </div>
  );
}

export function JudgeDrawer({ open, verdict, question, onClose }: JudgeDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !verdict) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={activeInstance.strings.judge.drawerAriaLabel}
    >
      <button
        type="button"
        aria-label={activeInstance.strings.judge.backdropAriaLabel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-algolia-border bg-algolia-surface shadow-algolia-3">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-algolia-border bg-algolia-surface px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-algolia-base font-algolia-bold text-algolia-text">
              {activeInstance.strings.judge.drawerHeading}
            </h2>
            <p className="m-0 line-clamp-2 text-algolia-xs text-algolia-text-muted">
              &quot;{question}&quot;
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={activeInstance.strings.judge.drawerCloseAriaLabel}
            className="shrink-0 rounded-algolia-full border border-algolia-border px-2 py-0.5 text-algolia-sm text-algolia-text-secondary transition-colors hover:border-algolia-accent hover:bg-algolia-surface-hover"
          >
            ✕
          </button>
        </div>

        {verdict.error ? (
          <div className="m-5 rounded-algolia-sm border border-algolia-negative bg-algolia-negative-bg px-3 py-2.5 text-algolia-sm text-algolia-negative">
            <p className="m-0 font-algolia-medium">{activeInstance.strings.judge.errorHeading}</p>
            <p className="m-0 mt-1 text-algolia-xs">{verdict.error}</p>
          </div>
        ) : (
          <VerdictBody verdict={verdict} />
        )}
      </div>
    </div>
  );
}
