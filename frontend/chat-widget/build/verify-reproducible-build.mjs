import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const widgetRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(widgetRoot, '../..');
const output = join(widgetRoot, 'dist');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function preflight() {
  const sourceStatus = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).trim();

  if (sourceStatus.length > 0) {
    throw new Error('Release build refused: tracked source tree is dirty');
  }

  const repositoryPackage = readJson(join(repositoryRoot, 'package.json'));
  const widgetPackage = readJson(join(widgetRoot, 'package.json'));
  const sourceProvenance = readJson(join(widgetRoot, 'source', 'source-provenance.json'));
  if (!widgetPackage.version || repositoryPackage.version !== widgetPackage.version) {
    throw new Error('Release build refused: root and widget package versions must match');
  }
  if (!sourceProvenance.rollback?.originMainBaseline || !sourceProvenance.rollback?.uiCompatibilityCheckpoint) {
    throw new Error('Release build refused: source provenance must declare both rollback commits');
  }

  return {
    release: widgetPackage.version,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim(),
    rollback: sourceProvenance.rollback,
  };
}

const releaseSource = preflight();

if (process.argv.includes('--preflight-only')) {
  process.stdout.write(`${JSON.stringify(releaseSource)}\n`);
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'content-engagement-build-'));
const first = join(scratch, 'first');
const second = join(scratch, 'second');

function build(outDir) {
  execFileSync(
    resolve(widgetRoot, 'node_modules/.bin/vite'),
    ['build', '--outDir', outDir, '--emptyOutDir'],
    { cwd: widgetRoot, stdio: 'inherit' },
  );
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

try {
  build(first);
  build(second);

  const artifactName = 'content-engagement.js';
  const mapName = `${artifactName}.map`;
  const firstArtifact = join(first, artifactName);
  const secondArtifact = join(second, artifactName);
  const firstMap = join(first, mapName);
  const secondMap = join(second, mapName);

  const artifactHash = digest(firstArtifact);
  const secondArtifactHash = digest(secondArtifact);
  const mapHash = digest(firstMap);
  const secondMapHash = digest(secondMap);

  if (artifactHash !== secondArtifactHash || mapHash !== secondMapHash) {
    throw new Error('Non-reproducible build: clean build hashes differ');
  }

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const releaseStem = `content-engagement.${artifactHash.slice(0, 12)}`;
  const releaseArtifactName = `${releaseStem}.js`;
  const releaseMapName = `${releaseStem}.js.map`;
  cpSync(firstArtifact, join(output, releaseArtifactName));
  cpSync(firstMap, join(output, releaseMapName));
  // Temporary compatibility aliases. The content-addressed name above is the
  // authoritative release and the only name hosts should pin for 2.0.
  cpSync(firstArtifact, join(output, artifactName));
  cpSync(firstMap, join(output, mapName));

  const manifest = {
    schema: 'ContentEngagementReleaseManifest.v1',
    release: releaseSource.release,
    compatibilityContract: 'WidgetCompatibilityContract.v1',
    answerContract: 'AnswerRecord.v1',
    sourceCommit: releaseSource.sourceCommit,
    sourceTreeClean: true,
    entry: 'frontend/chat-widget/source/algolia-com/entry.ts',
    customerArtifact: releaseArtifactName,
    artifacts: [
      { file: releaseArtifactName, sha256: artifactHash, role: 'customer-javascript' },
      { file: releaseMapName, sha256: mapHash, role: 'source-map' },
    ],
    compatibilityAliases: [
      { file: artifactName, sha256: artifactHash, target: releaseArtifactName },
      { file: mapName, sha256: mapHash, target: releaseMapName },
    ],
    rollback: {
      baselineCommit: releaseSource.rollback.originMainBaseline,
      uiCompatibilityCheckpoint: releaseSource.rollback.uiCompatibilityCheckpoint,
    },
  };

  writeFileSync(join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
