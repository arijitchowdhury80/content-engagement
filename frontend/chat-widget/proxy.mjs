/**
 * Compare-with-production harness server.
 *
 *   node frontend/chat-widget/proxy.mjs        # then open http://localhost:8765/
 *
 * One process does three jobs:
 *   1. serves harness.local.html + the widget bundles from this directory;
 *   2. GET  /config  — hands the browser the CONCIERGE (0EXRPAXB56) public search
 *                      config for the left column, which it calls directly;
 *   3. POST /prod    — forwards to the live algolia.com Ask AI agent for the right
 *                      column, injecting `Origin: https://www.algolia.com`.
 *
 * Why /prod exists: `Origin` is a forbidden request header, so browser JS cannot
 * present www.algolia.com, and production's per-agent approved-domains list 403s
 * every other origin. A server-side hop can set it. This defeats a lightweight
 * abuse control on the org's OWN infrastructure, exercised read-only for a
 * comparison, with a senior-provided (already-public) search key. See the plan's
 * authorization-basis section. Not a pattern for any account that is not the
 * org's own with credentials given for the purpose.
 *
 * No secret is ever sent to the browser: the production key is used only inside
 * this process; the concierge key handed to the browser is a public search key.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PORT = Number(process.env.PORT) || 8765;

// --- .env.local (same precedence idiom as the repo's Node scripts) ------------
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(REPO_ROOT, '.env.local')]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!envPath) {
  console.error('[proxy] no .env.local found — copy .env.example to .env.local and fill it in.');
  process.exit(1);
}
const ENV = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

// Left column: concierge on the project app. Its search key is public by class.
const CONCIERGE = {
  appId: ENV.ALGOLIA_APP_ID || '0EXRPAXB56',
  searchKey: ENV.ALGOLIA_SEARCH_API_KEY || '',
  indexName: 'Algolia_Prod_Copy_Enhanced',
  agentId: 'e2c8596a-4420-41d2-80bb-5cd4aaeffda6',
};
// Right column: the live algolia.com Ask AI agent. Key stays server-side.
const PROD = {
  appId: ENV.PROD_ASKAI_APP_ID || '1QDAWL72TQ',
  searchKey: ENV.PROD_ASKAI_SEARCH_KEY || '',
  agentId: ENV.PROD_ASKAI_AGENT_ID || 'ebff018c-66e1-44df-b33a-2a58a0188840',
  spoofOrigin: 'https://www.algolia.com',
};

for (const [label, cfg, key] of [['concierge', CONCIERGE, 'searchKey'], ['production', PROD, 'searchKey']]) {
  if (!cfg[key]) console.warn(`[proxy] WARNING: ${label} ${key} is empty in .env.local — that side will 4xx.`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.map': 'application/json; charset=utf-8' };

function completionsUrl(appId, agentId) {
  return `https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?stream=true&compatibilityMode=ai-sdk-5`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 1. Left-column config for the browser. No production secret here.
  if (url.pathname === '/config') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ concierge: CONCIERGE, prodAgentId: PROD.agentId }));
    return;
  }

  // 2. Right-column proxy: forward one turn to live production with a spoofed Origin.
  if (url.pathname === '/prod') {
    if (req.method !== 'POST') { res.writeHead(405).end('POST only'); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      const upstream = await fetch(completionsUrl(PROD.appId, PROD.agentId), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-algolia-application-id': PROD.appId,
          'x-algolia-api-key': PROD.searchKey,
          origin: PROD.spoofOrigin, // the whole point of this hop
        },
        body,
      });
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      });
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
      else res.end();
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`[proxy] upstream error: ${e.message}`);
    }
    return;
  }

  // 3. Static files from this directory. Default to the harness page.
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/harness.local.html';
  const filePath = normalize(join(__dirname, rel));
  if (!filePath.startsWith(__dirname)) { res.writeHead(403).end('forbidden'); return; } // no path escape
  if (!existsSync(filePath)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`[proxy] harness  → http://localhost:${PORT}/`);
  console.log(`[proxy] left  = concierge  ${CONCIERGE.appId} / ${CONCIERGE.agentId}  (browser calls direct)`);
  console.log(`[proxy] right = production ${PROD.appId} / ${PROD.agentId}  (via /prod, Origin ${PROD.spoofOrigin})`);
});
