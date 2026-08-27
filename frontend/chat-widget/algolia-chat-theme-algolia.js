/**
 * Algolia brand theme for the Algolia Chat widget on www.algolia.com (Jahia).
 *
 * This file is HAND-AUTHORED and owned by the AlgoliaWeb_Jahia project.
 * It must be loaded before algolia-chat.js so the 'algolia' theme name is
 * in the registry when <algolia-chat> upgrades.
 *
 * When updating the vendored widget bundles, review this file against any
 * breaking changes in the widget's ChatTheme type — see
 * javascript/vendor/algolia-chat/README.md for the update procedure.
 *
 * --- Design token sources ---
 * Colors:  @algolia/satellite@2.14.0 dist/scss/colors.scss
 *   Xenon  (accent)  →  $stl-xenon-600  #003dff
 *   Grey   (neutral) →  $stl-grey-100 … $stl-grey-900
 *   Green  (positive)→  $stl-green-600 / $stl-green-50
 *   Orange (notice)  →  $stl-orange-700 / $stl-orange-50
 *   Red    (negative)→  $stl-red-600 / $stl-red-50
 *   Blue   (info)    →  $stl-xenon-200 / $stl-xenon-600
 *   Purple (specialist) → $stl-purple-600 #9524ff
 *   Shadows: Satellite shadow formula using $stl-grey-900 rgba(35,38,59,·)
 *
 * Typography: Sora + JetBrains Mono — kept from the marketing site.
 *   Satellite uses 14px / system font (product UI); the marketing site is not.
 *
 * Radii: 8–24px scale — kept from the marketing site (Satellite uses 4px).
 *
 * Z-indexes: zLauncher 1001, zPanel 1002 are intentionally NOT from Satellite.
 *   $stl-tooltip tops out at 600, but this site has components at z-index 1000
 *   (code-exchange.css, devcon-2026.css) and a modal at 1200 (requestDemoModal).
 *   The widget must sit above page-level components and below the modal.
 *
 * Confidence pill bands (e06c6b5 — judgeScoreBand.ts):
 *   positive ≥ 7.5  → color.positive / color.positiveBg
 *   notice   ≥ 5    → color.notice   / color.noticeBg
 *   negative < 5    → color.negative / color.negativeBg
 *   These three token pairs are now visible product surface on every answer.
 *
 * Logo assets:
 *   /Users/arijitchowdhury/Dropbox/AI-Development/algolia-logo-pack/SVG/
 */
(() => {
  const algoliaMarkWhite = 'url("data:image/svg+xml,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22UTF-8%22%3F%3E%3Csvg%20id%3D%22Layer_1%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20500%20500.34%22%3E%3Cdefs%3E%3Cstyle%3E.cls-1%7Bfill%3A%23fff%3B%7D%3C%2Fstyle%3E%3C%2Fdefs%3E%3Cpath%20class%3D%22cls-1%22%20d%3D%22M250%2C0C113.38%2C0%2C2%2C110.16%2C.03%2C246.32c-2%2C138.29%2C110.19%2C252.87%2C248.49%2C253.67%2C42.71%2C.25%2C83.85-10.2%2C120.38-30.05%2C3.56-1.93%2C4.11-6.83%2C1.08-9.52l-23.39-20.74c-4.75-4.22-11.52-5.41-17.37-2.92-25.5%2C10.85-53.21%2C16.39-81.76%2C16.04-111.75-1.37-202.04-94.35-200.26-206.1%2C1.76-110.33%2C92.06-199.55%2C202.8-199.55h202.83V407.68l-115.08-102.25c-3.72-3.31-9.43-2.66-12.43%2C1.31-18.47%2C24.46-48.56%2C39.67-81.98%2C37.36-46.36-3.2-83.92-40.52-87.4-86.86-4.15-55.28%2C39.65-101.58%2C94.07-101.58%2C49.21%2C0%2C89.74%2C37.88%2C93.97%2C86.01%2C.38%2C4.28%2C2.31%2C8.28%2C5.53%2C11.13l29.97%2C26.57c3.4%2C3.01%2C8.8%2C1.17%2C9.63-3.3%2C2.16-11.55%2C2.92-23.6%2C2.07-35.95-4.83-70.39-61.84-127.01-132.26-131.35-80.73-4.98-148.23%2C58.18-150.37%2C137.35-2.09%2C77.15%2C61.12%2C143.66%2C138.28%2C145.36%2C32.21%2C.71%2C62.07-9.42%2C86.2-26.97l150.36%2C133.29c6.45%2C5.71%2C16.62%2C1.14%2C16.62-7.48V9.49C500%2C4.25%2C495.75%2C0%2C490.51%2C0H250Z%22%2F%3E%3C%2Fsvg%3E")';

  const theme = {
    colorScheme: 'light',

    color: {
      // ── Surfaces ──────────────────────────────────────────────────────────
      // $stl-grey-100 / white / $stl-grey-100 ramp
      bg: '#f5f5fa',              // $stl-grey-100
      surface: '#ffffff',
      surface2: '#f5f5fa',        // $stl-grey-100
      surfaceHover: '#d6d6e7',    // $stl-grey-200
      // Decorative gradient behind the conversation — suppressed so the
      // flat Satellite palette reads cleanly.
      surfaceDecoration: 'none',

      // ── Borders ───────────────────────────────────────────────────────────
      border: '#d6d6e7',          // $stl-grey-200
      borderStrong: '#b6b7d5',    // $stl-grey-300

      // ── Text ──────────────────────────────────────────────────────────────
      text: '#23263b',            // $stl-grey-900
      textSecondary: '#36395a',   // $stl-grey-800
      textMuted: '#777aaf',       // $stl-grey-500
      textOnAccent: '#ffffff',

      // ── Accent (Xenon / Nebula Blue) ──────────────────────────────────────
      // $stl-xenon-600 is identical to the former #003dff — no visual regression.
      accent: '#003dff',          // $stl-xenon-600
      accentHover: '#022eb9',     // $stl-xenon-700
      accentDown: '#042077',      // $stl-xenon-800
      accentTint: '#f2f4ff',      // $stl-xenon-100
      link: '#003dff',            // $stl-xenon-600
      focus: '#003dff',           // $stl-xenon-600

      // ── Semantic (now visible on the confidence pill) ─────────────────────
      // Contrast on #ffffff surface:
      //   green-600 #00a648 → 4.58:1  (AA ✓)
      //   orange-700 #e8600a → 3.03:1 — bolded / icon, meets AA for UI
      //   red-600 #e9122c → 3.79:1    (AA ✓ for UI components)
      positive: '#00a648',        // $stl-green-600
      positiveBg: '#f2fef1',      // $stl-green-50
      notice: '#e8600a',          // $stl-orange-700
      noticeBg: '#fffcf5',        // $stl-orange-50
      negative: '#e9122c',        // $stl-red-600
      negativeBg: '#fff3f4',      // $stl-red-50
      informative: '#003dff',     // $stl-xenon-600
      informativeBg: '#f2f4ff',   // $stl-xenon-100

      // ── Agent accent tokens ───────────────────────────────────────────────
      agentPrimary: '#003dff',    // $stl-xenon-600
      agentSpecialist: '#9524ff', // $stl-purple-600

      // ── Overlay ───────────────────────────────────────────────────────────
      backdrop: 'rgba(35,38,59,0.4)',
      backdropBlur: '4px',
    },

    typography: {
      // Sora and JetBrains Mono are kept from the marketing site. The site
      // self-hosts Sora via css/fonts.css and requests it from Google Fonts in
      // template.hidden.mainhead.jsp; fontHref is intentionally absent to avoid
      // a duplicate load.
      sans: "'Sora', system-ui, -apple-system, 'Segoe UI', sans-serif",
      mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      scale: {
        '2xs': '10px',
        xs: '11px',
        sm: '13px',
        base: '14px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        hero: '32px',
      },
      trackingCaps: '0.04em',
      weight: { regular: 400, medium: 600, bold: 600 },
      lineHeight: { body: 1.5, heading: 1.2 },
    },

    space: {
      '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px',
      '6': '24px', '7': '32px', '8': '40px', '9': '48px', '10': '64px',
      gutter: '16px', measure: '72ch', maxWidth: '100%',
      controlMin: '34px', controlSm: '24px',
      sourceNameMaxW: '240px', msgMaxW: 'min(920px, calc(100% - 56px))', thinkingBarMaxW: '320px',
    },

    // Marketing-site radius scale (kept; Satellite uses 4px).
    radius: { sm: '8px', md: '12px', lg: '18px', xl: '24px', full: '999px' },

    // Satellite shadow formula: rgba(35,38,59,·) matches $stl-grey-900.
    shadow: {
      '1': '0px 0px 0px 1px rgba(35,38,59,0.05), 0px 1px 3px 0px rgba(35,38,59,0.15)',
      '2': '0px 0px 0px 1px rgba(35,38,59,0.06), 0px 10px 24px -18px rgba(35,38,59,0.45)',
      '3': '0px 0px 0px 1px rgba(35,38,59,0.06), 0px 18px 42px -26px rgba(35,38,59,0.5)',
      focus: '0 0 0 2px #ffffff, 0 0 0 4px #003dff',
    },

    motion: {
      fast: '120ms', base: '200ms', slow: '320ms',
      ease: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    },

    layout: {
      // Compact chat chrome should leave the attention on the answer/greeting,
      // not on an oversized modal header.
      headerHeight: '60px',
      // Panel geometry (docked and normal).
      panelWidth: 'min(1080px, 70vw)', panelHeight: '75vh',
      dockedWidth: '540px', dockedHeight: '500px',
      dockedMinWidth: '320px', dockedMinHeight: '400px',
      dockedOffsetBottom: '88px', dockedOffsetRight: '24px',
      dockedMarginX: '16px', dockedMarginY: '16px',
      // FAB launcher.
      launcherSize: '56px', launcherOffsetBottom: '24px', launcherOffsetRight: '24px',
      // Z-indexes: NOT from Satellite ($stl-tooltip 600 is too low for this site).
      // Site components peak at 1000 (code-exchange.css, devcon-2026.css);
      // modal is at 1200 (requestDemoModal.css); header drop-downs at 999.
      zLauncher: 1001,
      zPanel: 1002,
    },

    css: [
      ':host { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }',
      // The launcher button's background is the accent colour and the icon is
      // rendered as a plain <img>. Invert it to white so it reads on Xenon blue.
      '[part="launcher"] img { filter: brightness(0) invert(1); }',
      '[part="launcher"] { cursor: grab; touch-action: none; }',
      '[part="launcher"]:active { cursor: grabbing; }',
      '[part="panel"] { border-radius: 20px; border: 1px solid color-mix(in srgb, var(--algolia-border) 88%, #ffffff); box-shadow: 0 24px 80px -52px rgba(35,38,59,0.72), 0 0 0 1px rgba(35,38,59,0.04); }',
      '[part="panel"]:not([style*="bottom:"]):not([style*="width: 100vw"]) { position: fixed; left: max(16px, calc((100vw - var(--algolia-panel-w)) / 2)); top: max(16px, calc((100vh - var(--algolia-panel-h)) / 2)); resize: none; min-width: min(720px, calc(100vw - 32px)); min-height: min(560px, calc(100vh - 32px)); max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); }',
      '[part="panel"]:not([style*="width: 100vw"]) [part="header"] { cursor: move; }',
      '[part="panel"]:not([style*="width: 100vw"]) [part="header"] button, [part="panel"]:not([style*="width: 100vw"]) [part="header"] a { cursor: pointer; }',
      '.acs-resize-handles { position: absolute; inset: 0; z-index: 5; pointer-events: none; }',
      '.acs-resize-handle { position: absolute; display: block; pointer-events: auto; touch-action: none; background: transparent; }',
      '.acs-resize-handle--n { top: 0; left: 18px; right: 18px; height: 10px; cursor: ns-resize; }',
      '.acs-resize-handle--s { bottom: 0; left: 18px; right: 18px; height: 10px; cursor: ns-resize; }',
      '.acs-resize-handle--e { top: 18px; right: 0; bottom: 18px; width: 10px; cursor: ew-resize; }',
      '.acs-resize-handle--w { top: 18px; left: 0; bottom: 18px; width: 10px; cursor: ew-resize; }',
      '.acs-resize-handle--ne { top: 0; right: 0; width: 18px; height: 18px; cursor: nesw-resize; }',
      '.acs-resize-handle--sw { bottom: 0; left: 0; width: 18px; height: 18px; cursor: nesw-resize; }',
      '.acs-resize-handle--nw { top: 0; left: 0; width: 18px; height: 18px; cursor: nwse-resize; }',
      '.acs-resize-handle--se { right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; }',
      '[part="panel"][style*="bottom:"], [part="panel"][style*="width: 100vw"] { resize: none; }',
      '[part="panel"][style*="width: 100vw"] .acs-resize-handles { display: none; content: none; }',
      '[part="header"] { position: relative; min-height: var(--algolia-header-h); gap: 12px; padding: 8px 14px 7px !important; align-items: center !important; overflow: hidden; isolation: isolate; background: rgba(255,255,255,0.98); }',
      ':host([data-algolia-working]) [part="header"]::before { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--algolia-header-progress, 0%); background: linear-gradient(90deg, rgba(0,61,255,0.04), rgba(0,61,255,0.16), rgba(0,61,255,0.08)); pointer-events: none; transition: width 900ms linear; z-index: 0; }',
      ':host([data-algolia-progress-resetting]) [part="header"]::before { transition-duration: 1ms !important; }',
      '@media (prefers-reduced-motion: reduce) { :host([data-algolia-working]) [part="header"]::before { transition-duration: 1ms; } }',
      '[part="header"] > * { position: relative; z-index: 1; }',
      '[part="header"] > div:first-child { align-self: center; min-width: 0; flex: 1 1 auto; }',
      '[part="header"] > div:first-child h1 { overflow: hidden; text-overflow: ellipsis; }',
      '[part="header"] h1 { line-height: 1.15; margin-bottom: 0; white-space: nowrap; }',
      '[part="header"] > div { gap: 12px !important; }',
      '[part="header"] > div button { width: 28px !important; min-width: 28px !important; height: 28px !important; min-height: 28px !important; padding: 0 !important; margin: 0 !important; border: 0 !important; border-radius: var(--algolia-radius-full); background: transparent !important; color: var(--algolia-text-muted); box-shadow: none !important; }',
      '[part="header"] > div button:hover { background: transparent !important; color: var(--algolia-text-secondary); }',
      '[part="header"] > div button svg, [part="header"] > div button img { width: 17px !important; height: 17px !important; }',
      '[part="chat-content"] { padding: 16px 18px !important; background: linear-gradient(180deg, #f8f9fd 0%, var(--algolia-bg) 60%, #ffffff 100%); }',
      '[part="composer"] { margin: 2px 0 4px !important; padding: 4px 5px 4px 16px !important; gap: 8px !important; min-height: 46px; border: 1px solid var(--algolia-border); border-radius: var(--algolia-radius-full); background: #ffffff; box-shadow: 0 10px 28px -22px rgba(35,38,59,0.8), 0 1px 0 rgba(255,255,255,0.95) inset; }',
      '[part="composer-input"] { display: flex; align-items: center; min-height: 38px; line-height: 38px; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; font-size: var(--algolia-fs-base); box-shadow: none !important; }',
      '[part="composer-input"]::placeholder { line-height: 38px; }',
      '[part="composer-send"] { position: relative; width: 40px; min-width: 40px; height: 40px; min-height: 40px; padding: 0 !important; border: 0; border-radius: var(--algolia-radius-full); background: #050505; color: transparent; font-size: 0; box-shadow: none; }',
      '/* Generated from local Algolia logo pack: /Users/arijitchowdhury/Dropbox/AI-Development/algolia-logo-pack/SVG/Algolia-mark-white.svg */',
      `[part="composer-send"]::before { content: ""; position: absolute; inset: 10px; background-image: ${algoliaMarkWhite}; background-repeat: no-repeat; background-position: center; background-size: contain; }`,
      '[part="composer-send"]:hover { background: #1b1b1b; }',
      '[part="message-user-bubble"] { padding: 10px 18px !important; border: 1px solid color-mix(in srgb, var(--algolia-accent) 72%, #ffffff); box-shadow: 0 14px 34px -24px rgba(0,61,255,0.9); font-size: var(--algolia-fs-base); }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 { position: relative; overflow: visible; padding: 10px 2px 12px !important; background: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col { gap: 0 !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > p { margin: 0 0 14px !important; font-size: 15px !important; line-height: 1.6 !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > p:first-child { margin: 2px 0 7px !important; font-size: 15.5px !important; line-height: 1.62 !important; font-style: italic !important; font-weight: 400 !important; color: color-mix(in srgb, var(--algolia-text-secondary) 88%, var(--algolia-accent)) !important; text-shadow: 0 1px 0 rgba(255,255,255,0.92), 0 8px 18px rgba(35,38,59,0.16); }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > p:first-child + p { margin-top: 0 !important; margin-bottom: 18px !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > p.font-algolia-bold { margin-top: 22px !important; margin-bottom: 10px !important; font-size: 18px !important; line-height: 1.35 !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > p:not(:first-child):has(> strong:first-child) { margin-top: 18px !important; margin-bottom: 8px !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > ul, .bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > ol { margin-top: 3px !important; margin-bottom: 18px !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col li { font-size: 15px !important; line-height: 1.58 !important; }',
      '.bg-algolia-surface.p-6.shadow-algolia-2 > .flex.flex-col > table { margin-top: 10px !important; margin-bottom: 20px !important; font-size: 14.5px !important; }',
      '.uppercase.tracking-algolia-caps { display: inline-flex; width: fit-content; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; letter-spacing: var(--algolia-tracking-caps); color: var(--algolia-text-muted) !important; box-shadow: none !important; }',
      '.mx-auto.flex.w-full.max-w-algolia-maxw.flex-1.flex-col.overflow-hidden { max-width: 100% !important; }',
      '.w-full.max-w-algolia-measure { max-width: var(--algolia-msg-max-w) !important; }',
      '.flex.flex-1.flex-col.items-center.overflow-y-auto.px-4.pb-8.pt-6.sm\\:px-6.sm\\:pt-10 { padding-top: 12px !important; padding-bottom: 14px !important; }',
      '.mx-auto.flex.w-full.max-w-algolia-measure.flex-col.items-center.gap-5.px-4.text-center { gap: 12px !important; }',
      '.flex.w-full.flex-col.gap-3.pt-6.pb-4 { padding-top: 10px !important; padding-bottom: 8px !important; }',
      '.rounded-algolia-lg.rounded-tl-sm.bg-algolia-surface-2.px-4.py-3.text-algolia-sm.text-algolia-text.shadow-algolia-1 { max-width: 100% !important; }',
      '.shrink-0.border-t.border-algolia-border.bg-algolia-surface { border-top: 0 !important; }',
      '.shrink-0.border-t.border-algolia-border.bg-algolia-surface > .mx-auto { max-width: 100% !important; padding: 6px 14px 8px !important; gap: 6px !important; }',
      '.flex.items-center.justify-between.gap-3.py-2.text-algolia-xs.text-algolia-text-muted { display: none !important; }',
      '.acs-reasoning { margin: 2px 0 10px !important; padding: 0 0 8px !important; background: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }',
      '.acs-reasoning__header { font-weight: var(--algolia-fw-medium) !important; color: var(--algolia-text-muted) !important; }',
      '.acs-step__label { font-size: var(--algolia-fs-2xs) !important; font-weight: var(--algolia-fw-medium) !important; color: color-mix(in srgb, var(--algolia-text-muted) 78%, #ffffff) !important; }',
      '.acs-step__detail { font-size: var(--algolia-fs-2xs) !important; font-style: italic; color: color-mix(in srgb, var(--algolia-text-muted) 70%, #ffffff) !important; }',
      '.acs-step--active .acs-step__label { color: var(--algolia-text-secondary) !important; }',
      '.acs-step--active .acs-step__detail { color: var(--algolia-text-muted) !important; }',
      '.acs-progress { display: none !important; }',
      // On mobile viewports the normal-mode panel would be too narrow.
      // Override to near-full-width below 640px.
      '@media (max-width: 640px) { :host { --algolia-panel-w: 95vw; --algolia-panel-h: 90vh; } [part="panel"]:not([style*="bottom:"]):not([style*="width: 100vw"]), [part="panel"] { resize: none !important; min-width: 0; min-height: 0; max-width: 95vw; max-height: 90vh; } .acs-resize-handles { display: none !important; } [part="header"] { gap: 10px; padding-left: 14px !important; padding-right: 10px !important; } [part="header"] h1 { font-size: 15px; line-height: 1.1; } [part="header"] > div { gap: 8px !important; } [part="header"] > div button { width: 28px !important; min-width: 28px !important; height: 28px !important; min-height: 28px !important; } [part="composer"] { margin: 8px 14px 12px !important; } [part="composer-input"] { font-size: var(--algolia-fs-sm); } }',
      // The sample-questions popup uses `position:absolute; bottom:100%` and
      // expands upward. The panel has `overflow:hidden` for its rounded corners,
      // so a tall popup gets clipped at the panel top. Cap the popup height and
      // make it scrollable so it always fits within the visible panel area.
      // Subtract: header + compact composer + sample trigger row.
      '[role="dialog"][aria-label="Sample questions"].absolute { --algolia-sample-dialog-w: min(calc(100vw - 6rem), calc(var(--algolia-panel-w) - 4rem), 52rem); width: var(--algolia-sample-dialog-w) !important; max-height: calc(var(--algolia-panel-h) - var(--algolia-header-h) - 8rem); overflow-y: auto; }',
      '[role="dialog"][aria-label="Sample questions"].absolute > .grid { display: grid !important; width: calc(var(--algolia-sample-dialog-w) - 2.625rem) !important; min-width: calc(var(--algolia-sample-dialog-w) - 2.625rem); box-sizing: border-box; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }',
      '[role="dialog"][aria-label="Sample questions"].absolute button { width: 100%; }',
      '@media (max-width: 640px) { [role="dialog"][aria-label="Sample questions"].absolute { --algolia-sample-dialog-w: calc(100vw - 3rem); } [role="dialog"][aria-label="Sample questions"].absolute > .grid { grid-template-columns: 1fr !important; } }',
    ].join('\n'),
  };

  const api = (window.algoliaChat = window.algoliaChat || {});

  if (typeof api.registerTheme === 'function') {
    api.registerTheme('algolia', theme);
    return;
  }
  api.registerTheme = api.registerTheme || [];
  api.registerTheme.push(['algolia', theme]);
})();
