
/**
 * Tailwind theme for chat-central — mirrors the `--algolia-*` token contract
 * defined in src/styles/tokens.css.
 *
 * Content scanning covers all TypeScript/TSX files in this package. When
 * consumed by algolia-chat (via the source alias), algolia-chat's own
 * tailwind.config.ts is the canonical config; this one is used only for
 * chat-central's standalone build.
 */
module.exports = {
  content: ['./source/**/*.{ts,tsx,js,mjs}'],
  theme: {
    extend: {
      colors: {
        'algolia-bg': 'var(--algolia-bg)',
        'algolia-surface': 'var(--algolia-surface)',
        'algolia-surface-2': 'var(--algolia-surface-2)',
        'algolia-surface-hover': 'var(--algolia-surface-hover)',
        'algolia-border': 'var(--algolia-border)',
        'algolia-border-strong': 'var(--algolia-border-strong)',
        'algolia-text': 'var(--algolia-text)',
        'algolia-text-secondary': 'var(--algolia-text-secondary)',
        'algolia-text-muted': 'var(--algolia-text-muted)',
        'algolia-text-on-accent': 'var(--algolia-text-on-accent)',
        'algolia-accent': 'var(--algolia-accent)',
        'algolia-accent-hover': 'var(--algolia-accent-hover)',
        'algolia-accent-down': 'var(--algolia-accent-down)',
        'algolia-accent-tint': 'var(--algolia-accent-tint)',
        'algolia-link': 'var(--algolia-link)',
        'algolia-focus': 'var(--algolia-focus)',
        'algolia-positive': 'var(--algolia-positive)',
        'algolia-positive-bg': 'var(--algolia-positive-bg)',
        'algolia-notice': 'var(--algolia-notice)',
        'algolia-notice-bg': 'var(--algolia-notice-bg)',
        'algolia-negative': 'var(--algolia-negative)',
        'algolia-negative-bg': 'var(--algolia-negative-bg)',
        'algolia-informative': 'var(--algolia-informative)',
        'algolia-informative-bg': 'var(--algolia-informative-bg)',
        'algolia-agent-primary': 'var(--algolia-agent-primary)',
        'algolia-agent-specialist': 'var(--algolia-agent-specialist)',
      },
      fontFamily: {
        'algolia-sans': 'var(--algolia-font-sans)',
        'algolia-mono': 'var(--algolia-font-mono)',
      },
      fontSize: {
        'algolia-2xs': 'var(--algolia-fs-2xs)',
        'algolia-xs': 'var(--algolia-fs-xs)',
        'algolia-sm': 'var(--algolia-fs-sm)',
        'algolia-base': 'var(--algolia-fs-base)',
        'algolia-lg': 'var(--algolia-fs-lg)',
        'algolia-xl': 'var(--algolia-fs-xl)',
        'algolia-2xl': 'var(--algolia-fs-2xl)',
        'algolia-hero': 'var(--algolia-fs-hero)',
      },
      fontWeight: {
        'algolia-regular': 'var(--algolia-fw-regular)',
        'algolia-medium': 'var(--algolia-fw-medium)',
        'algolia-bold': 'var(--algolia-fw-bold)',
      },
      lineHeight: {
        'algolia-body': 'var(--algolia-lh-body)',
        'algolia-heading': 'var(--algolia-lh-heading)',
      },
      borderRadius: {
        'algolia-sm': 'var(--algolia-radius-sm)',
        'algolia-md': 'var(--algolia-radius-md)',
        'algolia-lg': 'var(--algolia-radius-lg)',
        'algolia-xl': 'var(--algolia-radius-xl)',
        'algolia-full': 'var(--algolia-radius-full)',
      },
      boxShadow: {
        'algolia-1': 'var(--algolia-shadow-1)',
        'algolia-2': 'var(--algolia-shadow-2)',
        'algolia-3': 'var(--algolia-shadow-3)',
        'algolia-focus': 'var(--algolia-shadow-focus)',
      },
      transitionDuration: {
        'algolia-fast': 'var(--algolia-dur-fast)',
        'algolia-base': 'var(--algolia-dur-base)',
        'algolia-slow': 'var(--algolia-dur-slow)',
      },
      transitionTimingFunction: {
        'algolia-ease': 'var(--algolia-ease)',
      },
      maxWidth: {
        'algolia-maxw': 'var(--algolia-maxw)',
        'algolia-measure': 'var(--algolia-measure)',
        'algolia-source-name': 'var(--algolia-source-name-max-w)',
        'algolia-msg': 'var(--algolia-msg-max-w)',
        'algolia-thinking-bar': 'var(--algolia-thinking-bar-max-w)',
      },
      minHeight: {
        'algolia-control': 'var(--algolia-control-min)',
        'algolia-control-sm': 'var(--algolia-control-sm)',
      },
      letterSpacing: {
        'algolia-caps': 'var(--algolia-tracking-caps)',
      },
    },
  },
  plugins: [],
};
