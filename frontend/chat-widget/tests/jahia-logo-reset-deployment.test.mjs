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

function transformProactiveRuntime(html) {
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    "spec = importlib.util.spec_from_file_location('deploy', path)",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.update_proactive_runtime_block_html(sys.stdin.read()), end="")',
  ].join('; ');

  return execFileSync('python3', ['-c', program, deploymentScript.pathname], {
    input: html,
    encoding: 'utf8',
  });
}

function transformChatOnly(html) {
  const program = [
    'import importlib.util, pathlib, sys',
    'path = pathlib.Path(sys.argv[1])',
    "spec = importlib.util.spec_from_file_location('deploy', path)",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module.update_chat_block_html(sys.stdin.read()), end="")',
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

test('chat-only deployment publishes the Drift subtree so LIVE block cache markers move', () => {
  const source = readFileSync(deploymentScript, 'utf8');
  const chatOnly = source.slice(
    source.indexOf('def run_chat_only('),
    source.indexOf('def validate_judge_runtime_only('),
  );

  assert.match(chatOnly, /"publishDriftSubtree": publish\("\/sites\/www\/home\/drift", subtree=True\)/);
  assert.match(chatOnly, /"publishBlock": publish\(BLOCK_PATH, subtree=True\)/);
  assert.match(chatOnly, /republishDriftSubtreeAfterStaleLiveReadback/);
  assert.match(chatOnly, /republishBlockAfterStaleLiveReadback/);
});

test('chat-only deployment removes obsolete immutable stability bundle before cache-busting canonical chat', () => {
  const transformed = transformChatOnly([
    '<div class="algolia-chat-embed" data-chat-release="old">',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-stability-faba95a8a5a9.js"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat.js?chat=old"></script>',
    '</div>',
  ].join('\n'));

  assert.doesNotMatch(transformed, /algolia-chat-stability-[a-f0-9]{12}\.js/);
  assert.equal((transformed.match(/algolia-chat\.js/g) || []).length, 1);
  assert.match(transformed, /algolia-chat\.js\?chat=20260825-stability-a/);
});

test('proactive-runtime-only deployment changes only controller and handoff references', () => {
  const source = readFileSync(deploymentScript, 'utf8');
  const versionMatch = source.match(/^PROACTIVE_RUNTIME_ONLY_VERSION = "([^"]+)"/m);
  assert.ok(versionMatch, 'deployment script should declare a proactive runtime version');
  const version = versionMatch[1];
  const original = [
    '<div class="algolia-chat-embed" data-chat-release="keep">',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat.js?chat=keep"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-engagement-tracker.js?tracker=keep"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-context-compiler.js?context=keep"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-proactive-controller.js?proactive=old"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/handoff-to-orchestrator.js?handoff=old"></script>',
    '<script src="https://tmp-content-eng-algolia.cloud.jahia.com/files/live/sites/www/files/algolia-chat-engage.js?engage=keep"></script>',
    '</div>',
  ].join('\n');

  const transformed = transformProactiveRuntime(original);

  assert.match(transformed, new RegExp(`proactive=${version}`));
  assert.match(transformed, /handoff-to-orchestrator-compare-[a-f0-9]{12}\.js/);
  assert.match(transformed, new RegExp(`data-proactive-runtime-release="${version}"`));
  for (const unchanged of ['chat=keep', 'tracker=keep', 'context=keep', 'engage=keep']) {
    assert.match(transformed, new RegExp(unchanged));
  }
});

test('proactive-runtime-only CLI and mutation allowlist exclude unrelated runtime files', () => {
  const source = readFileSync(deploymentScript, 'utf8');
  const proactiveRuntimeOnly = source.slice(
    source.indexOf('def proactive_runtime_only_plan('),
    source.indexOf('def validate_chat_only('),
  );

  assert.match(source, /"--proactive-runtime-only"/);
  assert.match(source, /return run_proactive_runtime_only\(args\.apply\)/);
  assert.match(proactiveRuntimeOnly, /"runtimeFiles": \[CHAT, NEW_TRACKER, CONTEXT_COMPILER, ENGAGE\]/);
  assert.match(proactiveRuntimeOnly, /"subtrees": \[FILES_PATH, "\/sites\/www\/home\/drift"\]/);
  assert.match(proactiveRuntimeOnly, /"operation": "publish", "path": BLOCK_PATH, "subtree": True/);
  assert.match(proactiveRuntimeOnly, /"publishBlock": publish\(BLOCK_PATH, subtree=True\)/);
});
