import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const deploymentScript = new URL(
  '../../../tools/deployment/deploy_jahia_engagement_tracker.py',
  import.meta.url,
);

function deploymentRelease() {
  const source = readFileSync(deploymentScript, 'utf8');
  const match = source.match(/^RUNTIME_VERSION = "([^"]+)"/m);
  assert.ok(match, 'deployment script should declare one RUNTIME_VERSION');
  return match[1];
}

function transform(html) {
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    "spec = importlib.util.spec_from_file_location('deploy', path)",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.update_block_html(sys.stdin.read()), end="")',
  ].join('; ');

  return execFileSync('python3', ['-c', program, deploymentScript.pathname], {
    input: html,
    encoding: 'utf8',
  });
}

test('Jahia transform enables Assistant logo visitor reset exactly once', () => {
  const html = [
    '<div data-release="test">',
    '  <algolia-chat theme="algolia">',
    '    <algolia-agent role="primary"></algolia-agent>',
    '  </algolia-chat>',
    '  <script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-engagement-tracker.js?tracker=old"></script>',
    '</div>',
  ].join('\n');

  const once = transform(html);
  const twice = transform(once);

  assert.match(once, /<algolia-chat\b[^>]*\breset-visitor-state-on-logo\b/);
  assert.equal((twice.match(/reset-visitor-state-on-logo/g) || []).length, 1);
});

test('Jahia transform cache-busts every changed engagement runtime as one release', () => {
  const release = deploymentRelease();
  const transformed = transform([
    '<algolia-chat></algolia-chat>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-engagement-tracker.js?tracker=old"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-context-compiler.js?context=old"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-proactive-controller.js?proactive=old"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/handoff-to-orchestrator.js?handoff=old"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-engage.js?engage=old"></script>',
  ].join('\n'));

  for (const asset of ['chat', 'tracker', 'context', 'proactive', 'handoff', 'engage']) {
    assert.match(transformed, new RegExp(`${asset}=${release}`));
  }
});

test('narrow Jahia deployment publishes the tracker content subtree', () => {
  const source = readFileSync(deploymentScript, 'utf8');

  assert.match(source, /"publishNewTracker": publish\(NEW_TRACKER, subtree=True\)/);
  assert.match(source, /"liveTrackerMatchesSource"/);
});
