interface LocationLike {
  hostname: string;
  search: string;
}

const DISCOVERY_QUERY_PARAM = 'algoliaChatDiscovery';

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parseQueryValue(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0') return false;
  return true;
}

/**
 * Local dev escape hatch for testing discovery without editing the host HTML.
 * Explicit element attributes always win; the query override is localhost-only.
 */
export function resolveDiscoveryEnabled(
  attrValue: boolean | undefined,
  locationLike: LocationLike | undefined = globalThis.location,
): boolean | undefined {
  if (attrValue !== undefined) return attrValue;
  if (!locationLike || !isLocalHost(locationLike.hostname)) return undefined;
  return parseQueryValue(new URLSearchParams(locationLike.search).get(DISCOVERY_QUERY_PARAM));
}
