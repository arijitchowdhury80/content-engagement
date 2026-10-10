/**
 * recordFields — how a raw Algolia record is read as a citable source.
 *
 * Two consumers need the same answer to "what is this record's title, its link,
 * and its body text?": the citation pills (`chat/lib/sources.ts`) and the
 * grounding judges (`judge/hostedJudgeClient.ts`). Each used to hardcode
 * `title` / `url` / `body`.
 *
 * Nothing here decides whether a record counts. Algolia indexes are schemaless,
 * so an attribute name can only ever be a good guess about presentation, never
 * a test of validity — using one as a filter is what made the SSE parser drop
 * every hit from an index that spells its title `display_name`, leaving the
 * judges with no sources and every answer scored UNSUPPORTED. Retrieval decides
 * what is a record; these names decide only how one is displayed and read.
 *
 * The defaults below cover the common spellings. An index that uses something
 * else supplies its own names via the `record-fields` attribute on
 * `<algolia-chat>`; those are tried ahead of the defaults rather than replacing
 * them, so a mapping only has to name what is unusual about that index.
 */
import { activeInstance } from '../config/active';

/** Candidate attribute names for each part of a source, richest-first. */
export interface RecordFieldMap {
  /** Attributes that may hold the record's display title. */
  title: string[];
  /** Attributes that may hold the record's canonical link. */
  url: string[];
  /** Attributes that may hold the record's substantive body text. */
  text: string[];
}

/**
 * Field names tried when the embedding site supplies no mapping.
 *
 * `body` leads the text list because the crawler ingest scripts write it; the
 * rest are the spellings seen across hand-built and third-party indexes.
 */
const DEFAULT_RECORD_FIELDS: RecordFieldMap = {
  title: ['title', 'name', 'display_name', 'displayName', 'heading', 'label'],
  url: ['url', 'permalink', 'link', 'href', 'marketing_url', 'marketingUrl'],
  text: ['body', 'content', 'text', 'snippet', 'summary', 'description', 'excerpt', 'abstract'],
};

let activeFields: RecordFieldMap = DEFAULT_RECORD_FIELDS;

/** Custom names first, then the built-ins, with duplicates removed. */
function prependCustom(custom: string[] | undefined, defaults: string[]): string[] {
  if (!custom?.length) return defaults;
  return [...new Set([...custom.filter((f) => typeof f === 'string' && f.trim()), ...defaults])];
}

/**
 * Register the index's own attribute names. Each list is tried ahead of the
 * built-in candidates, so a mapping need only name what is unusual.
 *
 * Callers pass whatever the embedding site supplied, which is usually nothing;
 * an absent mapping leaves the current names in place rather than resetting
 * them, matching how every other runtime config value is merged.
 */
export function configureRecordFields(overrides?: Partial<RecordFieldMap>): void {
  if (!overrides) return;
  activeFields = {
    title: prependCustom(overrides.title, DEFAULT_RECORD_FIELDS.title),
    url: prependCustom(overrides.url, DEFAULT_RECORD_FIELDS.url),
    text: prependCustom(overrides.text, DEFAULT_RECORD_FIELDS.text),
  };
}

/** Restore the built-in field names. Used by tests. */
export function resetRecordFields(): void {
  activeFields = DEFAULT_RECORD_FIELDS;
}

export function getRecordFields(): RecordFieldMap {
  return activeFields;
}

/** First non-empty string among `fields`, trimmed; undefined when none match. */
export function pickRecordString(
  record: Record<string, unknown>,
  fields: string[],
): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function pickRecordTitle(record: Record<string, unknown>): string | undefined {
  return pickRecordString(record, activeFields.title);
}

/** True for any URL with an explicit scheme (`https://…`) or a protocol-relative
 *  one (`//host/…`) — anything else is a bare path that needs a base to resolve
 *  against. */
export function isAbsoluteUrl(url: string): boolean {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * A record's `url` field is data from the index, not necessarily a full link —
 * many corpora store a bare path (`/resources/asset/...`). Left alone, the
 * browser resolves that path against whatever page currently embeds the
 * widget, not the record's real site — harmless on the real production
 * domain, wrong on any staging/preview host. Absolute URLs pass through
 * unchanged; a relative one resolves against `canonicalBaseUrl` when the
 * embed has configured it, or is dropped (undefined) so the pill renders as
 * non-clickable rather than silently pointing at the wrong host.
 */
export function normalizeRecordUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (isAbsoluteUrl(raw)) return raw;
  if (!activeInstance.canonicalBaseUrl) return undefined;
  try {
    return new URL(raw, activeInstance.canonicalBaseUrl).toString();
  } catch {
    return undefined;
  }
}

export function pickRecordUrl(record: Record<string, unknown>): string | undefined {
  return normalizeRecordUrl(pickRecordString(record, activeFields.url));
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * Stable identity for a record, used to collapse the repeats that a multi-search
 * turn produces.
 *
 * `objectID` is the only attribute Algolia guarantees, so it leads. The rest is
 * for tool results that drop it: a content hash keeps a record recognisable as
 * itself across searches, where a random id would make every repeat look like a
 * new source and quietly spend the judges' excerpt budget several times over.
 */
export function resolveRecordId(record: Record<string, unknown>): string {
  const objectId = pickRecordString(record, ['objectID', 'objectId']);
  if (objectId) return objectId;
  return pickRecordUrl(record) ?? pickRecordTitle(record) ?? hashRecord(record);
}

/** FNV-1a over the record's own serialization — cheap, stable, and good enough
 *  to tell two retrieved records apart. */
function hashRecord(record: Record<string, unknown>): string {
  const json = JSON.stringify(record, Object.keys(record).sort());
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `rec_${hash.toString(36)}`;
}

// ── Body text ────────────────────────────────────────────────────────────────

/** Attributes that are plumbing rather than evidence. */
const NON_EVIDENCE_KEYS = new Set(['objectID', 'objectId', '_geoloc', 'thumbnail', 'image']);

/**
 * Upper bound on the *structured* part of a record's evidence, so a record with
 * many attributes cannot crowd out the per-source excerpt budget the judges
 * share. Prose is deliberately left uncapped: the judge's own excerpter picks
 * the passages that bear on the answer, and truncating a long page here would
 * discard evidence before it ever gets to make that choice.
 */
const MAX_STRUCTURED_CHARS = 2000;

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Render one attribute value, or undefined when it carries no evidence. */
function renderValue(value: unknown): string | undefined {
  if (isPrimitive(value)) return String(value).trim() || undefined;
  if (Array.isArray(value)) {
    const parts = value
      .filter(isPrimitive)
      .map((v) => String(v).trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }
  return undefined;
}

/**
 * `key: value` for every attribute carrying evidence.
 *
 * `skip` names attributes the caller has already rendered in full, so the same
 * text is not presented to the judges twice. The title and url are dropped by
 * value rather than by name, since either may be spelled differently here than
 * in the configured candidate lists.
 */
const EMPTY_SKIP: ReadonlySet<string> = new Set();

function structuredLines(record: Record<string, unknown>, skip: ReadonlySet<string>): string[] {
  const title = pickRecordTitle(record);
  const url = pickRecordUrl(record);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('_') || NON_EVIDENCE_KEYS.has(key) || skip.has(key)) continue;
    const rendered = renderValue(value);
    if (!rendered || rendered === title || rendered === url) continue;
    lines.push(`${key}: ${rendered}`);
  }

  return lines;
}

/**
 * Describe an entity record using whatever attributes it does carry.
 *
 * Entity indexes — a customer, a product, a capability per record — hold no
 * prose at all: the facts live in fields like `industry_tags` or
 * `features_used`. Falling back to the title alone gave the judges a bare name
 * and nothing to verify a claim against, so answers built from exactly these
 * records were flagged as unsupported. Serialising the remaining attributes
 * turns the record's own structure into the evidence it actually is.
 */
export function describeRecord(record: Record<string, unknown>): string {
  const title = pickRecordTitle(record);
  const lines = title ? [title] : [];
  lines.push(...structuredLines(record, EMPTY_SKIP));
  return lines.join('\n').slice(0, MAX_STRUCTURED_CHARS);
}

/** The prose field holding the most text, if the record has one. */
function pickProse(record: Record<string, unknown>): { key: string; value: string } | undefined {
  let best: { key: string; value: string } | undefined;
  for (const field of activeFields.text) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > (best?.value.length ?? 0)) {
      best = { key: field, value: value.trim() };
    }
  }
  return best;
}

/**
 * Everything on the record that could support a claim: its fullest prose field
 * followed by its remaining attributes.
 *
 * Prose and structure used to be alternatives, which meant a record carrying
 * both handed the judges only the prose — an answer drawing on a record's
 * `pricing_tier` or `region` was unverifiable against the very record it came
 * from, and got flagged unsupported. A record is evidence in whole, so it is
 * read in whole.
 */
export function pickRecordText(record: Record<string, unknown>): string {
  const prose = pickProse(record);
  if (!prose) return describeRecord(record);

  const structured = structuredLines(record, new Set([prose.key]))
    .join('\n')
    .slice(0, MAX_STRUCTURED_CHARS);

  return structured ? `${prose.value}\n${structured}` : prose.value;
}
