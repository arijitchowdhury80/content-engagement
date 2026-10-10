/**
 * JSX intrinsic element declaration for <algolia-confidence-badge>.
 * TypeScript picks this up automatically because it lives inside the
 * paths covered by tsconfig.app.json's `include` glob.
 *
 * The actual custom element class is defined in algolia-chat (the
 * custom-element layer); this declaration only tells TypeScript that
 * the JSX tag is valid.
 */

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'algolia-confidence-badge': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export {};
