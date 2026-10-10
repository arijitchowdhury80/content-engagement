import { activeInstance } from '../../config/active';

/**
 * Optional attribution footer.
 *
 * Renders only when the embed has configured at least one of `poweredBy.label`
 * or `poweredBy.logo`. When both are empty the footer is omitted entirely so
 * the slot falls through to nothing. The implementing site supplies these via
 * the `powered-by-label` and `powered-by-logo` attributes (or leaves them
 * blank to show no attribution).
 *
 * The logo `alt` text is derived from the label text, so it stays meaningful
 * regardless of which service the implementing site credits.
 */
export function PoweredBy() {
  const { label, logo } = activeInstance.poweredBy;
  const disclaimer = activeInstance.disclaimer;
  if (!label && !logo && !disclaimer) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-algolia-xs text-algolia-text-muted">
      {disclaimer ? <span>{disclaimer}</span> : <span />}
      {(label || logo) && (
        <div className="flex shrink-0 items-center gap-1.5">
          {label && <span>{label}</span>}
          {logo && <img src={logo} alt={label || ''} className="h-3.5 w-auto opacity-70" />}
        </div>
      )}
    </div>
  );
}
