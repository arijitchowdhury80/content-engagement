import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

const removals = [
  `  function setJudgeMode(mode) {
    const confidence = host()?.querySelector("algolia-chat-confidence");
    if (!confidence || confidence.getAttribute("mode") === mode) return;
    confidence.setAttribute("mode", mode);
    log("judge mode:", mode);
  }

`,
  `    // The Jahia block stays statically fail-safe at mode="off". Compare owns
    // the browser-time policy and enables judges for the default single panel.
    setJudgeMode("algolia");
`,
  '    setJudgeMode("algolia");\n',
  '    setJudgeMode(compareOn ? "off" : "algolia");\n',
  '      if (!compareOn) setJudgeMode("algolia");\n',
];

export function isolateCompareFromJudge(source) {
  if (!source.includes('setJudgeMode') && !source.includes('algolia-chat-confidence')) return source;
  let output = source;
  for (const fragment of removals) {
    const count = output.split(fragment).length - 1;
    if (count !== 1) throw new Error(`Expected exactly one Compare judge-control fragment; found ${count}.`);
    output = output.replace(fragment, '');
  }
  if (output.includes('setJudgeMode') || output.includes('algolia-chat-confidence')) {
    throw new Error('Compare still contains judge-control behavior after isolation.');
  }
  return output;
}

if (resolve(process.argv[1] || '') === scriptPath) {
  if (!process.argv.includes('--stdin')) throw new Error('--stdin is required; this transformer never edits source files.');
  process.stdout.write(isolateCompareFromJudge(readFileSync(0, 'utf8')));
}
