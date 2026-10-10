import { Fragment, type ReactNode } from 'react';
import { normalizeRecordUrl } from '../../shared/recordFields';
import { cleanVisibleAnswerText } from '../visibleAnswer';

export { stripDeadSpecialistOffer, stripLeakedToolCallSyntax } from '../visibleAnswer';

export interface MessageMarkdownProps {
  text: string;
  /** Terms the deterministic source check could not locate. They remain
   * visible in the answer and receive advisory review styling only. */
  unsupportedTerms?: readonly string[];
}

interface TextSegment {
  type: 'text' | 'code-block';
  content: string;
  lang?: string;
}

interface RenderContext {
  unsupportedTerms: readonly string[];
  hasPriorContent?: boolean;
}

/**
 * XSS-safe markdown-lite renderer. Deliberately hand-rolled instead of
 * dangerouslySetInnerHTML + a sanitizer: every node here is a real React
 * element built from parsed substrings, so there is no HTML-injection surface
 * to sanitize in the first place — safety by construction, not by scrubbing.
 * Supports: fenced code blocks, inline code, **bold**, ATX headings (#–######),
 * bullet/ordered lists, GFM tables, and [text](url) links — http(s) absolute
 * URLs pass through unchanged, a bare path (`/resources/...`) resolves against
 * `canonicalBaseUrl` the same way a source-pill record URL does (see
 * `resolveLinkHref` below), and any other scheme (`javascript:`, `data:`, a
 * bare `//host` protocol-relative URL) is rejected — the link text still
 * renders, just not as a clickable `<a>`, since this text comes from the
 * agent's own free-form answer and isn't a URL an attacker could pre-validate.
 * Anything else renders as plain text.
 */
function splitCodeBlocks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code-block', content: match[2], lang: match[1] || undefined });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

const INLINE_RE = /\*\*(.+?)\*\*|\*([^*\n]+?)\*|`([^`]+)`|\[([^[\]]+)\]\(\s*([^\s)]+)\s*\)/g;

/**
 * A link's href in the agent's answer text is either an absolute http(s) URL
 * (pass through) or a bare path like `/resources/asset/...` (resolve against
 * `canonicalBaseUrl`, same mechanism as a source-pill record URL — see
 * `normalizeRecordUrl`). Anything else — `javascript:`, `data:`, a bare
 * `//host` protocol-relative URL, a schemeless `www.foo.com` — is rejected:
 * unlike a source pill's URL (data from the search index), this text is the
 * agent's own free-form output, so scheme-sniffing it before treating it as
 * absolute would be an XSS-adjacent hole this renderer is otherwise built
 * (see file header) to have none of.
 */
export function resolveLinkHref(raw: string): string | undefined {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/') && !raw.startsWith('//')) return normalizeRecordUrl(raw);
  return undefined;
}

/** A resolvable href becomes a real link; otherwise just the label renders,
 *  same non-clickable-fallback pattern as an unresolvable source-pill URL. */
function renderLinkNode(
  linkText: string,
  linkHref: string,
  key: string,
  unsupportedTerms: readonly string[],
): ReactNode {
  const resolvedHref = resolveLinkHref(linkHref);
  if (!resolvedHref) return renderAdvisoryText(linkText, `${key}-text`, unsupportedTerms);
  return (
    <a
      key={key}
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
      className="text-algolia-link underline underline-offset-2"
    >
      {renderAdvisoryText(linkText, `${key}-text`, unsupportedTerms)}
    </a>
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Preserve every answer character while marking exact unsupported-term spans
 * for source review. This is deliberately advisory: it never replaces,
 * suppresses, or gates the answer text. */
function renderAdvisoryText(
  text: string,
  keyPrefix: string,
  unsupportedTerms: readonly string[] = [],
): ReactNode {
  const terms = [
    ...new Map(
      unsupportedTerms
        .map((term) => term.trim())
        .filter(Boolean)
        .map((term) => [term.toLowerCase(), term]),
    ).values(),
  ].sort((a, b) => b.length - a.length);
  if (!terms.length) return text;

  const termSet = new Set(terms.map((term) => term.toLowerCase()));
  const parts = text.split(new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi'));
  return parts.filter(Boolean).map((part, index) =>
    termSet.has(part.toLowerCase()) ? (
      <span
        key={`${keyPrefix}-review-${index}`}
        className="text-algolia-negative underline decoration-dotted underline-offset-2"
        title="needs source review"
        data-source-review="unsupported-term"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function appendAdvisoryText(
  nodes: ReactNode[],
  text: string,
  keyPrefix: string,
  unsupportedTerms: readonly string[],
): void {
  const rendered = renderAdvisoryText(text, keyPrefix, unsupportedTerms);
  if (Array.isArray(rendered)) nodes.push(...(rendered as ReactNode[]));
  else nodes.push(rendered);
}

/** Render whichever alternative of `INLINE_RE` matched — one node, or `null`
 *  if none of the capture groups came through (shouldn't happen given the
 *  regex, but keeps this exhaustive without inflating renderInline itself). */
function renderInlineMatch(
  match: RegExpExecArray,
  key: string,
  unsupportedTerms: readonly string[],
): ReactNode {
  const [, bold, italic, code, linkText, linkHref] = match;
  if (bold !== undefined) {
    return (
      <strong key={key} className="font-algolia-bold">
        {renderAdvisoryText(bold, `${key}-bold`, unsupportedTerms)}
      </strong>
    );
  }
  if (italic !== undefined)
    return <em key={key}>{renderAdvisoryText(italic, `${key}-italic`, unsupportedTerms)}</em>;
  if (code !== undefined) {
    return (
      <code
        key={key}
        className="rounded-algolia-sm bg-algolia-surface-2 px-1 py-0.5 font-algolia-mono text-algolia-xs text-algolia-text"
      >
        {renderAdvisoryText(code, `${key}-code`, unsupportedTerms)}
      </code>
    );
  }
  if (linkText !== undefined && linkHref !== undefined) {
    return renderLinkNode(linkText, linkHref, key, unsupportedTerms);
  }
  return null;
}

export function renderInline(
  text: string,
  keyPrefix: string,
  unsupportedTerms: readonly string[] = [],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      appendAdvisoryText(
        nodes,
        text.slice(lastIndex, match.index),
        `${keyPrefix}-text-${i}`,
        unsupportedTerms,
      );
    }
    nodes.push(renderInlineMatch(match, `${keyPrefix}-${i++}`, unsupportedTerms));
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    appendAdvisoryText(nodes, text.slice(lastIndex), `${keyPrefix}-text-${i}`, unsupportedTerms);
  }
  return nodes;
}

const BULLET_ITEM_RE = /^[*-]\s+(.*)$/;
const ORDERED_ITEM_RE = /^\d+[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_ROW_RE = /^\|/;
/** A GFM thematic break: 3+ of the same `-`/`*`/`_` on their own line. */
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/** Split a GFM table row into trimmed cell strings. */
function parseTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/** A separator row contains only dashes, colons, and pipes (e.g. `:---`, `---:`). */
function isTableSeparator(line: string): boolean {
  return parseTableRow(line).every((c) => /^:?-+:?$/.test(c) && c.length > 0);
}

function splitBlocks(text: string): string[] {
  return text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
}

type Run =
  | { kind: 'bullet' | 'ordered' | 'prose'; lines: string[] }
  | { kind: 'heading'; lines: string[]; level: number }
  | { kind: 'table'; lines: string[] }
  | { kind: 'hr'; lines: string[] };

/** Kinds whose consecutive lines merge into a single run. */
type MergeableKind = 'bullet' | 'ordered' | 'prose' | 'table';

/** Classify a line that is neither a heading nor a table row. */
function lineKind(line: string): 'bullet' | 'ordered' | 'prose' {
  if (BULLET_ITEM_RE.test(line)) return 'bullet';
  if (ORDERED_ITEM_RE.test(line)) return 'ordered';
  return 'prose';
}

/** Extend the trailing run when it is the same kind, otherwise start a new one. */
function appendLine(runs: Run[], kind: MergeableKind, line: string): void {
  const last = runs[runs.length - 1];
  if (last && last.kind === kind) {
    last.lines.push(line);
    return;
  }
  runs.push(kind === 'table' ? { kind, lines: [line] } : { kind, lines: [line] });
}

function groupIntoRuns(block: string): Run[] {
  const runs: Run[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      // Each heading is always its own run — never merged.
      runs.push({ kind: 'heading', lines: [line], level: headingMatch[1].length });
      continue;
    }

    if (HR_RE.test(line)) {
      // Each thematic break is always its own run — never merged.
      runs.push({ kind: 'hr', lines: [line] });
      continue;
    }

    appendLine(runs, TABLE_ROW_RE.test(line) ? 'table' : lineKind(line), line);
  }
  return runs;
}

const HEADING_SIZE_CLASS: Record<number, string> = {
  1: 'text-algolia-xl',
  2: 'text-algolia-lg',
  3: 'text-algolia-md',
  4: 'text-algolia-sm',
  5: 'text-algolia-sm',
  6: 'text-algolia-sm',
};

function renderRun(
  run: Run,
  keyPrefix: string,
  hasPriorContent: boolean,
  unsupportedTerms: readonly string[],
): ReactNode {
  if (run.kind === 'table') return renderTable(run.lines, keyPrefix, unsupportedTerms);
  if (run.kind === 'heading')
    return renderHeading(run.lines[0], run.level, keyPrefix, {
      hasPriorContent,
      unsupportedTerms,
    });
  if (run.kind === 'hr') return <hr key={keyPrefix} className="my-1 border-algolia-border" />;
  if (run.kind === 'prose') return renderProse(run.lines, keyPrefix, unsupportedTerms);
  return renderList(run.kind, run.lines, keyPrefix, unsupportedTerms);
}

function renderTable(
  lines: string[],
  keyPrefix: string,
  unsupportedTerms: readonly string[],
): ReactNode {
  const rows = lines.map(parseTableRow);
  const headerRow = rows[0] ?? [];
  // Skip the separator row if present (typically the second line).
  const bodyStart = rows.length > 1 && isTableSeparator(lines[1]) ? 2 : 1;
  const bodyRows = rows.slice(bodyStart);
  return (
    <div key={keyPrefix} className="overflow-x-auto">
      <table className="w-full border-collapse text-algolia-sm text-algolia-text">
        <thead>
          <tr>
            {headerRow.map((cell, ci) => (
              <th
                key={ci}
                className="border border-algolia-border bg-algolia-surface-2 px-3 py-2 text-left font-algolia-bold"
              >
                {renderInline(cell, `${keyPrefix}-h${ci}`, unsupportedTerms)}
              </th>
            ))}
          </tr>
        </thead>
        {bodyRows.length > 0 && (
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-algolia-border px-3 py-2">
                    {renderInline(cell, `${keyPrefix}-r${ri}c${ci}`, unsupportedTerms)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

function renderHeading(
  line: string,
  level: number,
  keyPrefix: string,
  context: RenderContext,
): ReactNode {
  const headingMatch = HEADING_RE.exec(line);
  const headingText = headingMatch ? headingMatch[2] : line;
  const sizeClass = HEADING_SIZE_CLASS[level] ?? 'text-algolia-sm';
  const marginClass = context.hasPriorContent ? 'mt-5' : 'mt-1';
  return (
    <p
      key={keyPrefix}
      className={`mb-0 break-words font-algolia-bold leading-ac-body text-algolia-text ${marginClass} ${sizeClass}`}
    >
      {renderInline(headingText, keyPrefix, context.unsupportedTerms)}
    </p>
  );
}

function renderProse(
  lines: string[],
  keyPrefix: string,
  unsupportedTerms: readonly string[],
): ReactNode {
  return (
    <p
      key={keyPrefix}
      className="m-0 whitespace-pre-wrap break-words text-algolia-sm leading-ac-body text-algolia-text"
    >
      {renderInline(lines.join('\n'), keyPrefix, unsupportedTerms)}
    </p>
  );
}

function renderList(
  kind: 'bullet' | 'ordered',
  lines: string[],
  keyPrefix: string,
  unsupportedTerms: readonly string[],
): ReactNode {
  const isBullet = kind === 'bullet';
  const itemRe = isBullet ? BULLET_ITEM_RE : ORDERED_ITEM_RE;
  const ListTag = isBullet ? 'ul' : 'ol';
  return (
    <ListTag
      key={keyPrefix}
      className={`m-0 space-y-2 py-1 pl-6 marker:font-algolia-bold marker:text-algolia-accent text-algolia-sm leading-ac-body text-algolia-text ${
        isBullet ? 'list-disc' : 'list-decimal'
      }`}
    >
      {lines.map((line, li) => {
        const itemText = line.replace(itemRe, '$1');
        return (
          <li key={`${keyPrefix}-${li}`}>
            {renderInline(itemText, `${keyPrefix}-${li}`, unsupportedTerms)}
          </li>
        );
      })}
    </ListTag>
  );
}

function renderParagraphs(
  text: string,
  keyPrefix: string,
  unsupportedTerms: readonly string[],
): ReactNode {
  const runs = splitBlocks(text).flatMap(groupIntoRuns);
  return runs.map((run, index) =>
    renderRun(run, `${keyPrefix}-r${index}`, index > 0, unsupportedTerms),
  );
}

export function MessageMarkdown({ text, unsupportedTerms = [] }: MessageMarkdownProps) {
  const segments = splitCodeBlocks(cleanVisibleAnswerText(text));
  return (
    <div className="acs-answer-layer flex flex-col gap-3">
      {segments.map((seg, i) =>
        seg.type === 'code-block' ? (
          <pre
            key={i}
            className="m-0 max-w-full overflow-x-auto rounded-algolia-sm border border-algolia-border bg-algolia-surface-2 p-3 font-algolia-mono text-algolia-xs leading-ac-body text-algolia-text"
          >
            <code className="whitespace-pre">{seg.content.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          <Fragment key={i}>{renderParagraphs(seg.content, `seg-${i}`, unsupportedTerms)}</Fragment>
        ),
      )}
    </div>
  );
}
