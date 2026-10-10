/**
 * tokenMap — the single source of truth that maps each ChatTheme field path
 * to its corresponding `--algolia-*` CSS custom property name.
 *
 * This is intentionally a flat lookup table so compile.ts can iterate over it
 * without understanding the structure of ChatTheme. Adding a new token means
 * adding one entry here, one field to the ChatTheme interface, and one
 * `--algolia-*` variable to tokens.css — the rest of the system picks it up
 * automatically.
 *
 * The key format is dot-separated field path matching ChatTheme's structure.
 * The value is the CSS custom property name (without `var()`).
 */

export const TOKEN_MAP: Record<string, string> = {
  // ── Color ──────────────────────────────────────────────────────────────────
  'color.bg': '--algolia-bg',
  'color.surface': '--algolia-surface',
  'color.surface2': '--algolia-surface-2',
  'color.surfaceHover': '--algolia-surface-hover',
  'color.border': '--algolia-border',
  'color.borderStrong': '--algolia-border-strong',
  'color.text': '--algolia-text',
  'color.textSecondary': '--algolia-text-secondary',
  'color.textMuted': '--algolia-text-muted',
  'color.textOnAccent': '--algolia-text-on-accent',
  'color.accent': '--algolia-accent',
  'color.accentHover': '--algolia-accent-hover',
  'color.accentDown': '--algolia-accent-down',
  'color.accentTint': '--algolia-accent-tint',
  'color.link': '--algolia-link',
  'color.focus': '--algolia-focus',
  'color.positive': '--algolia-positive',
  'color.positiveBg': '--algolia-positive-bg',
  'color.notice': '--algolia-notice',
  'color.noticeBg': '--algolia-notice-bg',
  'color.negative': '--algolia-negative',
  'color.negativeBg': '--algolia-negative-bg',
  'color.informative': '--algolia-informative',
  'color.informativeBg': '--algolia-informative-bg',
  'color.agentPrimary': '--algolia-agent-primary',
  'color.agentSpecialist': '--algolia-agent-specialist',
  'color.agentSpecialistProduct': '--algolia-agent-specialist-product',
  'color.agentSpecialistTech': '--algolia-agent-specialist-tech',
  'color.agentSpecialistSales': '--algolia-agent-specialist-sales',
  'color.agentSpecialistEvidence': '--algolia-agent-specialist-evidence',
  'color.backdrop': '--algolia-backdrop',
  'color.backdropBlur': '--algolia-backdrop-blur',

  // ── Typography ─────────────────────────────────────────────────────────────
  'typography.sans': '--algolia-font-sans',
  'typography.mono': '--algolia-font-mono',
  'typography.scale.2xs': '--algolia-fs-2xs',
  'typography.scale.xs': '--algolia-fs-xs',
  'typography.scale.sm': '--algolia-fs-sm',
  'typography.scale.base': '--algolia-fs-base',
  'typography.scale.lg': '--algolia-fs-lg',
  'typography.scale.xl': '--algolia-fs-xl',
  'typography.scale.2xl': '--algolia-fs-2xl',
  'typography.scale.hero': '--algolia-fs-hero',
  'typography.trackingCaps': '--algolia-tracking-caps',
  'typography.weight.regular': '--algolia-fw-regular',
  'typography.weight.medium': '--algolia-fw-medium',
  'typography.weight.bold': '--algolia-fw-bold',
  'typography.lineHeight.body': '--algolia-lh-body',
  'typography.lineHeight.heading': '--algolia-lh-heading',

  // ── Space ──────────────────────────────────────────────────────────────────
  'space.controlMin': '--algolia-control-min',
  'space.controlSm': '--algolia-control-sm',
  'space.sourceNameMaxW': '--algolia-source-name-max-w',
  'space.msgMaxW': '--algolia-msg-max-w',
  'space.thinkingBarMaxW': '--algolia-thinking-bar-max-w',
  'space.1': '--algolia-space-1',
  'space.2': '--algolia-space-2',
  'space.3': '--algolia-space-3',
  'space.4': '--algolia-space-4',
  'space.5': '--algolia-space-5',
  'space.6': '--algolia-space-6',
  'space.7': '--algolia-space-7',
  'space.8': '--algolia-space-8',
  'space.9': '--algolia-space-9',
  'space.10': '--algolia-space-10',
  'space.gutter': '--algolia-gutter',
  'space.measure': '--algolia-measure',
  'space.maxWidth': '--algolia-maxw',

  // ── Radius ─────────────────────────────────────────────────────────────────
  'radius.sm': '--algolia-radius-sm',
  'radius.md': '--algolia-radius-md',
  'radius.lg': '--algolia-radius-lg',
  'radius.xl': '--algolia-radius-xl',
  'radius.full': '--algolia-radius-full',

  // ── Shadow ─────────────────────────────────────────────────────────────────
  'shadow.1': '--algolia-shadow-1',
  'shadow.2': '--algolia-shadow-2',
  'shadow.3': '--algolia-shadow-3',
  'shadow.focus': '--algolia-shadow-focus',
  'shadow.glass': '--algolia-shadow-glass',

  // ── Motion ─────────────────────────────────────────────────────────────────
  'motion.fast': '--algolia-dur-fast',
  'motion.base': '--algolia-dur-base',
  'motion.slow': '--algolia-dur-slow',
  'motion.ease': '--algolia-ease',

  // ── Layout ─────────────────────────────────────────────────────────────────
  'layout.headerHeight': '--algolia-header-h',

  // Panel geometry (normal mode)
  'layout.panelWidth': '--algolia-panel-w',
  'layout.panelHeight': '--algolia-panel-h',

  // Docked panel
  'layout.dockedWidth': '--algolia-docked-w',
  'layout.dockedHeight': '--algolia-docked-h',
  'layout.dockedMinWidth': '--algolia-docked-min-w',
  'layout.dockedMinHeight': '--algolia-docked-min-h',
  'layout.dockedOffsetBottom': '--algolia-docked-offset-bottom',
  'layout.dockedOffsetRight': '--algolia-docked-offset-right',
  'layout.dockedMarginX': '--algolia-docked-margin-x',
  'layout.dockedMarginY': '--algolia-docked-margin-y',

  // Launcher FAB
  'layout.launcherSize': '--algolia-launcher-size',
  'layout.launcherOffsetBottom': '--algolia-launcher-offset-bottom',
  'layout.launcherOffsetRight': '--algolia-launcher-offset-right',

  // Stacking
  'layout.zLauncher': '--algolia-z-launcher',
  'layout.zPanel': '--algolia-z-panel',
};
