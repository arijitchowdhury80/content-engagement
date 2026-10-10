import type { ReactNode } from 'react';

export interface IconOrImgProps {
  /** Host-supplied image URL. When absent, `fallback` renders instead. */
  src?: string;
  /** Classes applied to the `<img>`; the fallback carries its own sizing. */
  className?: string;
  /** Pixel width/height for the `<img>`, for icons sized by attribute. */
  size?: number;
  /** Built-in glyph used when the host has not supplied `src`. */
  fallback: ReactNode;
}

/**
 * Renders a host-supplied icon URL when one is configured, otherwise the
 * built-in glyph. Every swappable icon in the widget goes through this so an
 * override never needs a component-specific code path.
 *
 * Overrides are decorative — the surrounding control supplies the accessible
 * name — so the image is always `alt=""` and `aria-hidden`.
 */
export function IconOrImg({ src, className, size, fallback }: IconOrImgProps) {
  if (!src) return <>{fallback}</>;
  return <img src={src} alt="" aria-hidden className={className} width={size} height={size} />;
}
