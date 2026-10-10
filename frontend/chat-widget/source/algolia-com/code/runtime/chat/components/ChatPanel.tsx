import { useEffect, useRef, type ReactNode } from 'react';
import { ChatMessage } from './ChatMessage';
import { EmptyState } from './EmptyState';
import type { JudgeVerdict } from '../../judge/types';
import type { ChatTurn } from '../types';

export interface ChatPanelProps {
  turns: ChatTurn[];
  conversationId: string;
  restoredSegmentIds: ReadonlySet<string>;
  onPickSample: (question: string) => void;
  onRetry: (turnId: string) => void;
  onPickFollowUp: (question: string) => void;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
  onRunDeepDive: (turnId: string) => void;
  onDeclineDeepDive: (turnId: string) => void;
  /** True while the user cannot ask anything — a run is genuinely in flight. */
  inputBlocked: boolean;
  /** Optional content rendered beneath the welcome hero in the empty state. */
  emptyStateFooter?: ReactNode;
}

/** The scrollable message list. Auto-scrolls to the newest turn as it
 *  streams; shows EmptyState before the first turn. */
export function ChatPanel({
  turns,
  conversationId,
  restoredSegmentIds,
  onPickSample,
  onRetry,
  onPickFollowUp,
  onOpenJudge,
  onRunDeepDive,
  onDeclineDeepDive,
  inputBlocked,
  emptyStateFooter,
}: ChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  if (turns.length === 0) {
    if (emptyStateFooter) {
      return (
        <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-4 py-6 sm:px-6">
          {emptyStateFooter}
        </div>
      );
    }

    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 pb-8 pt-6 sm:px-6 sm:pt-10">
        <EmptyState onPick={onPickSample} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-4 py-6 sm:px-6">
      {turns.map((turn) => (
        <ChatMessage
          key={turn.id}
          turn={turn}
          conversationId={conversationId}
          restoredSegmentIds={restoredSegmentIds}
          onRetry={onRetry}
          onPickFollowUp={onPickFollowUp}
          onOpenJudge={onOpenJudge}
          onRunDeepDive={onRunDeepDive}
          onDeclineDeepDive={onDeclineDeepDive}
          inputBlocked={inputBlocked}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
