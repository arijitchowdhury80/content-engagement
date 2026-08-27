import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const bundlePath = resolve(root, 'algolia-chat.js');

const replacements = [
  {
    label: 'mandatory confidence element',
    from: 'static get observedAttributes(){return["mode","agents"]}get judgeMode(){return this.getAttribute("mode")==="off"?"off":"algolia"}',
    to: 'static get observedAttributes(){return["agents"]}get judgeMode(){return"algolia"}',
  },
  {
    label: 'mandatory inline judge mode resolver',
    from: 'function wA(e){return e==="off"?"off":"algolia"}',
    to: 'function wA(e){return"algolia"}',
  },
  {
    label: 'role-specific validation retry',
    from: 'async function __arrieRunRoleJudge(e,n,i,a,s,u=fetch,f){const d=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;let g,v=[];try{f?.({phase:"judging",role:i,attempt:1});const w=await GA(e,n,i,a,`${d}-attempt-1`,u,s,v);if(w.ok)return f?.({phase:"complete",role:i,attempt:1,report:w}),w;v=w.errors,g=new Error(v.join("; "))}catch(w){g=w,v=[]}const w={ok:!1,role:i,errors:[$a(g??"Judge failed validation")]};return f?.({phase:"failed",role:i,attempt:1,reason:w.errors[0]}),w}',
    to: 'async function __arrieRunRoleJudge(e,n,i,a,s,u=fetch,f){const d=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;let g,v=[];for(let w=1;w<=2&&!s.aborted;w++)try{f?.(w===1?{phase:"judging",role:i,attempt:w}:{phase:"retrying",role:i,attempt:w,reason:g?.message??"The prior report failed validation."});const E=await GA(e,n,i,a,`${d}-attempt-${w}`,u,s,v);if(E.ok)return f?.({phase:"complete",role:i,attempt:w,report:E}),E;v=E.errors,g=new Error(v.join("; "))}catch(E){g=E,v=[]}const w={ok:!1,role:i,errors:[$a(g??"Judge failed validation twice")]};return f?.({phase:"failed",role:i,attempt:2,reason:w.errors[0]}),w}',
  },
  {
    label: 'parallel panel without destructive deadline',
    from: 'const f=new AbortController,d=setTimeout(()=>f.abort(new Error("Judge panel deadline exceeded after 30000ms")),3e4);try{const g=s.ROLES.map(v=>__arrieRunRoleJudge(a.env,a.agents[v],v,u,f.signal,fetch,n?.onJudgeProgress)),w=await Promise.all(g),E=s.aggregateJudgeReports(w);return __arriePanelVerdict(i,E,u,w)}finally{clearTimeout(d)}',
    to: 'const f=new AbortController,d=s.ROLES.map(g=>__arrieRunRoleJudge(a.env,a.agents[g],g,u,f.signal,fetch,n?.onJudgeProgress)),v=await Promise.all(d),w=s.aggregateJudgeReports(v);return __arriePanelVerdict(i,w,u,v)',
  },
];

export function applyLockedJudgeLifecycle(source) {
  let output = source;
  for (const { label, from, to } of replacements) {
    if (output.includes(to)) continue;
    const count = output.split(from).length - 1;
    if (count !== 1) throw new Error(`Expected exactly one ${label} source fragment; found ${count}.`);
    output = output.replace(from, to);
  }
  return output;
}

if (resolve(process.argv[1] || '') === scriptPath) {
  if (process.argv.includes('--stdin')) {
    process.stdout.write(applyLockedJudgeLifecycle(readFileSync(0, 'utf8')));
  } else {
    const before = readFileSync(bundlePath, 'utf8');
    const output = applyLockedJudgeLifecycle(before);
    if (output !== before) writeFileSync(bundlePath, output);
    process.stdout.write(`${JSON.stringify({ pass: true, changed: output !== before, bundlePath })}\n`);
  }
}
