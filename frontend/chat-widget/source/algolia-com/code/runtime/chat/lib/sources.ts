/**
 * sources — normalize raw Agent Studio `a:` hits into AnswerSource, then group
 * by the hit's `source` facet for the pill UI. The facet list comes from the
 * active instance's `sourceFacets` config, so a new instance brings its own
 * source facets with zero code edits. Pure functions, no DOM, no React.
 */
import { activeInstance } from '../../config/active';
import {
  pickRecordString,
  pickRecordTitle,
  pickRecordUrl,
  resolveRecordId,
} from '../../shared/recordFields';
import type { AnswerSource } from '../types';

export interface SourceGroupMeta {
  key: string;
  label: string;
}

export interface SourceGroup extends SourceGroupMeta {
  sources: AnswerSource[];
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Group metadata drives both labels and bucketing. When the active instance hasn't
 * configured `sourceFacets` (an unconfigured embed), derive one group per distinct
 * raw `source` value seen on the hits themselves instead of collapsing everything
 * into "Other" — the hit's own `source` field is real data, just uncurated.
 */
function groupMeta(sources: AnswerSource[]): SourceGroupMeta[] {
  if (activeInstance.sourceFacets.length > 0) {
    return [
      ...activeInstance.sourceFacets.map((f) => ({ key: f.value, label: f.label })),
      { key: 'other', label: activeInstance.strings.sources.fallbackGroup },
    ];
  }
  const derived = new Map<string, SourceGroupMeta>();
  for (const s of sources) {
    if (s.source && !derived.has(s.source)) {
      derived.set(s.source, { key: s.source, label: titleCase(s.source) });
    }
  }
  return [...derived.values(), { key: 'other', label: activeInstance.strings.sources.fallbackGroup }];
}

/**
 * Normalize one raw `a:` hit object into an AnswerSource.
 *
 * Returns null when the record offers nothing to show. Unlike the judges, which
 * read every record retrieval returns, a citation pill has to render a label a
 * visitor can click or read — a record with neither a title nor a link has no
 * pill to draw, even though it still counts as evidence.
 */
export function normalizeHit(hit: Record<string, unknown>): AnswerSource | null {
  const title = pickRecordTitle(hit);
  const url = pickRecordUrl(hit);
  if (!title && !url) return null;
  return {
    id: resolveRecordId(hit),
    title: title ?? url ?? activeInstance.strings.sources.fallbackTitle,
    url,
    source: pickRecordString(hit, ['source']),
  };
}

export function facetForHit(s: AnswerSource, meta: SourceGroupMeta[]): string {
  if (s.source && meta.some((m) => m.key === s.source)) return s.source;
  return 'other';
}

function sourceKey(s: AnswerSource): string {
  return (s.url ?? s.title).toLowerCase();
}

/** Group sources by `source` facet into ordered, non-empty groups, deduped
 *  within each group (first occurrence wins). */
export function groupSources(sources: AnswerSource[]): SourceGroup[] {
  const meta = groupMeta(sources);
  const buckets = new Map<string, { sources: AnswerSource[]; seen: Set<string> }>();
  for (const s of sources) {
    const key = facetForHit(s, meta);
    let b = buckets.get(key);
    if (!b) {
      b = { sources: [], seen: new Set() };
      buckets.set(key, b);
    }
    const id = sourceKey(s);
    if (b.seen.has(id)) continue;
    b.seen.add(id);
    b.sources.push(s);
  }
  return meta
    .filter((m) => buckets.has(m.key))
    .map((m) => ({
      ...m,
      sources: buckets.get(m.key)!.sources,
    }));
}

/** Total deduped source count across groups. */
export function totalSources(groups: SourceGroup[]): number {
  return groups.reduce((n, g) => n + g.sources.length, 0);
}

/**
 * Strip a site-configured suffix from a pill title so the pill shows just the
 * page name — the facet is already conveyed by the group label.
 *
 * The pattern is read from `activeInstance.sourceDisplay.titleSuffixPattern` and
 * applied case-insensitively. When absent, the title passes through unchanged.
 * An invalid regex is silently ignored and the original title is returned.
 */
export function cleanTitle(s: AnswerSource): string {
  const pattern = activeInstance.sourceDisplay?.titleSuffixPattern;
  if (!pattern) return s.title;
  try {
    const t = s.title.replace(new RegExp(pattern, 'i'), '').trim();
    return t || s.title;
  } catch {
    return s.title;
  }
}

/** Test `text` against a regex `pattern` string (case-insensitive). Returns false on an
 *  invalid pattern rather than throwing, so a misconfigured site never breaks the UI. */
function safeTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return false;
  }
}

/**
 * Returns true when the source represents a changelog/release-notes page —
 * these are collapsed into a "+N release notes" count rather than individual pills.
 *
 * Detection rules come from `activeInstance.sourceDisplay`:
 *   `releaseNoteUrlPattern`       — regex matched against the URL
 *   `releaseNoteTitleWordPattern` — regex matched against the title (combined
 *                                    with a 4-digit year in the same title)
 *
 * When neither pattern is configured the function always returns false, so all
 * pills render individually (the correct default for a site with no release notes).
 */
export function isReleaseNote(s: AnswerSource): boolean {
  const cfg = activeInstance.sourceDisplay;
  if (!cfg) return false;
  if (cfg.releaseNoteUrlPattern && s.url && safeTest(cfg.releaseNoteUrlPattern, s.url)) return true;
  return (
    !!cfg.releaseNoteTitleWordPattern &&
    safeTest(cfg.releaseNoteTitleWordPattern, s.title) &&
    /\b(19|20)\d{2}\b/.test(s.title)
  );
}
