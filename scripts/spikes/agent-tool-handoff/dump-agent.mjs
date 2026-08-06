// Dumps a published agent's full JSON so we can inspect its real tool schema.
// Usage: node dump-agent.mjs <agentId> <outFile>
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [process.env.ACS_ENV, join(process.cwd(), '.env.local'), join(__dirname, '..', '..', '..', '.env.local')]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!envPath) { console.error('no .env.local found'); process.exit(1); }
const ENV = {};
for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID, KEY = ENV.ALGOLIA_ADMIN_API_KEY;
const BASE = `https://${APP}.algolia.net/agent-studio/1`;
const H = { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.4.0' };

const [agentId, outFile] = process.argv.slice(2);
if (!agentId || !outFile) { console.error('usage: node dump-agent.mjs <agentId> <outFile>'); process.exit(1); }

const r = await fetch(`${BASE}/agents/${agentId}`, { headers: H });
const body = await r.text();
if (r.status !== 200) { console.error(`GET /agents/${agentId} -> ${r.status}: ${body.slice(0, 400)}`); process.exit(1); }
const json = JSON.parse(body);

mkdirSync(join(__dirname, '..', '..', '..', 'docs', 'spikes'), { recursive: true });
writeFileSync(outFile, JSON.stringify(json, null, 2));
console.log(`wrote ${outFile}`);
console.log(`tool count: ${json.tools?.length ?? 0}`);
console.log(`tool[0] keys: ${json.tools?.[0] ? Object.keys(json.tools[0]).join(', ') : '(none)'}`);
console.log(`tool[0].type field: ${json.tools?.[0]?.type ?? '(no "type" field present)'}`);
