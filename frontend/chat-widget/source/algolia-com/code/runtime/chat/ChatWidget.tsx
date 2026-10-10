/**
 * ChatWidget — the custom element's React root.
 *
 * Renders a floating action button (FAB) that opens the chat in one of three
 * window modes — docked, normal, or maximized:
 *
 *   docked     — anchored bottom-right corner panel (no backdrop, host page
 *                stays interactive). Min-size floors guarantee a usable space.
 *   normal     — centered 85vw × 85vh modal with a dimmed backdrop (default).
 *   maximized  — full-viewport modal.
 *
 * The last used mode is persisted to localStorage so the user returns to the
 * same size on the next session.
 *
 * State machine:
 *   docked ──expand──▶ normal ──maximize──▶ maximized
 *   docked ◀──minimize── normal ◀──restore── maximized
 *   any mode ──close──▶ closed
 *
 * The modal is rendered inline in the shadow tree (NOT createPortal to
 * document.body) — portal-to-body would escape the shadow root and lose all
 * injected styles (tokens, theme, Tailwind). position:fixed still works
 * because the shadow host is not a containing block.
 *
 * The WidgetApi contract exposes open/ask to host-page scripts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader, type SizeMode } from './components/AppHeader';
import { ChatPanel } from './components/ChatPanel';
import { Composer } from './components/Composer';
import { IconOrImg } from './components/IconOrImg';
import { PoweredBy } from './components/PoweredBy';
import { SampleQuestions } from './components/SampleQuestions';
import { ProactiveGreeting } from './components/ProactiveGreeting';
import { ToolUIForm } from './components/ToolUIForm';
import { JudgeDrawer } from '../judge/components/JudgeDrawer';
import { useToolUI, type ToolUISchema } from '../tools/toolUIGate';
import { useChat } from './useChat';
import {
  persistConversationUiState,
  restoreConversationSnapshot,
  restoreConversationUiState,
} from './conversationPersistence';
import { getRuntimeEnv } from '../config/runtime';
import { activeInstance, useActiveConfig } from '../config/active';
import { proactiveStore, useProactive } from '../config/proactive';
import { WidgetStoreProvider } from './WidgetStoreProvider';
import { SlotOutlet } from '../slots/SlotOutlet';
import { useHostElement } from '../slots/HostSlotsContext';
import type { JudgeVerdict } from '../judge/types';
import type { WidgetApi, WidgetStore } from '../chatRenderer';

// Re-exported for local importers; the canonical definition lives in chatRenderer.ts.
export type { WidgetApi };

export interface ChatWidgetProps {
  apiRef?: { current: WidgetApi | null };
  /** Reactive store from the IS renderer harness. Provides agents + confidence
   *  to the entire subtree via WidgetStoreProvider. */
  widgetStore?: WidgetStore;
  /** Called on every open/close transition so the host can emit a DOM event. */
  onOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Size-mode persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'algolia-chat-size-mode';

/**
 * Read the user's persisted mode preference from localStorage.
 * Falls back to `adminDefault` (the `default-open-mode` attribute value)
 * when no user preference has been saved yet, letting the admin control the
 * initial experience without overriding the user's explicit choices.
 */
function readPersistedMode(adminDefault: SizeMode): SizeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'docked' || v === 'normal' || v === 'maximized') return v;
  } catch {
    /* storage unavailable — fall through to admin default */
  }
  return adminDefault;
}

/**
 * Persist the user's explicit mode choice. Called only when the user clicks
 * a mode-change control (minimize / maximize / restore / expand), NOT on
 * programmatic opens, so the admin default governs first-time visitors.
 */
function persistMode(mode: SizeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Panel geometry
// ---------------------------------------------------------------------------

interface PanelGeometry {
  style: React.CSSProperties;
  className: string;
}

/**
 * Panel size and placement per mode, driven entirely by layout tokens. The
 * token defaults live in tokens.css (always injected first), so no fallback
 * values are repeated here.
 */
function getPanelGeometry(mode: SizeMode): PanelGeometry {
  if (mode === 'docked') {
    return {
      style: {
        position: 'fixed',
        zIndex: 'var(--algolia-z-panel)',
        bottom: 'var(--algolia-docked-offset-bottom)',
        right: 'var(--algolia-docked-offset-right)',
        width: 'min(var(--algolia-docked-w), calc(100vw - var(--algolia-docked-margin-x)))',
        height: 'min(var(--algolia-docked-h), calc(100vh - var(--algolia-docked-margin-y)))',
        minWidth: 'var(--algolia-docked-min-w)',
        minHeight: 'var(--algolia-docked-min-h)',
      },
      className: 'overflow-hidden rounded-algolia-xl shadow-algolia-glass',
    };
  }
  if (mode === 'maximized') {
    return {
      style: { width: '100vw', height: '100vh' },
      className: 'overflow-hidden',
    };
  }
  // normal
  return {
    style: { width: 'var(--algolia-panel-w)', height: 'var(--algolia-panel-h)' },
    className: 'overflow-hidden rounded-algolia-xl shadow-algolia-glass',
  };
}

// ---------------------------------------------------------------------------
// Tool UI section — rendered above the composer when a tool suspends on input
// ---------------------------------------------------------------------------

function ToolUISection({ schema }: { schema: ToolUISchema }) {
  return (
    <div className="shrink-0 border-t border-algolia-border bg-algolia-bg px-4 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-algolia-maxw">
        <SlotOutlet name="tool-ui">
          <ToolUIForm schema={schema} />
        </SlotOutlet>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat content (inner panel, mode-agnostic)
// ---------------------------------------------------------------------------

interface ChatContentProps {
  onClose: () => void;
  initialMessage?: { id: number; text: string };
  sizeMode: SizeMode;
  onToggleSize: () => void;
  onRestore: () => void;
  onConversationStateChange: (active: boolean) => void;
}

function ChatContent({
  onClose,
  initialMessage,
  sizeMode,
  onToggleSize,
  onRestore,
  onConversationStateChange,
}: ChatContentProps) {
  const hostElement = useHostElement() as (Element & { __algoliaWidgetInstanceId?: string }) | null;
  const {
    turns,
    conversationId,
    restoredSegmentIds,
    hasActiveConversation,
    inputBlocked,
    sendMessage,
    retryTurn,
    runDeepDive,
    declineDeepDive,
    reset,
  } = useChat({ widgetInstanceId: hostElement?.__algoliaWidgetInstanceId });
  const { greeting, suggestions, personaLabel } = useProactive();
  const { schema: pendingToolUI } = useToolUI();
  const [judgeView, setJudgeView] = useState<{
    verdict: JudgeVerdict;
    question: string;
  } | null>(null);

  const firedMessageIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initialMessage || firedMessageIdRef.current === initialMessage.id) return;
    firedMessageIdRef.current = initialMessage.id;
    void sendMessage(initialMessage.text);
  }, [initialMessage, sendMessage]);

  useEffect(() => {
    onConversationStateChange(hasActiveConversation);
  }, [hasActiveConversation, onConversationStateChange]);

  return (
    <div
      part="chat-content"
      className="relative flex h-full flex-col overflow-hidden font-algolia-sans text-algolia-text"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-algolia-bg backdrop-blur-xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(55rem 38rem at 12% -8%, color-mix(in srgb, var(--algolia-accent) 13%, transparent), transparent 58%), radial-gradient(48rem 36rem at 106% -6%, color-mix(in srgb, var(--algolia-accent) 9%, transparent), transparent 55%)',
        }}
      />

      <SlotOutlet name="header">
        <AppHeader
          onReset={() => {
            proactiveStore.reset();
            reset();
          }}
          onClose={onClose}
          sizeMode={sizeMode}
          onToggleSize={onToggleSize}
          onRestore={onRestore}
        />
      </SlotOutlet>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex w-full max-w-algolia-maxw flex-1 flex-col overflow-hidden">
          <ChatPanel
            turns={turns}
            conversationId={conversationId}
            restoredSegmentIds={restoredSegmentIds}
            onPickSample={(q) => void sendMessage(q)}
            onRetry={(id) => void retryTurn(id)}
            onPickFollowUp={(q) => void sendMessage(q)}
            onOpenJudge={(verdict, question) => setJudgeView({ verdict, question })}
            onRunDeepDive={(id) => void runDeepDive(id)}
            onDeclineDeepDive={declineDeepDive}
            inputBlocked={inputBlocked}
            emptyStateFooter={
              greeting ? (
                <ProactiveGreeting
                  greeting={greeting}
                  suggestions={suggestions}
                  personaLabel={personaLabel}
                  onPickSuggestion={(q) => {
                    proactiveStore.clearGreeting();
                    void sendMessage(q);
                  }}
                />
              ) : null
            }
          />
        </div>

        {pendingToolUI && <ToolUISection schema={pendingToolUI} />}

        <div className="shrink-0 border-t border-algolia-border bg-algolia-surface">
          <div className="mx-auto flex w-full max-w-algolia-maxw flex-col gap-2 px-4 py-3 sm:px-6">
            <SampleQuestions onPick={(q) => void sendMessage(q)} disabled={inputBlocked} />
            <SlotOutlet name="composer">
              <Composer disabled={inputBlocked} onSend={(q) => void sendMessage(q)} />
            </SlotOutlet>
            <SlotOutlet name="footer">
              <PoweredBy />
            </SlotOutlet>
          </div>
        </div>
      </div>

      <SlotOutlet name="judge-drawer">
        <JudgeDrawer
          open={judgeView !== null}
          verdict={judgeView?.verdict ?? null}
          question={judgeView?.question ?? ''}
          onClose={() => setJudgeView(null)}
        />
      </SlotOutlet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating action button (collapsed state)
// ---------------------------------------------------------------------------

/**
 * LauncherIcon — the glyph on the collapsed launcher button.
 *
 * Uses the host-supplied `launcher-icon` URL when present. Falls back to a
 * neutral chat-bubble glyph filled with `currentColor` so it inherits the
 * button's on-accent text colour and looks correct on any background.
 */
function LauncherIcon() {
  return (
    <IconOrImg
      src={activeInstance.launcherIcon}
      className="h-6 w-6 shrink-0"
      fallback={
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="shrink-0"
        >
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            fill="currentColor"
          />
        </svg>
      }
    />
  );
}

/**
 * ChatFab — the collapsed launcher, rendered only while the panel is closed.
 *
 * While the concierge agent is deciding whether to proactively engage
 * (`isAnalyzing`), a ring spins around the logo and a soft pulse radiates from
 * the button. The logo itself stays put, so the button remains recognisable as
 * the chat launcher rather than turning into an anonymous spinner. Clicking
 * still opens the chat immediately — the indicator never blocks interaction.
 */
const SPINNER_CLASS = 'absolute inset-1 motion-safe:animate-spin';

function ChatFab({ onClick }: { onClick: () => void }) {
  const { isAnalyzing } = useProactive();

  return (
    <button
      type="button"
      part="launcher"
      onClick={onClick}
      aria-label={
        isAnalyzing
          ? activeInstance.strings.widget.analyzing
          : activeInstance.strings.widget.openChat
      }
      aria-busy={isAnalyzing || undefined}
      className="fixed flex items-center justify-center rounded-algolia-full bg-algolia-accent text-algolia-text-on-accent shadow-algolia-3 transition-all duration-algolia-base ease-algolia-ease hover:-translate-y-1 hover:bg-algolia-accent-hover hover:shadow-algolia-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-algolia-accent focus-visible:ring-offset-2"
      style={{
        bottom: 'var(--algolia-launcher-offset-bottom)',
        right: 'var(--algolia-launcher-offset-right)',
        zIndex: 'var(--algolia-z-launcher)',
        width: 'var(--algolia-launcher-size)',
        height: 'var(--algolia-launcher-size)',
      }}
    >
      {/* Pulse ring — telegraphs that something is being prepared */}
      {isAnalyzing && (
        <span
          aria-hidden
          className="absolute inline-flex h-full w-full rounded-algolia-full bg-algolia-accent opacity-40 motion-safe:animate-ping"
        />
      )}

      {/* Spinner ring, sized by its insets so `animate-spin`'s transform is not
          competing with any centring translate. */}
      {isAnalyzing && (
        <IconOrImg
          src={activeInstance.icons.fabSpinner}
          className={SPINNER_CLASS}
          fallback={
            <svg viewBox="0 0 48 48" fill="none" aria-hidden className={SPINNER_CLASS}>
              <circle
                cx="24"
                cy="24"
                r="22"
                stroke="currentColor"
                strokeWidth="2.5"
                opacity="0.3"
              />
              <path
                d="M46 24A22 22 0 0 0 24 2"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          }
        />
      )}

      <LauncherIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat modal / docked panel wrapper
// ---------------------------------------------------------------------------

interface ChatPanelWrapperProps {
  open: boolean;
  onClose: () => void;
  initialMessage?: { id: number; text: string };
  sizeMode: SizeMode;
  onToggleSize: () => void;
  onRestore: () => void;
  onConversationStateChange: (active: boolean) => void;
}

function ChatPanelWrapper({
  open,
  onClose,
  initialMessage,
  sizeMode,
  onToggleSize,
  onRestore,
  onConversationStateChange,
}: ChatPanelWrapperProps) {
  // Keyboard dismiss
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Scroll-lock only in modal modes (not docked — host page stays usable)
  useEffect(() => {
    if (!open || sizeMode === 'docked') {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, sizeMode]);

  if (!open) return null;

  const { style, className } = getPanelGeometry(sizeMode);
  const isDocked = sizeMode === 'docked';

  // IMPORTANT: keep a single, stable wrapper <div> as the top-level element in
  // every mode. Switching between rendering the panel bare (docked) and wrapped
  // in a backdrop (normal/maximized) would change the tree shape and force React
  // to unmount + remount <ChatContent>, wiping the composer input and the
  // in-progress conversation whenever the user expands/minimizes the window.
  // Instead we toggle backdrop styling/attributes on the same wrapper element.
  //
  // The panel itself re-enables pointer events so it stays interactive even when
  // the docked wrapper is click-through (pointer-events-none keeps the host page
  // usable behind the docked panel).
  return (
    <div
      role={isDocked ? undefined : 'dialog'}
      aria-modal={isDocked ? undefined : true}
      aria-label={isDocked ? undefined : activeInstance.strings.widget.modalLabel}
      className={
        isDocked ? 'pointer-events-none' : 'fixed inset-0 flex items-center justify-center p-4'
      }
      style={
        isDocked
          ? undefined
          : {
              zIndex: 'var(--algolia-z-panel)',
              background: 'var(--algolia-backdrop)',
              backdropFilter: 'blur(var(--algolia-backdrop-blur))',
            }
      }
      onClick={
        isDocked
          ? undefined
          : (e) => {
              if (e.target === e.currentTarget) onClose();
            }
      }
    >
      <div part="panel" className={`pointer-events-auto ${className}`} style={style}>
        <ChatContent
          onClose={onClose}
          initialMessage={initialMessage}
          sizeMode={sizeMode}
          onToggleSize={onToggleSize}
          onRestore={onRestore}
          onConversationStateChange={onConversationStateChange}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatWidget root
// ---------------------------------------------------------------------------

export function ChatWidget({ apiRef, widgetStore, onOpenChange }: ChatWidgetProps) {
  // Re-render when the host reconfigures the embed (an attribute change on
  // <algolia-chat>, or a direct applyRuntimeConfig call). Components below read
  // `activeInstance` at render time, so this is all live reconfiguration needs.
  useActiveConfig();
  const env = getRuntimeEnv();
  const [restoredUiState] = useState(restoreConversationUiState);
  const [chatOpen, setChatOpen] = useState(
    () =>
      restoredUiState?.state === 'active' && Boolean(restoreConversationSnapshot()?.turns.length),
  );
  const activeConversationRef = useRef(Boolean(restoreConversationSnapshot()?.turns.length));
  // Initialise from localStorage if the user has saved a preference; otherwise
  // use the admin-configured default-open-mode (falls back to 'normal').
  const [sizeMode, setSizeMode] = useState<SizeMode>(() =>
    readPersistedMode(activeInstance.defaultOpenMode ?? 'normal'),
  );
  const [pendingMessage, setPendingMessage] = useState<{ id: number; text: string } | undefined>();
  const pendingMessageIdRef = useRef(0);

  const setMode = useCallback((mode: SizeMode) => {
    setSizeMode(mode);
    persistMode(mode);
  }, []);

  const openChat = useCallback((prefill?: string) => {
    setPendingMessage(prefill === undefined
      ? undefined
      : { id: ++pendingMessageIdRef.current, text: prefill });
    setChatOpen(true);
    if (activeConversationRef.current) persistConversationUiState('active');
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setPendingMessage(undefined);
    if (activeConversationRef.current) persistConversationUiState('dismissed');
  }, []);

  const handleConversationStateChange = useCallback(
    (active: boolean) => {
      activeConversationRef.current = active;
      if (active) persistConversationUiState(chatOpen ? 'active' : 'dismissed');
    },
    [chatOpen],
  );

  // Apply the host's configured auto-engage default. Done on mount rather than at
  // module load because config is only resolved once attributes are parsed. Runs
  // for direct chatWidget() consumers too, not just the custom element.
  useEffect(() => {
    proactiveStore.applyAutoEngageDefault(activeInstance.autoEngage);
  }, []);

  // Notify the host on real open/close transitions only. Driven off state rather
  // than the callers so it covers every path (launcher, Escape, backdrop, API)
  // and never double-fires when open() is called on an already-open panel.
  const wasOpenRef = useRef(chatOpen);
  useEffect(() => {
    if (wasOpenRef.current === chatOpen) return;
    wasOpenRef.current = chatOpen;
    onOpenChange?.(chatOpen);
  }, [chatOpen, onOpenChange]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      open: () => openChat(),
      ask: (text: string) => openChat(text),
      setPersona: (agentId, label) => {
        proactiveStore.setPersona(agentId, label);
      },
      engage: ({ greeting, suggestions, openMode = 'docked' }) => {
        // Only open the panel if the greeting was accepted — the visitor may have
        // switched auto-engage off, in which case opening would defeat the point.
        const accepted = proactiveStore.engage(greeting, suggestions ?? []);
        if (accepted) {
          setSizeMode(openMode);
          openChat();
        }
        return accepted;
      },
      setAnalyzing: (analyzing: boolean) => {
        proactiveStore.setAnalyzing(analyzing);
      },
      getAutoEngage: () => proactiveStore.getSnapshot().autoEngage,
      setAutoEngage: (enabled: boolean) => {
        proactiveStore.setAutoEngage(enabled);
      },
    };
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [apiRef, openChat]);

  const content = (
    <>
      {!env && (
        <div className="fixed bottom-6 right-6 z-50 max-w-xs rounded-algolia-md border border-algolia-negative bg-algolia-negative-bg p-4 font-algolia-sans text-algolia-sm text-algolia-negative">
          {activeInstance.strings.widget.missingConfig}
        </div>
      )}
      {env && (
        <>
          {/* FAB — hidden when chat is open in any mode */}
          {!chatOpen && (
            <SlotOutlet name="launcher">
              <ChatFab onClick={() => openChat()} />
            </SlotOutlet>
          )}

          <SlotOutlet name="panel">
            <ChatPanelWrapper
              open={chatOpen}
              onClose={closeChat}
              initialMessage={pendingMessage}
              sizeMode={sizeMode}
              onToggleSize={() => setMode(sizeMode === 'docked' ? 'normal' : 'docked')}
              onRestore={() => setMode('normal')}
              onConversationStateChange={handleConversationStateChange}
            />
          </SlotOutlet>
        </>
      )}
    </>
  );

  if (widgetStore) {
    return <WidgetStoreProvider store={widgetStore}>{content}</WidgetStoreProvider>;
  }

  return <>{content}</>;
}
