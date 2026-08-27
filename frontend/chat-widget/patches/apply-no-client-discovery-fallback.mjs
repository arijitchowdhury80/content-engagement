import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = resolve(root, 'algolia-chat.js');
const before = readFileSync(bundlePath, 'utf8');
const from = 'a(i,0,{status:"success",text:w.lastVisibleAnswer,error:void 0,confidenceSuppressed:!0,followUps:__arrieOneDiscoveryQuestion(n.query)})';
const to = '(()=>{const E=__arrieTrailingDiscoveryQuestion(w.lastVisibleAnswer),A=__arrieStripDiscoveryTail(w.lastVisibleAnswer,E);a(i,0,{status:"success",text:A,error:void 0,confidenceSuppressed:!0,followUps:E?[E]:[]})})()';

let output = before;
if (!output.includes(to)) {
  const count = output.split(from).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one client discovery fallback; found ${count}.`);
  output = output.replace(from, to);
}

if (output !== before) writeFileSync(bundlePath, output);
process.stdout.write(`${JSON.stringify({ pass: true, changed: output !== before, bundlePath })}\n`);
