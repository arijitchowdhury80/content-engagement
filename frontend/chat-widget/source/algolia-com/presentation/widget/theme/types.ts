/**
 * ChatTheme — the typed token object a customer supplies to the widget to
 * define a fully custom visual identity.
 *
 * All fields are optional. Omitted fields fall back to the resolved base
 * preset (via `extends`) and ultimately to the neutral token defaults in
 * tokens.css. A customer who only needs a different accent colour can supply
 * just `{ color: { accent: '#e2361b' } }` and the widget fills the rest.
 *
 * The object is serialisable as JSON so it can be delivered via:
 *   – a registered named preset (`registerTheme('acme', theme)`)
 *   – a `<script type="application/json" slot="theme">` child element
 *   – a remote URL via `theme-src="/themes/acme.json"`
 *   – the `theme` property of `BuildWidgetStylesOptions` in JS
 */
export interface ChatTheme {
  /**
   * Name of another registered preset this theme inherits from. The parent
   * is resolved first; this theme's values are deep-merged on top. Circular
   * references are detected and raise an error.
   */
  extends?: string;

  /**
   * CSS `color-scheme` value injected on `:host`. Controls browser UA styling
   * of scrollbars, form controls, and similar host-rendered chrome.
   * @default 'light'
   */
  colorScheme?: 'light' | 'dark' | 'light dark';

  /** Color tokens. */
  color?: {
    /** Page/background canvas. Maps to `--algolia-bg`. */
    bg?: string;

    /** Primary card/surface background. Maps to `--algolia-surface`. */
    surface?: string;
    /** Inset / recessed surface. Maps to `--algolia-surface-2`. */
    surface2?: string;
    /** Hovered surface. Maps to `--algolia-surface-hover`. */
    surfaceHover?: string;
    /** Default border colour. Maps to `--algolia-border`. */
    border?: string;
    /** Stronger / focused border. Maps to `--algolia-border-strong`. */
    borderStrong?: string;
    /** Primary text. Maps to `--algolia-text`. */
    text?: string;
    /** Secondary / body text. Maps to `--algolia-text-secondary`. */
    textSecondary?: string;
    /** Muted / label text. Maps to `--algolia-text-muted`. */
    textMuted?: string;
    /** Text on accent-filled backgrounds. Maps to `--algolia-text-on-accent`. */
    textOnAccent?: string;
    /** Primary brand / CTA colour. Maps to `--algolia-accent`. */
    accent?: string;
    /** Hovered accent. Derived automatically when omitted. Maps to `--algolia-accent-hover`. */
    accentHover?: string;
    /** Active/pressed accent. Maps to `--algolia-accent-down`. */
    accentDown?: string;
    /** Tint / subtle accent fill. Derived automatically when omitted. Maps to `--algolia-accent-tint`. */
    accentTint?: string;
    /** Link colour. Defaults to `accent`. Maps to `--algolia-link`. */
    link?: string;
    /** Focus-ring colour. Defaults to `accent`. Maps to `--algolia-focus`. */
    focus?: string;
    /** Positive / success foreground. Maps to `--algolia-positive`. */
    positive?: string;
    /** Positive / success background. Maps to `--algolia-positive-bg`. */
    positiveBg?: string;
    /** Notice / warning foreground. Maps to `--algolia-notice`. */
    notice?: string;
    /** Notice / warning background. Maps to `--algolia-notice-bg`. */
    noticeBg?: string;
    /** Negative / error foreground. Maps to `--algolia-negative`. */
    negative?: string;
    /** Negative / error background. Maps to `--algolia-negative-bg`. */
    negativeBg?: string;
    /** Informative foreground. Maps to `--algolia-informative`. */
    informative?: string;
    /** Informative background. Maps to `--algolia-informative-bg`. */
    informativeBg?: string;
    /** Accent colour for the primary agent's activity indicator. Maps to `--algolia-agent-primary`. */
    agentPrimary?: string;
    /**
     * Fallback accent colour for a specialist whose `key` has no dedicated
     * colour below (or was declared without one). Maps to
     * `--algolia-agent-specialist`.
     */
    agentSpecialist?: string;
    /** Accent colour for the `product` specialist. Maps to `--algolia-agent-specialist-product`. */
    agentSpecialistProduct?: string;
    /** Accent colour for the `tech` (developer) specialist. Maps to `--algolia-agent-specialist-tech`. */
    agentSpecialistTech?: string;
    /** Accent colour for the `sales` specialist. Maps to `--algolia-agent-specialist-sales`. */
    agentSpecialistSales?: string;
    /** Accent colour for the `evidence` (customer-evidence) specialist. Maps to `--algolia-agent-specialist-evidence`. */
    agentSpecialistEvidence?: string;
    /** Modal backdrop background (rgba/color). Maps to `--algolia-backdrop`. */
    backdrop?: string;
    /** Backdrop blur radius, e.g. `4px` or `0` to disable. Maps to `--algolia-backdrop-blur`. */
    backdropBlur?: string;
  };

  /** Typography tokens. */
  typography?: {
    /** CSS font-family stack for sans-serif body text. Maps to `--algolia-font-sans`. */
    sans?: string;
    /** CSS font-family stack for monospace / code text. Maps to `--algolia-font-mono`. */
    mono?: string;
    /** Font-size scale. Each value is a CSS length (px, rem, clamp, etc.). */
    scale?: {
      '2xs'?: string; /** 10 px default — maps to `--algolia-fs-2xs` */
      xs?: string; /** 12 px default — maps to `--algolia-fs-xs` */
      sm?: string; /** 14 px default — maps to `--algolia-fs-sm` */
      base?: string; /** 16 px default — maps to `--algolia-fs-base` */
      lg?: string; /** 18 px default — maps to `--algolia-fs-lg` */
      xl?: string; /** 22 px default — maps to `--algolia-fs-xl` */
      '2xl'?: string; /** 28 px default — maps to `--algolia-fs-2xl` */
      hero?: string; /** clamp(26px, 4vw, 40px) default — maps to `--algolia-fs-hero` */
    };
    /**
     * Letter-spacing for all-caps / eyebrow labels. Maps to
     * `--algolia-tracking-caps`. Use standard CSS values, e.g. `0.1em`.
     */
    trackingCaps?: string;
    /** Font-weight scale. */
    weight?: {
      regular?: string | number; /** Maps to `--algolia-fw-regular` */
      medium?: string | number; /** Maps to `--algolia-fw-medium` */
      bold?: string | number; /** Maps to `--algolia-fw-bold` */
    };
    /** Line-height scale. */
    lineHeight?: {
      body?: string | number; /** Maps to `--algolia-lh-body` */
      heading?: string | number; /** Maps to `--algolia-lh-heading` */
    };
    /**
     * URL(s) for a custom font stylesheet loaded into `document.head` via
     * `ensureWidgetFont`. Multiple URLs are all loaded (e.g. Google Fonts
     * multi-family combos). A single string is treated as one URL.
     */
    fontHref?: string | string[];
  };

  /** Spacing / layout rhythm tokens. */
  space?: {
    '1'?: string; /** 4 px — maps to `--algolia-space-1` */
    '2'?: string; /** 8 px */
    '3'?: string; /** 12 px */
    '4'?: string; /** 16 px */
    '5'?: string; /** 20 px */
    '6'?: string; /** 24 px */
    '7'?: string; /** 32 px */
    '8'?: string; /** 40 px */
    '9'?: string; /** 48 px */
    '10'?: string; /** 64 px */
    /** Content column gutter. Maps to `--algolia-gutter`. */
    gutter?: string;
    /** Maximum readable line length. Maps to `--algolia-measure`. */
    measure?: string;
    /** Maximum content width. Maps to `--algolia-maxw`. */
    maxWidth?: string;
    /** Minimum height for interactive controls (touch target). Maps to `--algolia-control-min`. */
    controlMin?: string;
    /** Minimum height for secondary interactive controls. Maps to `--algolia-control-sm`. */
    controlSm?: string;
    /** Maximum width for source-pill name labels. Maps to `--algolia-source-name-max-w`. */
    sourceNameMaxW?: string;
    /** Maximum width for user message bubbles. Maps to `--algolia-msg-max-w`. */
    msgMaxW?: string;
    /** Maximum width of the thinking indicator shimmer bar. Maps to `--algolia-thinking-bar-max-w`. */
    thinkingBarMaxW?: string;
  };

  /** Border-radius tokens. */
  radius?: {
    sm?: string; /** Maps to `--algolia-radius-sm` */
    md?: string; /** Maps to `--algolia-radius-md` */
    lg?: string; /** Maps to `--algolia-radius-lg` */
    xl?: string; /** Maps to `--algolia-radius-xl` */
    full?: string; /** Maps to `--algolia-radius-full` */
  };

  /** Box-shadow / elevation tokens. */
  shadow?: {
    '1'?: string; /** Low elevation — maps to `--algolia-shadow-1` */
    '2'?: string; /** Mid elevation — maps to `--algolia-shadow-2` */
    '3'?: string; /** High elevation — maps to `--algolia-shadow-3` */
    focus?: string; /** Focus ring — maps to `--algolia-shadow-focus` */
    /**
     * Elevation for the floating chat panel's glassmorphism treatment —
     * layered, deeper than `3`, meant to pair with a translucent
     * `--algolia-bg`. Maps to `--algolia-shadow-glass`.
     */
    glass?: string;
  };

  /** Animation duration / easing tokens. */
  motion?: {
    fast?: string; /** Maps to `--algolia-dur-fast` */
    base?: string; /** Maps to `--algolia-dur-base` */
    slow?: string; /** Maps to `--algolia-dur-slow` */
    ease?: string; /** CSS easing function. Maps to `--algolia-ease` */
  };

  /** Layout dimension and geometry tokens. */
  layout?: {
    /** Height of the widget header bar. Maps to `--algolia-header-h`. */
    headerHeight?: string;

    /** Width of the normal-mode centered modal. Maps to `--algolia-panel-w`. */
    panelWidth?: string;
    /** Height of the normal-mode centered modal. Maps to `--algolia-panel-h`. */
    panelHeight?: string;

    /** Width of the docked corner panel. Maps to `--algolia-docked-w`. */
    dockedWidth?: string;
    /** Height of the docked corner panel. Maps to `--algolia-docked-h`. */
    dockedHeight?: string;
    /** Smallest usable docked width, applied as a floor. Maps to `--algolia-docked-min-w`. */
    dockedMinWidth?: string;
    /** Smallest usable docked height, applied as a floor. Maps to `--algolia-docked-min-h`. */
    dockedMinHeight?: string;
    /** Docked panel bottom offset (space above the launcher). Maps to `--algolia-docked-offset-bottom`. */
    dockedOffsetBottom?: string;
    /** Docked panel right offset. Maps to `--algolia-docked-offset-right`. */
    dockedOffsetRight?: string;
    /**
     * Horizontal viewport space the docked panel must leave free, subtracted
     * from `100vw` before the width applies. Maps to `--algolia-docked-margin-x`.
     */
    dockedMarginX?: string;
    /**
     * Vertical viewport space the docked panel must leave free (launcher plus
     * edge), subtracted from `100vh`. Maps to `--algolia-docked-margin-y`.
     */
    dockedMarginY?: string;

    /** Launcher FAB size (width and height). Maps to `--algolia-launcher-size`. */
    launcherSize?: string;
    /** Launcher FAB bottom inset. Maps to `--algolia-launcher-offset-bottom`. */
    launcherOffsetBottom?: string;
    /** Launcher FAB right inset. Maps to `--algolia-launcher-offset-right`. */
    launcherOffsetRight?: string;

    /** CSS z-index value for the launcher FAB. Maps to `--algolia-z-launcher`. */
    zLauncher?: string | number;
    /** CSS z-index value for the open panel. Maps to `--algolia-z-panel`. */
    zPanel?: string | number;
  };

  /**
   * Dark-mode overrides applied inside `@media (prefers-color-scheme: dark)`.
   * The object shape is the same as ChatTheme but without `extends` and `modes`
   * (nested dark modes are not supported). Only the supplied tokens are
   * overridden; the rest inherit from the light-mode values.
   */
  modes?: {
    dark?: Omit<ChatTheme, 'extends' | 'modes' | 'colorScheme'>;
  };

  /**
   * Raw CSS appended verbatim after the compiled token block, inside the
   * shadow root. Use for skin-specific utility classes (e.g. `.acme-glow`)
   * or for any token that cannot be expressed through the structured fields.
   * `:root` and `body` selectors are rewritten to `:host` automatically.
   */
  css?: string;
}
