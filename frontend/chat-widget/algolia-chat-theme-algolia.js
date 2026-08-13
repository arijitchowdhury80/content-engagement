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
 */
(() => {
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
        xs: '12px',
        sm: '14px',
        base: '16px',
        lg: '18px',
        xl: '22px',
        '2xl': '28px',
        hero: '36px',
      },
      trackingCaps: '0.04em',
      weight: { regular: 400, medium: 600, bold: 600 },
      lineHeight: { body: 1.5, heading: 1.2 },
    },

    space: {
      '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px',
      '6': '24px', '7': '32px', '8': '40px', '9': '48px', '10': '64px',
      gutter: '24px', measure: '72ch', maxWidth: '1120px',
      controlMin: '32px', controlSm: '24px',
      sourceNameMaxW: '240px', msgMaxW: '640px', thinkingBarMaxW: '320px',
    },

    // Marketing-site radius scale (kept; Satellite uses 4px).
    radius: { sm: '8px', md: '12px', lg: '18px', xl: '24px', full: '999px' },

    // Satellite shadow formula: rgba(35,38,59,·) matches $stl-grey-900.
    shadow: {
      '1': '0px 0px 0px 1px rgba(35,38,59,0.05), 0px 1px 3px 0px rgba(35,38,59,0.15)',
      '2': '0px 0px 0px 1px rgba(35,38,59,0.05), 0px 4px 8px -2px rgba(35,38,59,0.25)',
      '3': '0px 0px 0px 1px rgba(35,38,59,0.05), 0px 8px 16px -4px rgba(35,38,59,0.25)',
      focus: '0 0 0 2px #ffffff, 0 0 0 4px #003dff',
    },

    motion: {
      fast: '120ms', base: '200ms', slow: '320ms',
      ease: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    },

    layout: {
      // Header height matches the md:h-20 (80px) sticky nav used on the site.
      headerHeight: '80px',
      // Panel geometry (docked and normal).
      panelWidth: '75vw', panelHeight: '75vh',
      dockedWidth: '420px', dockedHeight: '600px',
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
      // On mobile viewports the 75vw normal-mode panel would be too narrow.
      // Override to near-full-width below 640px.
      '@media (max-width: 640px) { :host { --algolia-panel-w: 95vw; --algolia-panel-h: 90vh; } }',
      // The sample-questions popup uses `position:absolute; bottom:100%` and
      // expands upward. The panel has `overflow:hidden` for its rounded corners,
      // so a tall popup gets clipped at the panel top. Cap the popup height and
      // make it scrollable so it always fits within the visible panel area.
      // Subtract: header + ~10 rem (composer + button row + powered-by + padding).
      '[role="dialog"].absolute { max-height: calc(var(--algolia-panel-h) - var(--algolia-header-h) - 10rem); overflow-y: auto; }',
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
