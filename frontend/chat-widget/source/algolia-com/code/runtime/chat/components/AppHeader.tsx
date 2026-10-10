import { type ReactNode, useEffect, useRef, useState } from 'react';
import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';
import { proactiveStore, useProactive } from '../../config/proactive';
import type { ChatSizeMode } from '../../config/instance';
import { IconOrImg } from './IconOrImg';
import { PROCESSING_PROGRESS_EVENT } from '../turnRunner';

export interface HeaderProgressTarget {
  style: { setProperty(name: string, value: string): void };
  toggleAttribute(name: string, force?: boolean): void;
}

export function applyHeaderProgress(target: HeaderProgressTarget, progress: number): void {
  const bounded = Math.max(0, Math.min(100, progress));
  target.style.setProperty('--algolia-header-progress', `${bounded}%`);
  target.toggleAttribute('data-algolia-working', true);
}

function progressHost(header: HTMLElement | null): HeaderProgressTarget | null {
  const root = header?.getRootNode();
  if (root && 'host' in root && root.host instanceof HTMLElement) return root.host;
  return header;
}

/** Re-exported alias so callers inside the chat package can import SizeMode
 *  without reaching into config/instance directly. */
export type SizeMode = ChatSizeMode;

export interface AppHeaderProps {
  onReset: () => void;
  onClose?: () => void;
  /** Current window size mode — controls which toggle buttons are shown. */
  sizeMode?: SizeMode;
  /**
   * Single toggle: normal → docked, docked → normal.
   * The button icon flips to reflect the current state.
   */
  onToggleSize?: () => void;
  /** Restore from maximized → normal (only shown in maximized mode). */
  onRestore?: () => void;
}

const btnBase =
  'flex h-8 w-8 items-center justify-center rounded-algolia-full text-algolia-text-muted transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-surface-hover hover:text-algolia-text focus:outline-none focus-visible:ring-2 focus-visible:ring-algolia-accent';

/** Shared stroke attributes for the built-in header glyphs. */
const glyphStroke = {
  stroke: 'currentColor',
  strokeWidth: '1.5',
  strokeLinecap: 'round',
} as const;

/**
 * HeaderIconButton — an icon control with a styled tooltip that explains what
 * the button does. The tooltip shows on hover and on keyboard focus, and is
 * right-anchored so it never overflows the widget's right edge.
 *
 * `label` doubles as the accessible name (aria-label) and the tooltip text, so
 * every control announces its function to both pointer and assistive-tech users.
 */
interface HeaderIconButtonProps {
  onClick?: () => void;
  /** Accessible name + tooltip text describing the button's function. */
  label: string;
  children: ReactNode;
  /** Optional visible trailing content (e.g. a text label). */
  trailing?: ReactNode;
  /** Override the button classes (defaults to the round icon-button base). */
  className?: string;
  /** Marks the control as a toggle and reports its state to assistive tech. */
  pressed?: boolean;
}

function HeaderIconButton({
  onClick,
  label,
  children,
  trailing,
  className = btnBase,
  pressed,
}: HeaderIconButtonProps) {
  return (
    <div className="group relative flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className={className}
      >
        {children}
        {trailing}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-50 whitespace-nowrap rounded-algolia-md bg-algolia-text px-2 py-1 text-algolia-xs font-algolia-medium text-algolia-surface opacity-0 shadow-algolia-2 transition-opacity duration-algolia-fast ease-algolia-ease group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}

/** New-conversation icon: uses the site-supplied asset or the built-in glyph. */
function NewChatIcon() {
  return (
    <IconOrImg
      src={activeInstance.newChatIcon}
      className="h-[17px] w-[17px] shrink-0"
      fallback={
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21 11.5a8.5 8.5 0 0 1-12.28 7.6L3 21l1.9-5.72A8.5 8.5 0 1 1 21 11.5z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M12 8.5v5M9.5 11h5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      }
    />
  );
}

/**
 * AutoEngageToggle — lets the visitor decide whether the chat may open itself.
 *
 * Rendered only when the host opts in via `auto-engage-toggle`, since a widget
 * that never calls `engage()` would otherwise show a control that does nothing.
 * Reads the preference straight from the proactive store rather than taking
 * props, so it can be dropped into the header without threading state through
 * every intermediate component.
 */
function AutoEngageToggle() {
  const { autoEngage } = useProactive();
  const { strings } = activeInstance;

  return (
    <HeaderIconButton
      onClick={() => proactiveStore.setAutoEngage(!autoEngage)}
      label={autoEngage ? strings.widget.autoEngageOn : strings.widget.autoEngageOff}
      pressed={autoEngage}
      className={`${btnBase} ${autoEngage ? 'text-algolia-accent' : ''}`}
    >
      <IconOrImg
        src={activeInstance.icons.sparkle}
        size={16}
        fallback={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M8 1.6l1.35 3.35L12.7 6.3 9.35 7.65 8 11 6.65 7.65 3.3 6.3l3.35-1.35L8 1.6z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
              fill={autoEngage ? 'currentColor' : 'none'}
            />
            <path
              d="M12.2 11.2v2.6M10.9 12.5h2.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            {!autoEngage && (
              <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            )}
          </svg>
        }
      />
    </HeaderIconButton>
  );
}

interface HeaderSizeControlsProps {
  sizeMode?: SizeMode;
  onToggleSize?: () => void;
  onRestore?: () => void;
}

/** Diagonal arrows pointing outward — docked → normal. */
function ExpandIcon() {
  return (
    <IconOrImg
      src={activeInstance.icons.expand}
      size={15}
      fallback={
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M1 6V1h5" {...glyphStroke} strokeLinejoin="round" />
          <path d="M1 1l5 5" {...glyphStroke} />
          <path d="M15 10v5h-5" {...glyphStroke} strokeLinejoin="round" />
          <path d="M15 15l-5-5" {...glyphStroke} />
        </svg>
      }
    />
  );
}

/** Diagonal arrows pointing inward — normal → docked. */
function MinimizeIcon() {
  return (
    <IconOrImg
      src={activeInstance.icons.minimize}
      size={15}
      fallback={
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M6 1V6H1" {...glyphStroke} strokeLinejoin="round" />
          <path d="M6 6L1 1" {...glyphStroke} />
          <path d="M10 15v-5h5" {...glyphStroke} strokeLinejoin="round" />
          <path d="M10 10l5 5" {...glyphStroke} />
        </svg>
      }
    />
  );
}

/** Overlapping windows — maximized → normal. */
function RestoreIcon() {
  return (
    <IconOrImg
      src={activeInstance.icons.restore}
      size={15}
      fallback={
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect
            x="4"
            y="1"
            width="11"
            height="10"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M1 5v9a1 1 0 0 0 1 1h10"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      }
    />
  );
}

/** Size-mode controls: normal ↔ docked toggle and maximized restore. */
function HeaderSizeControls({ sizeMode, onToggleSize, onRestore }: HeaderSizeControlsProps) {
  const { strings } = activeInstance;
  const canToggle = (sizeMode === 'normal' || sizeMode === 'docked') && onToggleSize;
  return (
    <>
      {canToggle && (
        <HeaderIconButton
          onClick={onToggleSize}
          label={sizeMode === 'docked' ? strings.header.expand : strings.header.minimize}
        >
          {sizeMode === 'docked' ? <ExpandIcon /> : <MinimizeIcon />}
        </HeaderIconButton>
      )}
      {sizeMode === 'maximized' && onRestore && (
        <HeaderIconButton onClick={onRestore} label={strings.header.restore}>
          <RestoreIcon />
        </HeaderIconButton>
      )}
    </>
  );
}

interface HeaderControlsProps {
  onReset: () => void;
  onClose?: () => void;
  sizeMode?: SizeMode;
  onToggleSize?: () => void;
  onRestore?: () => void;
}

/** All header icon buttons to the right of the title area. */
function HeaderControls({
  onReset,
  onClose,
  sizeMode,
  onToggleSize,
  onRestore,
}: HeaderControlsProps) {
  const { strings } = activeInstance;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* New conversation — always visible */}
      <HeaderIconButton
        onClick={onReset}
        label={strings.header.newChatAria}
        className="flex h-8 items-center gap-1.5 rounded-algolia-full px-2 text-algolia-xs font-algolia-medium text-algolia-text-muted transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-surface-hover hover:text-algolia-text focus:outline-none focus-visible:ring-2 focus-visible:ring-algolia-accent"
      >
        <NewChatIcon />
      </HeaderIconButton>

      {/* Visitor control over proactive auto-opening (opt-in per instance) */}
      {activeInstance.autoEngageToggle && <AutoEngageToggle />}

      {/* Size-mode controls (toggle / restore) */}
      <HeaderSizeControls sizeMode={sizeMode} onToggleSize={onToggleSize} onRestore={onRestore} />

      {onClose && (
        <HeaderIconButton onClick={onClose} label={strings.header.close}>
          <IconOrImg
            src={activeInstance.icons.close}
            size={16}
            fallback={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M12 4L4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
        </HeaderIconButton>
      )}
    </div>
  );
}

export function AppHeader({ onReset, onClose, sizeMode, onToggleSize, onRestore }: AppHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const [processingProgress, setProcessingProgress] = useState(0);

  useEffect(() => {
    const onProgress = (event: Event) => {
      const progress = Number((event as CustomEvent<{ progress?: number }>).detail?.progress);
      const host = progressHost(headerRef.current);
      if (host && Number.isFinite(progress)) {
        const bounded = Math.max(0, Math.min(100, progress));
        setProcessingProgress(bounded);
        applyHeaderProgress(host, bounded);
      }
    };
    globalThis.addEventListener?.(PROCESSING_PROGRESS_EVENT, onProgress);
    return () => globalThis.removeEventListener?.(PROCESSING_PROGRESS_EVENT, onProgress);
  }, []);

  return (
    <header
      ref={headerRef}
      part="header"
      className="flex h-[var(--algolia-header-h)] shrink-0 items-center justify-between border-b border-algolia-border px-6 backdrop-blur-md"
      style={{ background: 'color-mix(in srgb, var(--algolia-surface) 82%, transparent)' }}
    >
      <span
        className="sr-only"
        role="progressbar"
        aria-label="Answer preparation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(processingProgress)}
        style={{ width: `${processingProgress}%` }}
      />
      {/* Title area — flex-1 min-w-0 so it takes remaining space and truncates
          rather than wrapping when mode controls crowd the right side. */}
      <button
        type="button"
        onClick={onReset}
        aria-label={interpolate(activeInstance.strings.header.resetAria, {
          brand: activeInstance.brandName,
        })}
        title={activeInstance.strings.header.resetTitle}
        className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-algolia-md px-2 py-1 transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-algolia-accent"
      >
        {activeInstance.logo.header && (
          <img
            src={activeInstance.logo.header}
            alt={interpolate(activeInstance.strings.header.logoAlt, {
              brand: activeInstance.brandName,
            })}
            className="h-8 w-8 shrink-0"
          />
        )}
        <div className="flex min-w-0 flex-col text-left leading-tight">
          <span className="truncate font-algolia-sans text-algolia-base font-algolia-medium text-algolia-text">
            {activeInstance.productTitle}
          </span>
          <span className="truncate text-algolia-xs text-algolia-text-muted">
            {activeInstance.subtitle}
          </span>
        </div>
      </button>

      {/* Controls — shrink-0 so they never compress the title. Each control
          carries a styled tooltip (via HeaderIconButton) explaining what it does. */}
      <HeaderControls
        onReset={onReset}
        onClose={onClose}
        sizeMode={sizeMode}
        onToggleSize={onToggleSize}
        onRestore={onRestore}
      />
    </header>
  );
}
