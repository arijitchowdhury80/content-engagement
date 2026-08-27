import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('judge availability has exactly one runtime owner', async () => {
  const [bundle, compare, deployer, sharedWriter] = await Promise.all([
    read('frontend/chat-widget/algolia-chat.js'),
    read('frontend/chat-widget/algolia-chat-compare.js'),
    read('tools/deployment/deploy_judge_v2_jahia.py'),
    read('tools/deployment/deploy_jahia_engagement_tracker.py'),
  ]);

  assert.match(bundle, /static get observedAttributes\(\)\{return\["agents"\]\}get judgeMode\(\)\{return"algolia"\}/);
  assert.doesNotMatch(bundle, /getAttribute\("mode"\)==="off"/);
  assert.doesNotMatch(compare, /algolia-chat-confidence|setJudgeMode|setAttribute\(["']mode["']/);
  assert.match(deployer, /re\.sub\(r'\\smode="\[\^"\]\*"', "", attrs\)\.rstrip\(\)/);
  assert.doesNotMatch(deployer, /attrs \+= ['"] mode=/);
  assert.match(sharedWriter, /judge_release_guard\.validate_block_html\(html\)/);
});

test('all three roles run in parallel and retry only their own invalid report', async () => {
  const bundle = await read('frontend/chat-widget/algolia-chat.js');
  assert.match(bundle, /for\(let w=1;w<=2&&!s\.aborted;w\+\+\)/);
  assert.match(bundle, /phase:"retrying",role:i,attempt:w/);
  assert.match(bundle, /s\.ROLES\.map\(g=>__arrieRunRoleJudge/);
  assert.match(bundle, /Promise\.all\(d\)/);
  assert.doesNotMatch(bundle, /Judge panel deadline exceeded/);
});

test('obsolete confidence-mode deployment switch cannot return', async () => {
  await assert.rejects(
    access(resolve(root, 'tools/deployment/deploy_jahia_confidence_mode.py'), constants.F_OK),
    { code: 'ENOENT' },
  );
});
