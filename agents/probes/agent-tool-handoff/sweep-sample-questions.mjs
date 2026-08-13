// Runs the project's sample questions VERBATIM against a live agent and classifies
// each answer as SYNTHESIS vs LINK-LIST. Verbatim matters: Agent Studio caches
// completions by exact query text, so rewording a question silently dodges any
// cached pre-fix failure. Read-only: POST /completions never mutates agents.
//
// usage: node sweep-sample-questions.mjs <agentId> <questionsFile> <outJsonl>
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
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
const AGENT = process.argv[2];
const QFILE = process.argv[3];
const OUT = process.argv[4];
const questions = readFileSync(QFILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
writeFileSync(OUT, '');

// A "link-list" answer is one whose substance is references rather than prose:
// most of its non-empty lines carry a markdown link or a bare /doc|http path, and
// it holds little unlinked sentence text.
function classify(answer) {
  const lines = answer.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return { verdict: 'EMPTY', linkLines: 0, totalLines: 0, proseChars: 0 };
  const linkLine = (l) => /\]\(|https?:\/\/|\(\/doc|`\/doc/.test(l);
  const linkLines = lines.filter(linkLine).length;
  // prose = characters on lines that are NOT link lines and are not headings
  const proseChars = lines.filter((l) => !linkLine(l) && !l.startsWith('#')).join(' ').length;
  const linkRatio = linkLines / lines.length;
  let verdict;
  if (answer.length < 250) verdict = 'THIN';
  else if (linkRatio >= 0.6 && proseChars < 400) verdict = 'LINK-LIST';
  else if (proseChars < 300) verdict = 'LINK-LIST';
  else verdict = 'SYNTHESIS';
  return { verdict, linkLines, totalLines: lines.length, proseChars, linkRatio: +linkRatio.toFixed(2) };
}

async function ask(q) {
  const url = `https://${APP}.algolia.net/agent-studio/1/agents/${AGENT}/completions?compatibilityMode=ai-sdk-4`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': SEARCH_KEY },
    body: JSON.stringify({ messages: [{ role: 'user', content: q }] }),
  });
  const raw = await res.text();
  let answer = '';
  const hits = [];
  const routeHit = (h) => { if (h && typeof h === 'object' && (h.url || h.title)) hits.push({ title: h.title, source: h.source }); };
  const collectHits = (r) => { if (Array.isArray(r)) r.forEach((x) => (Array.isArray(x?.hits) ? x.hits.forEach(routeHit) : routeHit(x))); else if (r && Array.isArray(r.hits)) r.hits.forEach(routeHit); else routeHit(r); };
  for (const line of raw.split('\n').filter(Boolean)) {
    const c = line.indexOf(':'); if (c < 0) continue;
    const prefix = line.slice(0, c), payload = line.slice(c + 1);
    if (prefix === '0') { try { answer += JSON.parse(payload); } catch {} }
    else if (prefix === 'a') { try { collectHits(JSON.parse(payload).result); } catch {} }
  }
  return { status: res.status, answer, hits: hits.length };
}

for (let i = 0; i < questions.length; i++) {
  const q = questions[i];
  let rec;
  try {
    const r = await ask(q);
    rec = { n: i + 1, q, status: r.status, answerLen: r.answer.length, hits: r.hits, ...classify(r.answer), answer: r.answer };
  } catch (e) {
    rec = { n: i + 1, q, status: 'ERROR', error: String(e).slice(0, 200), verdict: 'ERROR' };
  }
  appendFileSync(OUT, JSON.stringify(rec) + '\n');
  console.log(`${String(i + 1).padStart(2)}/${questions.length}  ${String(rec.verdict).padEnd(10)} ${String(rec.answerLen ?? '-').padStart(5)}ch  hits=${String(rec.hits ?? '-').padStart(3)}  ${q.slice(0, 60)}`);
}
console.log('\ndone →', OUT);
