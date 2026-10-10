const SOURCE_GROUP_ORDER = Object.freeze([
  "documentation",
  "support",
  "website",
  "blog",
  "academy",
  "resources",
  "developers",
  "customer stories",
  "other",
]);

function sourceLabel(value) {
  const raw = String(value?.source || value?.type || value?.category || "Other").trim();
  return raw || "Other";
}

function sourceTitle(source) {
  const raw = String(source?.title || source?.name || source?.url || "Source").trim();
  return raw || "Source";
}

function sourceUrl(source) {
  const raw = String(source?.url || source?.href || source?.link || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, globalThis.location?.href || "https://www.algolia.com/");
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function sourceDisplayTitle(source) {
  return sourceTitle(source)
    .replace(/\s*\|\s*Algolia(?:\s+Docs?)?\s*$/i, "")
    .trim() || sourceTitle(source);
}

export function normalizeSourcePresentationValue(source) {
  return Object.freeze({
    id: String(source?.objectID || source?.id || source?.evidencePassageId || source?.passageId || "").trim(),
    label: sourceLabel(source),
    title: sourceTitle(source),
    displayTitle: sourceDisplayTitle(source),
    url: sourceUrl(source),
    description: String(source?.description || "").trim(),
    text: String(source?.text || "").trim(),
  });
}

export function sourcePresentationSignature(sources = []) {
  try {
    return JSON.stringify((Array.isArray(sources) ? sources : []).map(normalizeSourcePresentationValue));
  } catch {
    return "";
  }
}

export function createAlgoliaSourceGroups(sources = []) {
  const groups = new Map();
  for (const rawSource of Array.isArray(sources) ? sources : []) {
    const source = normalizeSourcePresentationValue(rawSource);
    const key = source.label.toLowerCase();
    const id = `${source.url}::${source.title}`.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, label: source.label, sources: [], seen: new Set() });
    const group = groups.get(key);
    if (!group.seen.has(id)) {
      group.seen.add(id);
      group.sources.push(source);
    }
  }
  return Object.freeze([...groups.values()]
    .sort((left, right) => {
      const leftOrder = SOURCE_GROUP_ORDER.indexOf(left.key);
      const rightOrder = SOURCE_GROUP_ORDER.indexOf(right.key);
      const a = leftOrder === -1 ? SOURCE_GROUP_ORDER.length : leftOrder;
      const b = rightOrder === -1 ? SOURCE_GROUP_ORDER.length : rightOrder;
      return a - b || left.label.localeCompare(right.label);
    })
    .map(({ seen, ...group }) => Object.freeze({
      ...group,
      sources: Object.freeze([...group.sources]),
    })));
}
