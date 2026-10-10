import { useState } from 'react';
import { groupSources, cleanTitle, isReleaseNote } from '../lib/sources';
import { activeInstance } from '../../config/active';
import { interpolate } from '../../config/strings';
import type { AnswerSource } from '../types';

export interface SourcePillsProps {
  sources: AnswerSource[];
}

const PILL =
  'acs-source-pill acs-source-pill--link inline-flex max-w-full items-center rounded-algolia-full border border-algolia-border px-2.5 py-0.5 text-algolia-xs text-algolia-text no-underline transition-all duration-algolia-fast ease-algolia-ease hover:border-algolia-accent';
const PILL_STATIC =
  'acs-source-pill acs-source-pill--static inline-flex max-w-full items-center rounded-algolia-full border border-algolia-border px-2.5 py-0.5 text-algolia-xs text-algolia-text opacity-90';
const NAME = 'max-w-algolia-source-name overflow-hidden text-ellipsis whitespace-nowrap';

function SourcePill({ s }: { s: AnswerSource }) {
  return s.url ? (
    <a href={s.url} target="_blank" rel="noopener noreferrer" className={PILL} title={s.title}>
      <span className={NAME}>{cleanTitle(s)}</span>
    </a>
  ) : (
    <span className={PILL_STATIC} title={s.title}>
      <span className={NAME}>{cleanTitle(s)}</span>
    </span>
  );
}

interface SourceDisplay {
  primary: ReturnType<typeof groupSources>[number]['sources'];
  releases: number;
  releaseList: ReturnType<typeof groupSources>[number]['sources'];
}

function buildSourceDisplay(group: ReturnType<typeof groupSources>[number]): SourceDisplay {
  const primary = group.sources.filter((s) => !isReleaseNote(s));
  const releaseList = group.sources.filter((s) => isReleaseNote(s));
  return { primary, releases: releaseList.length, releaseList };
}

function ExpandToggle({
  expanded,
  releases,
  onToggle,
}: {
  expanded: boolean;
  releases: number;
  onToggle: () => void;
}) {
  const s = activeInstance.strings.sources;
  const label = expanded
    ? s.showLess
    : interpolate(releases > 1 ? s.moreMany : s.moreOne, { count: releases });
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="inline-flex items-center gap-0.5 rounded-algolia-full px-1 text-algolia-xs text-algolia-text-muted transition-colors hover:text-algolia-accent"
    >
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      {label}
    </button>
  );
}

/** One source facet's clickable label + count badge — sits in the horizontal
 *  row alongside every other group's label. Clicking it unfolds that group's
 *  pills in the row below (`SourceGroupBody`), it never expands inline next
 *  to the label itself. */
function SourceGroupLabel({
  group,
  open,
  onToggle,
}: {
  group: ReturnType<typeof groupSources>[number];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={interpolate(activeInstance.strings.sources.groupAria, {
        label: group.label,
        count: group.sources.length,
        action: open
          ? activeInstance.strings.sources.collapse
          : activeInstance.strings.sources.expand,
      })}
      className="acs-source-group-pill inline-flex shrink-0 items-center gap-1.5 rounded-algolia-full border border-algolia-border px-2 py-0.5 transition-all duration-algolia-fast ease-algolia-ease hover:border-algolia-accent"
    >
      <span className="text-algolia-2xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-text-secondary">
        {group.label}
      </span>
      <span
        className={`acs-source-group-count inline-flex min-w-[18px] items-center justify-center rounded-algolia-full px-1.5 text-algolia-2xs font-algolia-bold ${
          open
            ? 'bg-algolia-accent text-algolia-text-on-accent'
            : 'bg-algolia-accent-tint text-algolia-accent'
        }`}
      >
        {group.sources.length}
      </span>
    </button>
  );
}

/** One group's unfolded pill list — rendered below the whole row of labels,
 *  never next to its own label, so multiple opened groups stack as separate
 *  rows instead of interleaving with each other's pills. */
function SourceGroupBody({ group }: { group: ReturnType<typeof groupSources>[number] }) {
  const [expanded, setExpanded] = useState(false);
  const { primary, releases, releaseList } = buildSourceDisplay(group);
  if (primary.length === 0 && releases === 0) return null;

  const shown = expanded ? [...primary, ...releaseList] : primary;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-1">
      <span className="shrink-0 text-algolia-2xs text-algolia-text-muted">{group.label}:</span>
      {shown.map((s) => (
        <SourcePill key={s.id} s={s} />
      ))}
      {releases > 0 && (
        <ExpandToggle
          expanded={expanded}
          releases={releases}
          onToggle={() => setExpanded((v) => !v)}
        />
      )}
    </div>
  );
}

/** Grounded source badges built from the answer's `a:` hit frames. Grouped by
 *  source facet, titles cleaned, release pages collapsed behind a toggle.
 *  Group labels sit in one horizontal row; clicking one unfolds its pills in
 *  their own row below — multiple groups can be open at once. */
export function SourcePills({ sources }: SourcePillsProps) {
  const groups = groupSources(sources);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  if (groups.length === 0) return null;

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div
      className="acs-source-section flex flex-col gap-2 pt-5"
      aria-label={activeInstance.strings.sources.sectionLabel}
    >
      <span className="text-algolia-2xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-text-muted">
        {activeInstance.strings.sources.heading}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.map((group) => (
          <SourceGroupLabel
            key={group.key}
            group={group}
            open={openKeys.has(group.key)}
            onToggle={() => toggle(group.key)}
          />
        ))}
      </div>
      {groups
        .filter((group) => openKeys.has(group.key))
        .map((group) => (
          <SourceGroupBody key={group.key} group={group} />
        ))}
    </div>
  );
}
