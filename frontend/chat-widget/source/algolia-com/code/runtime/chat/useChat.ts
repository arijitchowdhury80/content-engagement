/**
 * useChat — React state for the single-orchestrator chat.
 *
 * This module owns only the React side: the turn list, the streaming flag, and
 * the consent gate. The turn logic itself lives in `turnRunner.ts`, which takes
 * that state through a plain {@link TurnDeps} object.
 *
 * Agent config is read from the IS renderState via useWidgetState(), which
 * subscribes to the external store updated by the chat renderer on every IS
 * render pass. This means agent widgets registered after the initial mount
 * (e.g. child <algolia-agent> elements that connect later in the DOM lifecycle)
 * automatically propagate to the hook without remounting.
 *
 * Fallback: when renderState has no agents (legacy embed without IS),
 * resolveAgents falls back to activeInstance.agents for backward compat.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useWidgetState } from './widgetContext';
import {
  historyBefore,
  resolveAgents,
  runOrchestratorTurn,
  type ConsentGate,
  type ResolvedAgents,
  type TurnDeps,
} from './turnRunner';
import { activeInstance } from '../config/active';
import {
  clearConversationSnapshot,
  clearConversationUiState,
  persistConversationSnapshot,
  restoreConversationSnapshot,
} from './conversationPersistence';
import { createLedgerState } from './discoveryLedger';
import type { AnswerSegment, ChatTurn, HistoryEntry } from './types';

interface SegmentDebugUpdate {
  turnId: string;
  segmentIndex: number;
  previous: AnswerSegment;
  patch: Partial<AnswerSegment>;
  next: AnswerSegment;
  enabled?: boolean;
  debug?: (message: string, data: Record<string, unknown>) => void;
  scope?: DebugScope;
}

interface DebugRecord {
  ts: string;
  label: string;
  data: Record<string, unknown>;
}

interface DebugScope {
  __algoliaChatJudgeDebugLog?: DebugRecord[];
  __algoliaChatJudgeDebugExport?: () => string;
}

function persistDebugRecord(scope: DebugScope, label: string, data: Record<string, unknown>): void {
  const log = scope.__algoliaChatJudgeDebugLog ?? [];
  scope.__algoliaChatJudgeDebugLog = log;
  scope.__algoliaChatJudgeDebugExport ??= () => JSON.stringify(log, null, 2);
  log.push({ ts: new Date().toISOString(), label, data });
  if (log.length > 500) log.shift();
}

function chatDebugEnabled(): boolean {
  try {
    const search = typeof location === 'undefined' ? '' : location.search;
    return new URLSearchParams(search).get('algoliaChatDebug') === '1';
  } catch {
    return false;
  }
}

export function logSegmentStateUpdate(update: SegmentDebugUpdate): void {
  if (!(update.enabled ?? chatDebugEnabled())) return;
  // eslint-disable-next-line no-console -- this path is explicitly debug-gated
  const debug = update.debug ?? console.debug;
  const { turnId, segmentIndex, previous, patch, next } = update;
  const data = {
    turnId,
    index: segmentIndex,
    previousStatus: previous.status,
    patchStatus: patch.status,
    nextStatus: next.status,
    previousTextLength: previous.text.length,
    patchTextLength: patch.text?.length,
    nextTextLength: next.text.length,
    patchKeys: Object.keys(patch),
    previous,
    next,
  };
  persistDebugRecord(update.scope ?? (globalThis as DebugScope), 'segment state update', data);
  debug('[Algolia Chat] segment state update', data);
}

export interface UseChatResult {
  turns: ChatTurn[];
  conversationId: string;
  /** Message IDs restored from the initial session snapshot. These terminal
   * segments need their canonical presentation record rehydrated after reload. */
  restoredSegmentIds: ReadonlySet<string>;
  hasActiveConversation: boolean;
  /** A turn is open: streaming from the network, or suspended on a deep-dive offer. */
  isStreaming: boolean;
  /**
   * True while the user genuinely cannot ask anything, i.e. a turn is open and
   * is NOT just waiting on a deep-dive decision. A suspended consent gate keeps
   * `isStreaming` true even though nothing is running, and locking the composer
   * on that leaves the widget looking dead until someone finds the offer card —
   * so input state keys off this, never off `isStreaming`.
   */
  inputBlocked: boolean;
  sendMessage: (query: string) => Promise<void>;
  retryTurn: (turnId: string) => Promise<void>;
  /** Accept the pending deep-dive offer and run the specialist. */
  runDeepDive: (turnId: string) => Promise<void>;
  /** Decline the pending deep-dive offer: the orchestrator answers without a specialist. */
  declineDeepDive: (turnId: string) => void;
  reset: () => void;
}

/**
 * Mirror the agent and person config from the IS render state into refs, so an
 * in-flight turn reads the current config without re-creating its callbacks.
 */
function useWidgetRefs() {
  const { agents: contextAgents, person: personConfig } = useWidgetState();

  const agentsRef = useRef<ResolvedAgents>(resolveAgents(contextAgents));
  useEffect(() => {
    agentsRef.current = resolveAgents(contextAgents);
  });

  const personConfigRef = useRef(personConfig);
  useEffect(() => {
    personConfigRef.current = personConfig;
  });

  return { agentsRef, personConfigRef };
}

/** The turn list, its ref mirror, and the segment patcher that writes to both. */
function useTurnList(initialTurns: ChatTurn[]) {
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns);
  const turnsRef = useRef<ChatTurn[]>(initialTurns);
  useEffect(() => {
    turnsRef.current = turns;
  });

  const updateSegment = useCallback(
    (turnId: string, index: number, patch: Partial<AnswerSegment>) => {
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const segments = t.segments.slice();
          const previous = segments[index];
          const next = { ...previous, ...patch };
          logSegmentStateUpdate({ turnId, segmentIndex: index, previous, patch, next });
          segments[index] = next;
          return { ...t, segments };
        }),
      );
    },
    [],
  );

  return { turns, setTurns, turnsRef, updateSegment };
}

function useConversation() {
  const [restoredConversation] = useState(restoreConversationSnapshot);
  const [restoredSegmentIds] = useState<ReadonlySet<string>>(
    () => new Set(
      (restoredConversation?.turns ?? [])
        .flatMap((turn) => turn.segments)
        .map((segment) => segment.messageId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [conversationId, setConversationId] = useState(
    () => restoredConversation?.conversationId ?? crypto.randomUUID(),
  );
  const { turns, setTurns, turnsRef, updateSegment } = useTurnList(
    restoredConversation?.turns ?? [],
  );

  useEffect(() => {
    persistConversationSnapshot(conversationId, turns);
  }, [conversationId, turns]);

  const resetConversation = useCallback(() => {
    clearConversationSnapshot();
    clearConversationUiState();
    setConversationId(crypto.randomUUID());
    turnsRef.current = [];
    setTurns([]);
  }, [setTurns, turnsRef]);

  return {
    turns,
    setTurns,
    turnsRef,
    updateSegment,
    conversationId,
    restoredSegmentIds,
    resetConversation,
  };
}

/**
 * Pending deep-dive consent decisions, keyed by turn id. Each entry is the
 * resolver of the promise the ask_specialist handler is blocked on, so an
 * abandoned gate would hang the tool loop until its timeout — hence the flush
 * on unmount.
 *
 * `awaitingDecision` mirrors the map into React state: a suspended gate is the
 * one case where a turn is open but nothing is actually running, and the UI
 * needs to tell those apart.
 */
function useConsentGate(): { consent: ConsentGate; awaitingDecision: boolean } {
  const pendingRef = useRef<Map<string, (accepted: boolean) => void>>(new Map());
  const [awaitingDecision, setAwaitingDecision] = useState(false);

  const consent = useMemo<ConsentGate>(() => {
    const pending = pendingRef.current;
    const sync = () => setAwaitingDecision(pending.size > 0);

    return {
      request: (turnId) =>
        new Promise<boolean>((resolve) => {
          pending.set(turnId, resolve);
          sync();
        }),
      isPending: (turnId) => (turnId ? pending.has(turnId) : pending.size > 0),
      settle: (turnId, accepted) => {
        const resolve = pending.get(turnId);
        if (!resolve) return;
        pending.delete(turnId);
        sync();
        resolve(accepted);
      },
      flush: (turnId) => {
        for (const [id, resolve] of pending) {
          if (turnId && id !== turnId) continue;
          pending.delete(id);
          resolve(false);
        }
        sync();
      },
    };
  }, []);

  useEffect(() => () => consent.flush(), [consent]);

  return { consent, awaitingDecision };
}

function useDeepDiveActions(consent: ConsentGate) {
  const runDeepDive = useCallback(
    (turnId: string) => {
      consent.settle(turnId, true);
      return Promise.resolve();
    },
    [consent],
  );

  const declineDeepDive = useCallback((turnId: string) => consent.settle(turnId, false), [consent]);

  return { runDeepDive, declineDeepDive };
}

/**
 * The streaming flag, reference-counted.
 *
 * Turns can overlap: asking a new question while a deep-dive offer is open
 * declines that offer, and the superseded turn keeps running for one more step
 * while the new one starts. With a plain boolean, whichever finished first
 * would clear the flag out from under the other.
 */
function useRunCounter() {
  const activeRef = useRef(0);
  const [isStreaming, setIsStreaming] = useState(false);

  const beginRun = useCallback(() => {
    activeRef.current += 1;
    setIsStreaming(true);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      activeRef.current = Math.max(0, activeRef.current - 1);
      setIsStreaming(activeRef.current > 0);
    };
  }, []);

  const resetRuns = useCallback(() => {
    activeRef.current = 0;
    setIsStreaming(false);
  }, []);

  return { isStreaming, beginRun, resetRuns };
}

export interface UseChatOptions {
  widgetInstanceId?: string;
}

export function useChat({ widgetInstanceId = 'algolia-chat:default' }: UseChatOptions = {}): UseChatResult {
  const { agentsRef, personConfigRef } = useWidgetRefs();
  const {
    turns,
    setTurns,
    turnsRef,
    updateSegment,
    conversationId,
    restoredSegmentIds,
    resetConversation,
  } =
    useConversation();
  const { consent, awaitingDecision } = useConsentGate();
  const { runDeepDive, declineDeepDive } = useDeepDiveActions(consent);
  const { isStreaming, beginRun, resetRuns } = useRunCounter();
  const discoveryLedgerRef = useRef(createLedgerState());

  /** Snapshot the current config for a turn that is about to run. */
  const turnDeps = useCallback(
    (): TurnDeps => ({
      agents: agentsRef.current,
      personConfig: personConfigRef.current,
      discoveryEnabled: activeInstance.discoveryEnabled,
      discoveryLedgerRef,
      setTurns,
      beginRun,
      turnsRef,
      consent,
      updateSegment,
      visitorContextTransport: 'native_deterministic_turn_context',
    }),
    [agentsRef, personConfigRef, setTurns, beginRun, turnsRef, consent, updateSegment],
  );

  const runTurn = useCallback(
    (turnId: string, answerSegmentId: string, query: string, priorHistory: HistoryEntry[]) =>
      runOrchestratorTurn(turnDeps(), {
        turnId,
        widgetInstanceId,
        answerSegmentId,
        conversationId,
        query,
        priorHistory,
      }),
    [conversationId, turnDeps, widgetInstanceId],
  );

  const sendMessage = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      // An open deep-dive offer holds its turn suspended on the user. Asking
      // something else is an implicit "no thanks": release the gate so that
      // turn can wrap up from its own sources, and start this one right away.
      if (consent.isPending()) consent.flush();
      else if (isStreaming) return;

      const turnId = crypto.randomUUID();
      const priorHistory = historyBefore(turnsRef.current, null);
      const answerSegmentId = crypto.randomUUID();
      const newTurn: ChatTurn = {
        id: turnId,
        userMessageId: crypto.randomUUID(),
        query: trimmed,
        handoff: false,
        deepDiveOffered: false,
        segments: [
          {
            messageId: answerSegmentId,
            agent: 'primary',
            status: 'loading',
            text: '',
            sources: [],
            searchCount: 0,
          },
        ],
      };
      setTurns((prev) => [...prev, newTurn]);

      await runTurn(turnId, answerSegmentId, trimmed, priorHistory);
    },
    [consent, isStreaming, runTurn, setTurns, turnsRef],
  );

  const retryTurn = useCallback(
    async (turnId: string) => {
      // Retrying a turn that is only waiting on its own deep-dive offer is
      // allowed; the flush below releases the gate before the rerun.
      if (isStreaming && !consent.isPending(turnId)) return;
      const turn = turnsRef.current.find((t) => t.id === turnId);
      if (!turn) return;

      consent.flush(turnId);
      const priorHistory = historyBefore(turnsRef.current, turnId);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                handoff: false,
                deepDiveOffered: false,
                deepDiveDeclined: false,
                segments: [
                  {
                    ...t.segments[0],
                    agent: 'primary',
                    status: 'loading',
                    text: '',
                    sources: [],
                    searchCount: 0,
                  },
                ],
              }
            : t,
        ),
      );

      const answerSegmentId = turn.segments[0]?.messageId || crypto.randomUUID();
      await runTurn(turnId, answerSegmentId, turn.query, priorHistory);
    },
    [consent, isStreaming, runTurn, setTurns, turnsRef],
  );

  const reset = useCallback(() => {
    consent.flush();
    resetConversation();
    discoveryLedgerRef.current = createLedgerState();
    resetRuns();
  }, [consent, resetConversation, resetRuns]);

  return {
    turns,
    conversationId,
    restoredSegmentIds,
    hasActiveConversation: turns.length > 0,
    isStreaming,
    inputBlocked: isStreaming && !awaitingDecision,
    sendMessage,
    retryTurn,
    runDeepDive,
    declineDeepDive,
    reset,
  };
}
