// B9 step 4 — live grounding/offer spot-check against the PRODUCTION generic agent.
// Search-only key, same wire path as the browser client. Prints per turn: answer
// text, retrieved hit titles/urls (grounding), and the prefix-2 suggestion frame
// (flagging SPECIALIST: offers). Read-only: POST /completions never mutates agents.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = [join(__dirname, '..', '..', '..', '.env.local')].find((p) => existsSync(p));
const ENV = {};
for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID;
const SEARCH_KEY = ENV.ALGOLIA_SEARCH_API_KEY;
const AGENT = process.argv[2]; // live agent id
const Q = process.argv[3];
const url = `https://${APP}.algolia.net/agent-studio/1/agents/${AGENT}/completions?compatibilityMode=ai-sdk-4`;

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': SEARCH_KEY },
  body: JSON.stringify({ messages: [{ role: 'user', content: Q }] }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let text = '';
while (true) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }

const lines = text.split('\n').filter(Boolean);
let answer = '';
const hits = [];
const suggestions = [];
function routeHit(h) { if (h && typeof h === 'object' && (h.url || h.title)) hits.push({ title: h.title, url: h.url, source: h.source }); }
function collectHits(r) { if (Array.isArray(r)) r.forEach((x) => (Array.isArray(x?.hits) ? x.hits.forEach(routeHit) : routeHit(x))); else if (r && Array.isArray(r.hits)) r.hits.forEach(routeHit); else routeHit(r); }
for (const line of lines) {
  const c = line.indexOf(':'); if (c < 0) continue;
  const prefix = line.slice(0, c), payload = line.slice(c + 1);
  if (prefix === '0') { try { answer += JSON.parse(payload); } catch {} }
  else if (prefix === 'a') { try { collectHits(JSON.parse(payload).result); } catch {} }
  else if (prefix === '2') { try { const arr = JSON.parse(payload); if (Array.isArray(arr)) for (const e of arr) if (Array.isArray(e?.suggestions)) suggestions.push(...e.suggestions); } catch {} }
}
console.log(`HTTP ${res.status}`);
console.log(`\nQ: ${Q}`);
console.log(`\nANSWER (${answer.length}ch):\n${answer.slice(0, 700)}${answer.length > 700 ? '…' : ''}`);
console.log(`\nRETRIEVED HITS (${hits.length}) — grounding:`);
for (const h of hits.slice(0, 8)) console.log(`  - [${h.source ?? '?'}] ${h.title ?? '(no title)'}  ${h.url ?? ''}`);
console.log(`\nSUGGESTIONS (${suggestions.length}):`);
for (const s of suggestions) console.log(`  ${s.startsWith('SPECIALIST:') ? '>>> OFFER >>> ' : '(follow-up) '}${s}`);
const offer = suggestions.some((s) => s.startsWith('SPECIALIST:'));
console.log(`\nOFFER PRESENT: ${offer ? 'YES' : 'no'}`);
