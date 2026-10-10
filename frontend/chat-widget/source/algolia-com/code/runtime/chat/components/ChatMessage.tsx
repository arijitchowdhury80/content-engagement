import { Fragment, useEffect } from 'react';
import { MessageMarkdown } from './MessageMarkdown';
import { SourcePills } from './SourcePills';
import { ErrorCard } from './ErrorCard';
import { DiscoveryCard } from './DiscoveryCard';
import { DeepDivePrompt } from './DeepDivePrompt';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ConfidenceBadge } from '../../judge/components/ConfidenceBadge';
import { useJudge, type JudgeTarget } from '../../judge/useJudge';
import { activeInstance } from '../../config/active';
import { useAgentByKey, useAgentByKeyOrPrimary } from '../useAgentByKey';
import { TemplateOutlet } from '../../slots/TemplateOutlet';
import type { JudgeVerdict } from '../../judge/types';
import type { AnswerSegment, ChatTurn } from '../types';
import { cleanVisibleAnswerText } from '../visibleAnswer';
import { useHostElement } from '../../slots/HostSlotsContext';

interface BadgeState {
  showBadge: boolean;
  badgeVerdict: JudgeVerdict | undefined;
  scoring: boolean;
}

interface CanonicalAnswerRuntime {
  algoliaAnswerHarness?: {
    accept: (event: { eventName: string; detail: Record<string, unknown> }) => unknown;
  };
  algoliaAnswerContributors?: {
    createAnswerContentContribution: (input: Record<string, unknown>) => unknown;
    createSourcesContribution: (input: Record<string, unknown>) => unknown;
    createErrorRetryContribution: (input: Record<string, unknown>) => unknown;
  };
  algoliaAnswerFooterRenderer?: {
    registerPlacement?: (detail: Record<string, unknown>) => boolean;
    hasSlot?: (slotKey: string) => boolean;
  };
  algoliaHandoffToOrchestrator?: {
    answerIdentityForSegment?: (widgetInstanceId: string, answerSegmentId: string) => unknown;
  };
}

function canonicalRendererOwns(slotKey: string): boolean {
  const runtime = globalThis as typeof globalThis & CanonicalAnswerRuntime;
  return runtime.algoliaAnswerFooterRenderer?.hasSlot?.(slotKey) === true;
}

function useCanonicalAnswerMirror(
  segment: AnswerSegment,
  turnId: string,
  question: string,
  conversationId: string,
  restored: boolean,
): void {
  const host = useHostElement() as (Element & { __algoliaWidgetInstanceId?: string }) | null;
  const sourceSignature = JSON.stringify(segment.sources);
  const followUpSignature = JSON.stringify(segment.followUps ?? []);

  // Later turns cause React to reconcile the compatibility footer. Re-register
  // after every committed render so the bridge restores only canonical-owned
  // slots and never moves React-owned controls such as confidence.
  useEffect(() => {
    const runtime = globalThis as typeof globalThis & CanonicalAnswerRuntime;
    const widgetInstanceId = host?.__algoliaWidgetInstanceId;
    const answerSegmentId = segment.messageId;
    const identity = widgetInstanceId && answerSegmentId
      ? runtime.algoliaHandoffToOrchestrator?.answerIdentityForSegment?.(
          widgetInstanceId,
          answerSegmentId,
        )
      : null;
    if (!identity) return;
    runtime.algoliaAnswerFooterRenderer?.registerPlacement?.({
      answerIdentity: identity,
      widgetInstanceId,
      runtimeTurnId: turnId,
      messageId: answerSegmentId,
      question,
    });
  });

  useEffect(() => {
    const runtime = globalThis as typeof globalThis & CanonicalAnswerRuntime;
    const widgetInstanceId = host?.__algoliaWidgetInstanceId;
    const answerSegmentId = segment.messageId;
    const activeIdentity = widgetInstanceId && answerSegmentId
      ? runtime.algoliaHandoffToOrchestrator?.answerIdentityForSegment?.(
          widgetInstanceId,
          answerSegmentId,
        )
      : null;
    const terminal = segment.status === 'success' || segment.status === 'error';
    const restoredIdentity = !activeIdentity && restored && terminal &&
      widgetInstanceId && conversationId && answerSegmentId
      ? Object.freeze({
          widgetInstanceId,
          conversationId,
          answerSegmentId,
          networkAttemptId: `restored:${answerSegmentId}`,
        })
      : null;
    const identity = activeIdentity || restoredIdentity;
    const harness = runtime.algoliaAnswerHarness;
    const contributors = runtime.algoliaAnswerContributors;
    if (!identity || !harness?.accept || !contributors) return;

    const detail = {
      answerIdentity: identity,
      widgetInstanceId,
      runtimeTurnId: turnId,
      messageId: answerSegmentId,
      question,
    };
    if (restoredIdentity) {
      harness.accept({ eventName: 'prepared', detail });
    }
    runtime.algoliaAnswerFooterRenderer?.registerPlacement?.(detail);

    const accept = (contribution: unknown) => {
      harness.accept({ eventName: 'contribution', detail: { ...detail, contribution } });
    };
    accept(contributors.createAnswerContentContribution({
      identity,
      text: segment.text,
      followUp: segment.followUps?.[0] ?? null,
      lifecycle: segment.status === 'success' ? 'complete' : 'streaming',
    }));
    accept(contributors.createSourcesContribution({ identity, sources: segment.sources }));
    if (segment.status === 'error') {
      accept(contributors.createErrorRetryContribution({
        identity,
        failedSlot: 'details',
        message: segment.error || 'This answer attempt failed.',
      }));
      harness.accept({ eventName: 'failed', detail });
    } else if (restoredIdentity && segment.status === 'success') {
      harness.accept({ eventName: 'completed', detail });
    }
  }, [
    host,
    segment.error,
    segment.messageId,
    segment.status,
    segment.text,
    sourceSignature,
    followUpSignature,
    turnId,
    question,
    conversationId,
    restored,
  ]);
}

function computeBadgeState(
  segment: AnswerSegment,
  judgeStatus: ReturnType<typeof useJudge>['status'],
  verdict: JudgeVerdict | undefined,
): BadgeState {
  // Show whatever verdict we HAVE, and fall back to the scoring pulse only when
  // there is genuinely nothing to show yet.
  //
  // This used to key purely off `judgeStatus !== 'done'` and discard the verdict
  // while judging — so a deterministic grounding result that lands ~instantly
  // (useJudge publishes it as `panelPending: true` the moment the check runs)
  // still held the badge on "scoring…" for the full duration of the async LLM
  // panel, tens of seconds later. The status is still honest — the panel really
  // is still running — so the fix belongs here, in what the badge is given, not
  // in the status.
  const hasVerdictError = judgeStatus === 'error' || !!verdict?.error;
  const scoring = judgeStatus !== 'done' && !hasVerdictError && !verdict;
  // Only show the badge once the judge has actually fired (status leaves 'idle').
  // While the segment is still streaming / the consent gate is open, canJudge is
  // false and the judge hasn't started — showing "scoring…" before it begins is
  // dishonest and confuses users who click "No thanks" expecting a score.
  const showBadge = judgeStatus !== 'idle' && !!segment.text.trim() && segment.status !== 'error';
  return { showBadge, badgeVerdict: verdict, scoring };
}

/** Build the `data` prop for a source-pill TemplateOutlet from the sources array. */
function getFirstSourceData(sources: AnswerSegment['sources']) {
  const first = sources[0];
  return {
    url: first?.url ?? '',
    title: first?.title ?? '',
    label: first?.source ?? '',
    favicon: '',
  };
}

function SegmentFooter({
  segment,
  question,
  judgeStatus,
  verdict,
  onOpenJudge,
}: {
  segment: AnswerSegment;
  question: string;
  judgeStatus: ReturnType<typeof useJudge>['status'];
  verdict: JudgeVerdict | undefined;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
}) {
  const { showBadge, badgeVerdict, scoring } = computeBadgeState(segment, judgeStatus, verdict);

  if (!segment.sources.length && !showBadge) return null;

  const judgeHandler =
    badgeVerdict && !badgeVerdict.error ? () => onOpenJudge(badgeVerdict, question) : undefined;

  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0 flex-1">
        {segment.sources.length > 0 && !canonicalRendererOwns('sources') && (
          <TemplateOutlet
            name="source-pill"
            itemKey={`${segment.agent}-sources`}
            data={getFirstSourceData(segment.sources)}
          >
            <SourcePills sources={segment.sources} />
          </TemplateOutlet>
        )}
      </div>
      {showBadge && (
        <ConfidenceBadge verdict={badgeVerdict} scoring={scoring} onOpenJudge={judgeHandler} />
      )}
    </div>
  );
}

interface SegmentState {
  busy: boolean;
  waiting: boolean;
  emptyResult: boolean;
  canJudge: boolean;
  showFooter: boolean;
}

interface SegmentReviewState {
  judgedSegment: AnswerSegment;
  judgeStatus: ReturnType<typeof useJudge>['status'];
  verdict: JudgeVerdict | undefined;
  unsupportedTerms: string[];
}

function useSegmentReview(
  segment: AnswerSegment,
  targetId: string,
  question: string,
  canJudge: boolean,
  restored: boolean,
): SegmentReviewState {
  const judgedSegment = { ...segment, agent: targetId };
  // Restored transcript segments already completed in an earlier page lifetime.
  // Re-rendering them must not launch fresh judge panels or consume Agent Studio
  // capacity merely because the browser navigated or reloaded.
  const target: JudgeTarget | null = canJudge && !restored
    ? { id: targetId, question, segment: judgedSegment }
    : null;
  const { status: judgeStatus, verdict } = useJudge(target);
  const unsupportedTerms = verdict?.unsupportedTerms?.map(({ term }) => term) ?? [];
  return { judgedSegment, judgeStatus, verdict, unsupportedTerms };
}

/** The segment is open but has produced nothing to render yet. */
function isAwaitingOutput(segment: AnswerSegment): boolean {
  if (segment.status === 'loading') return true;
  return segment.status === 'streaming' && !segment.text.trim();
}

/**
 * @param offerPending - a deep-dive offer is on screen for this turn. The tool
 * loop is suspended on the user, so nothing is being generated: keep the
 * thinking indicator down even though the segment is still formally streaming.
 * (The segment is left unsettled on purpose — settling it with no text would
 * swap the indicator for the "no response came back" card.)
 */
/** The footer (source pills + confidence badge) waits for the answer text so
 *  it never renders ahead of what it's annotating. */
function computeShowFooter(segment: AnswerSegment, hasText: boolean, canJudge: boolean): boolean {
  return segment.status !== 'error' && hasText && (segment.sources.length > 0 || canJudge);
}

/** Follow-up chips wait for the turn to finish streaming, same reasoning as
 *  the footer above — never render ahead of what they follow. */
function computeShowFollowUps(
  isStreamingTurn: boolean | undefined,
  followUps: string[] | undefined,
  onPickFollowUp: ((q: string) => void) | undefined,
): boolean {
  return !isStreamingTurn && !!followUps?.length && !!onPickFollowUp;
}

function computeSegmentState(segment: AnswerSegment, offerPending = false): SegmentState {
  const busy = segment.status === 'loading' || segment.status === 'streaming';
  const hasText = !!segment.text.trim();
  const waiting = !offerPending && isAwaitingOutput(segment);
  const emptyResult = segment.status === 'success' && !hasText;
  const canJudge = segment.status === 'success' && hasText;
  const showFooter = computeShowFooter(segment, hasText, canJudge);
  return { busy, waiting, emptyResult, canJudge, showFooter };
}

/** This segment's own follow-up questions. They remain part of the same answer
 *  card, but sit after the source/judge footer so the visual sequence is:
 *  answer -> evidence -> next question. */
function SegmentFollowUps({
  turnId,
  followUps,
  inputBlocked,
  onPickFollowUp,
}: {
  turnId: string;
  followUps: string[];
  inputBlocked?: boolean;
  onPickFollowUp: (q: string) => void;
}) {
  return (
    <div className="acs-followup-wrap flex flex-col gap-2 pt-6">
      {followUps.map((question, i) => (
        <TemplateOutlet
          key={`${turnId}-discovery-${i}`}
          name="discovery"
          itemKey={`${turnId}-discovery-${i}`}
          data={{ question, disabled: inputBlocked }}
          actions={{ ask: onPickFollowUp }}
        >
          <DiscoveryCard question={question} onAsk={onPickFollowUp} disabled={inputBlocked} />
        </TemplateOutlet>
      ))}
    </div>
  );
}

/** One answer card. Each finished answer also carries its own Confidence chip —
 *  the composite grounding-judge score — which opens the full breakdown drawer. */
interface SegmentViewProps {
  segment: AnswerSegment;
  turnId: string;
  question: string;
  conversationId: string;
  restored: boolean;
  offerPending: boolean;
  onRetry: () => void;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
  /** This segment's own follow-up chips, rendered inline as part of the same
   * card. Only passed for the turn's last segment. */
  followUps?: string[];
  isStreamingTurn?: boolean;
  inputBlocked?: boolean;
  onPickFollowUp?: (q: string) => void;
}

function SegmentView({
  segment,
  turnId,
  question,
  conversationId,
  restored,
  offerPending,
  onRetry,
  onOpenJudge,
  followUps,
  isStreamingTurn,
  inputBlocked,
  onPickFollowUp,
}: SegmentViewProps) {
  const visibleSegment = { ...segment, text: cleanVisibleAnswerText(segment.text) };
  useCanonicalAnswerMirror(
    visibleSegment,
    turnId,
    question,
    conversationId,
    restored,
  );
  const { busy, waiting, emptyResult, canJudge, showFooter } = computeSegmentState(
    visibleSegment,
    offerPending,
  );
  const meta = useAgentByKeyOrPrimary(segment.agent);
  const targetId = `${turnId}:${segment.agent}`;
  const showFollowUps = computeShowFollowUps(isStreamingTurn, followUps, onPickFollowUp);
  const { judgedSegment, judgeStatus, verdict, unsupportedTerms } = useSegmentReview(
    visibleSegment,
    targetId,
    question,
    canJudge,
    restored,
  );
  return (
    <div
      className="flex flex-col gap-3 rounded-algolia-xl bg-algolia-surface p-6 shadow-algolia-2"
      aria-busy={busy}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-algolia-full border px-2.5 py-1 text-algolia-2xs font-algolia-bold uppercase tracking-algolia-caps shadow-algolia-1 backdrop-blur-md"
          style={{
            color: `var(${meta.accentToken}, var(--algolia-agent-specialist))`,
            borderColor: `var(${meta.accentToken}, var(--algolia-agent-specialist))`,
            backgroundColor: `color-mix(in srgb, var(${meta.accentToken}, var(--algolia-agent-specialist)) 14%, transparent)`,
          }}
        >
          {meta.label}
        </span>
      </div>

      {waiting && (
        <TemplateOutlet name="thinking" itemKey={targetId} data={{ phase: 'thinking', label: '' }}>
          <ThinkingIndicator
            status={segment.status}
            searchCount={segment.searchCount}
            sources={segment.sources}
            text={visibleSegment.text}
          />
        </TemplateOutlet>
      )}

      {visibleSegment.text && (
        <MessageMarkdown text={visibleSegment.text} unsupportedTerms={unsupportedTerms} />
      )}

      {emptyResult && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-algolia-sm text-algolia-text-muted">
          <span>{activeInstance.strings.message.empty}</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-algolia-full border border-algolia-border px-3 py-1 text-algolia-xs font-algolia-medium text-algolia-text transition-colors duration-algolia-fast ease-algolia-ease hover:border-algolia-accent hover:bg-algolia-surface-hover"
          >
            {activeInstance.strings.message.tryAgain}
          </button>
        </div>
      )}

      {segment.status === 'error' && (
        <TemplateOutlet
          name="error-card"
          itemKey={targetId}
          data={{ agentLabel: meta.label, message: '' }}
          actions={{ retry: onRetry }}
        >
          <ErrorCard agent={segment.agent} error={segment.error} onRetry={onRetry} />
        </TemplateOutlet>
      )}

      {showFooter && (
        <SegmentFooter
          segment={judgedSegment}
          question={question}
          judgeStatus={judgeStatus}
          verdict={verdict}
          onOpenJudge={onOpenJudge}
        />
      )}

      {showFollowUps && !canonicalRendererOwns('followUp') && (
        <SegmentFollowUps
          turnId={turnId}
          followUps={followUps!}
          inputBlocked={inputBlocked}
          onPickFollowUp={onPickFollowUp!}
        />
      )}
    </div>
  );
}

export interface ChatMessageProps {
  turn: ChatTurn;
  conversationId: string;
  restoredSegmentIds: ReadonlySet<string>;
  onRetry: (turnId: string) => void;
  onPickFollowUp: (question: string) => void;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
  onRunDeepDive: (turnId: string) => void;
  onDeclineDeepDive: (turnId: string) => void;
  /** True while the user cannot ask anything — a run is genuinely in flight. */
  inputBlocked: boolean;
}

/** Circular avatar shown to the right of every user prompt bubble.
 *  Shows the provided image when `userAvatar` is set, otherwise an anonymous
 *  person icon inside a muted circle. */
function UserAvatar() {
  const { userAvatar, strings } = activeInstance;
  if (userAvatar) {
    return (
      <img
        src={userAvatar}
        alt={strings.user.avatarAlt}
        className="h-8 w-8 shrink-0 rounded-algolia-full object-cover"
      />
    );
  }
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-algolia-full bg-algolia-surface-2 text-algolia-text-muted"
      aria-label={strings.user.anonymousAlt}
      role="img"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.866 3.582-7 8-7s8 3.134 8 7" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// TurnTrailing — deep-dive prompt + discovery cards, rendered immediately
// after segment 0 (not after every segment — see AnswerSegment.followUps).
// ---------------------------------------------------------------------------

interface DeepDiveSectionProps {
  turn: ChatTurn;
  onRunDeepDive: (id: string) => void;
  onDeclineDeepDive: (id: string) => void;
}

/** The deep-dive consent card — turn-level state, rendered once at segment 0. */
function DeepDiveSection({ turn, onRunDeepDive, onDeclineDeepDive }: DeepDiveSectionProps) {
  const specialistAgent = useAgentByKey(turn.deepDiveSpecialist ?? '');
  const specialistLabel =
    specialistAgent?.label ?? activeInstance.strings.deepDive.fallbackSpecialist;

  if (!turn.deepDiveOffered) return null;

  return (
    <TemplateOutlet
      name="deep-dive"
      itemKey={`${turn.id}-deepdive`}
      data={{ specialistLabel, topic: turn.deepDiveQuery }}
      actions={{
        ask: () => onRunDeepDive(turn.id),
        close: () => onDeclineDeepDive(turn.id),
      }}
    >
      <DeepDivePrompt
        specialistLabel={specialistLabel}
        topic={turn.deepDiveQuery}
        onAccept={() => onRunDeepDive(turn.id)}
        onDecline={() => onDeclineDeepDive(turn.id)}
      />
    </TemplateOutlet>
  );
}

/** Deep-dive consent card only — the follow-up chips now render INSIDE the
 *  last segment's own card (see SegmentView) so they read as part of the
 *  same turn instead of a separate floating card. */
function TurnTrailing({
  turn,
  showDeepDive,
  onRunDeepDive,
  onDeclineDeepDive,
}: {
  turn: ChatTurn;
  /** Render the deep-dive consent card — turn-level state, always the first segment. */
  showDeepDive: boolean;
  onRunDeepDive: (id: string) => void;
  onDeclineDeepDive: (id: string) => void;
}) {
  if (!showDeepDive) return null;
  return (
    <DeepDiveSection
      turn={turn}
      onRunDeepDive={onRunDeepDive}
      onDeclineDeepDive={onDeclineDeepDive}
    />
  );
}

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

/** One full turn: the user's question bubble and the assistant answer card(s). */
export function ChatMessage({
  turn,
  conversationId,
  restoredSegmentIds,
  onRetry,
  onPickFollowUp,
  onOpenJudge,
  onRunDeepDive,
  onDeclineDeepDive,
  inputBlocked,
}: ChatMessageProps) {
  const isStreamingTurn = turn.segments.some(
    (s) => s.status === 'loading' || s.status === 'streaming',
  );
  const userAvatarUrl = activeInstance.userAvatar ?? '';
  const offerPending = turn.deepDiveOffered;

  return (
    <TemplateOutlet
      name="message"
      itemKey={turn.id}
      data={{ query: turn.query, role: 'user', timestamp: turn.id }}
      actions={{ ask: onPickFollowUp }}
    >
      <div className="flex flex-col gap-3.5">
        {/* User bubble row */}
        <TemplateOutlet
          name="message-user"
          itemKey={`${turn.id}-user`}
          data={{ query: turn.query, avatarUrl: userAvatarUrl }}
        >
          <div className="flex items-end justify-end gap-2">
            <div
              className="algolia-glow-accent max-w-algolia-msg whitespace-pre-wrap break-words rounded-algolia-xl rounded-br-algolia-md bg-algolia-accent px-5 py-3 text-algolia-sm text-algolia-text-on-accent"
              part="message-user-bubble"
            >
              {turn.query}
            </div>
            <UserAvatar />
          </div>
        </TemplateOutlet>

        <div className="flex flex-col gap-3.5" aria-live="polite" aria-busy={isStreamingTurn}>
          {turn.segments.map((segment, index) => {
            const segKey = `${turn.id}-${segment.agent}`;
            const segState = computeSegmentState(segment, offerPending);
            return (
              <Fragment key={segKey}>
                <TemplateOutlet
                  name="message-assistant"
                  itemKey={segKey}
                  data={{
                    answerHtml: segment.text,
                    answerText: segment.text,
                    agentLabel: segment.agent,
                    streaming: segState.busy,
                  }}
                  actions={{
                    retry: () => onRetry(turn.id),
                    openJudge: () => {
                      /* handled inside SegmentView */
                    },
                  }}
                >
                  <SegmentView
                    segment={segment}
                    turnId={turn.id}
                    question={turn.query}
                    conversationId={conversationId}
                    restored={Boolean(
                      segment.messageId && restoredSegmentIds.has(segment.messageId)
                    )}
                    offerPending={offerPending}
                    onRetry={() => onRetry(turn.id)}
                    onOpenJudge={onOpenJudge}
                    followUps={index === turn.segments.length - 1 ? segment.followUps : undefined}
                    isStreamingTurn={isStreamingTurn}
                    inputBlocked={inputBlocked}
                    onPickFollowUp={onPickFollowUp}
                  />
                </TemplateOutlet>
                <TurnTrailing
                  turn={turn}
                  showDeepDive={index === 0}
                  onRunDeepDive={onRunDeepDive}
                  onDeclineDeepDive={onDeclineDeepDive}
                />
              </Fragment>
            );
          })}
        </div>
      </div>
    </TemplateOutlet>
  );
}
