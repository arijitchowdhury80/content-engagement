import type { ChatTurn } from './types';

export const CONVERSATION_SNAPSHOT_VERSION = 1 as const;
export const CONVERSATION_STORAGE_KEY = 'algolia-chat:conversation';
export const CONVERSATION_UI_STORAGE_KEY = 'algolia-chat:conversation-ui';

export type ConversationUiStatus = 'active' | 'dismissed';

export interface ConversationUiState {
  version: typeof CONVERSATION_SNAPSHOT_VERSION;
  state: ConversationUiStatus;
}

export interface ConversationSnapshot {
  version: typeof CONVERSATION_SNAPSHOT_VERSION;
  conversationId: string;
  turns: ChatTurn[];
}

const INTERRUPTED_ERROR = 'Response interrupted. Please retry.';

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSegment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.agent === 'string' &&
    ['loading', 'streaming', 'success', 'error'].includes(String(value.status)) &&
    typeof value.text === 'string' &&
    Array.isArray(value.sources) &&
    typeof value.searchCount === 'number'
  );
}

function isTurn(value: unknown): value is ChatTurn {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.query === 'string' &&
    typeof value.handoff === 'boolean' &&
    typeof value.deepDiveOffered === 'boolean' &&
    Array.isArray(value.segments) &&
    value.segments.length > 0 &&
    value.segments.every(isSegment)
  );
}

function isSnapshot(value: unknown): value is ConversationSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.version === CONVERSATION_SNAPSHOT_VERSION &&
    typeof value.conversationId === 'string' &&
    value.conversationId.length > 0 &&
    Array.isArray(value.turns) &&
    value.turns.every(isTurn)
  );
}

function normalizeInterruptedTurn(turn: ChatTurn): ChatTurn {
  const segments = turn.segments.map((segment) => {
    if (segment.status === 'success' || segment.status === 'error') return segment;
    return { ...segment, status: 'error' as const, error: segment.error ?? INTERRUPTED_ERROR };
  });
  return { ...turn, segments };
}

export function persistConversationSnapshot(
  conversationId: string,
  turns: ChatTurn[],
  storage: Storage | null = browserSessionStorage(),
): void {
  if (!storage || !conversationId) return;

  if (turns.length === 0) return;

  const snapshot: ConversationSnapshot = {
    version: CONVERSATION_SNAPSHOT_VERSION,
    conversationId,
    turns,
  };

  try {
    storage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage may be unavailable, full, or blocked by the browser's privacy policy.
  }
}

export function restoreConversationSnapshot(
  storage: Storage | null = browserSessionStorage(),
): ConversationSnapshot | null {
  if (!storage) return null;

  try {
    const serialized = storage.getItem(CONVERSATION_STORAGE_KEY);
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!isSnapshot(parsed)) return null;
    return { ...parsed, turns: parsed.turns.map(normalizeInterruptedTurn) };
  } catch {
    return null;
  }
}

export function clearConversationSnapshot(storage: Storage | null = browserSessionStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    // Reset remains an in-memory operation when storage is unavailable.
  }
}

export function persistConversationUiState(
  state: ConversationUiStatus,
  storage: Storage | null = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      CONVERSATION_UI_STORAGE_KEY,
      JSON.stringify({ version: CONVERSATION_SNAPSHOT_VERSION, state }),
    );
  } catch {
    // UI continuity degrades to the normal closed launcher when storage is unavailable.
  }
}

export function restoreConversationUiState(
  storage: Storage | null = browserSessionStorage(),
): ConversationUiState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CONVERSATION_UI_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== CONVERSATION_SNAPSHOT_VERSION) return null;
    if (parsed.state !== 'active' && parsed.state !== 'dismissed') return null;
    return parsed as unknown as ConversationUiState;
  } catch {
    return null;
  }
}

export function clearConversationUiState(storage: Storage | null = browserSessionStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CONVERSATION_UI_STORAGE_KEY);
  } catch {
    // Reset remains best-effort when storage is unavailable.
  }
}
