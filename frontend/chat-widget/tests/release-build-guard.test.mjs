import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const widgetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardSource = path.join(widgetRoot, 'build', 'verify-reproducible-build.mjs');

function createFixture({ rootVersion = '2.0.0-test.1', widgetVersion = rootVersion } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'content-engagement-release-guard-'));
  const widget = path.join(root, 'frontend', 'chat-widget');
  mkdirSync(path.join(widget, 'build'), { recursive: true });
  mkdirSync(path.join(widget, 'source'), { recursive: true });
  cpSync(guardSource, path.join(widget, 'build', 'verify-reproducible-build.mjs'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: rootVersion }));
  writeFileSync(path.join(widget, 'package.json'), JSON.stringify({ version: widgetVersion }));
  writeFileSync(path.join(widget, 'source', 'source-provenance.json'), JSON.stringify({
    schema: 'ContentEngagementSourceProvenance.v1',
    rollback: {
      originMainBaseline: 'baseline-fixture',
      uiCompatibilityCheckpoint: 'compatibility-fixture',
    },
  }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'release-guard@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Release Guard'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return { root, widget };
}

function runPreflight(widget) {
  return spawnSync(
    process.execPath,
    ['build/verify-reproducible-build.mjs', '--preflight-only'],
    { cwd: widget, encoding: 'utf8' },
  );
}

test('release preflight derives release identity from matching package metadata', () => {
  const { widget } = createFixture();
  const result = runPreflight(widget);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).release, '2.0.0-test.1');
  assert.deepEqual(JSON.parse(result.stdout).rollback, {
    originMainBaseline: 'baseline-fixture',
    uiCompatibilityCheckpoint: 'compatibility-fixture',
  });
});

test('release preflight fails before building when tracked source is dirty', () => {
  const { root, widget } = createFixture();
  writeFileSync(
    path.join(root, 'package.json'),
    `${readFileSync(path.join(root, 'package.json'), 'utf8')}\n`,
  );
  const result = runPreflight(widget);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tracked source tree is dirty/);
});

test('release preflight rejects divergent root and widget versions', () => {
  const { widget } = createFixture({ widgetVersion: '2.0.0-test.2' });
  const result = runPreflight(widget);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package versions must match/);
});
