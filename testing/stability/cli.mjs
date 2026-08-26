#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdaptiveDiscoveryDataset, loadFrozenDataset, validateAdaptiveDiscoveryDataset, validateReactiveDataset } from './src/contracts/validate.mjs';
import { qualifyFixture } from './src/fixture/qualify.mjs';
import { calibrateHost } from './src/scheduler/calibrate-host.mjs';
import { inspectRuntimeIdentity } from './src/preflight/runtime-identity.mjs';
import { createOperatorAgentFetcher } from './src/preflight/operator-agent-client.mjs';
import { writePrivateFile } from './src/config/artifact-paths.mjs';
import { runPhase0Smoke } from './src/hosted/phase0-smoke.mjs';
import { runOneUserBaseline } from './src/hosted/one-user-baseline.mjs';
import { runAdaptiveDiscovery } from './src/hosted/adaptive-discovery.mjs';

function usage() {
  return `Usage:
  node testing/stability/cli.mjs validate-dataset --dataset <path>
  node testing/stability/cli.mjs validate-adaptive-dataset --dataset <path>
  node testing/stability/cli.mjs qualify-fixture --out <safe-raw-directory>
  node testing/stability/cli.mjs calibrate-host --contexts 1,2,5 --out <safe-raw-directory>
  node testing/stability/cli.mjs preflight --out <safe-raw-directory>
  node testing/stability/cli.mjs phase0-smoke --repetitions 20 --out <safe-raw-directory>
  node testing/stability/cli.mjs one-user-baseline --campaign U5-C1 --out <safe-raw-directory>
  node testing/stability/cli.mjs adaptive-discovery --campaign U2-AD1 --out <safe-raw-directory>

Pressure, fault-injection, and soak commands remain unavailable until the lower envelope passes.`;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} is required`);
  return args[index + 1];
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (command === 'validate-dataset') {
    const datasetPath = path.resolve(option(args, '--dataset'));
    const dataset = loadFrozenDataset(datasetPath);
    const result = validateReactiveDataset(dataset);
    process.stdout.write(`${JSON.stringify({ status: 'PASS', dataset: datasetPath, ...result })}\n`);
    return 0;
  }
  if (command === 'validate-adaptive-dataset') {
    const datasetPath = path.resolve(option(args, '--dataset'));
    const dataset = loadAdaptiveDiscoveryDataset(datasetPath);
    const result = validateAdaptiveDiscoveryDataset(dataset);
    process.stdout.write(`${JSON.stringify({ status: 'PASS', dataset: datasetPath, ...result })}\n`);
    return 0;
  }
  if (command === 'qualify-fixture') {
    const result = await qualifyFixture({ rawRoot: path.resolve(option(args, '--out')) });
    process.stdout.write(`${JSON.stringify({ status: result.pass ? 'PASS' : 'FAIL', summaryPath: result.summaryPath, results: result.results })}\n`);
    return result.pass ? 0 : 1;
  }
  if (command === 'calibrate-host') {
    const contexts = option(args, '--contexts').split(',').map((value) => Number.parseInt(value, 10));
    const result = await calibrateHost({ rawRoot: path.resolve(option(args, '--out')), contexts });
    process.stdout.write(`${JSON.stringify({ status: result.pass ? 'PASS' : 'RUN_INVALID', summaryPath: result.summaryPath, levels: result.levels })}\n`);
    return result.pass ? 0 : 1;
  }
  if (command === 'preflight') {
    const rawRoot = path.resolve(option(args, '--out'));
    const result = await inspectRuntimeIdentity({ fetchAgent: createOperatorAgentFetcher() });
    const identityPath = writePrivateFile(rawRoot, 'preflight/runtime-identity.json', `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: result.pass ? 'PASS' : 'RUN_BLOCKED_TARGET_IDENTITY', identityPath, jahiaIndex: result.jahia.indexName, browserIndex: result.browser.identity.indexName, agentStudioPass: result.agentStudio.pass, assetCount: result.assets.length })}\n`);
    return result.pass ? 0 : 1;
  }
  if (command === 'phase0-smoke') {
    const rawRoot = path.resolve(option(args, '--out'));
    const repetitions = Number.parseInt(option(args, '--repetitions'), 10);
    const result = await runPhase0Smoke({ rawRoot, repetitions });
    process.stdout.write(`${JSON.stringify({ status: result.pass ? 'PASS' : 'FAIL', summaryPath: result.summaryPath, journeysPassed: result.journeysPassed, repetitionsCompleted: result.repetitionsCompleted, turnsPassed: result.turnsPassed })}\n`);
    return result.pass ? 0 : 1;
  }
  if (command === 'one-user-baseline') {
    const rawRoot = path.resolve(option(args, '--out'));
    const campaignIds = option(args, '--campaign').split(',').map((value) => value.trim()).filter(Boolean);
    const result = await runOneUserBaseline({ rawRoot, campaignIds });
    process.stdout.write(`${JSON.stringify({ status: result.pass ? 'PASS' : 'FAIL', summaryPath: result.summaryPath, campaignIds, turnsCompleted: result.turnsCompleted })}\n`);
    return result.pass ? 0 : 1;
  }
  if (command === 'adaptive-discovery') {
    const rawRoot = path.resolve(option(args, '--out'));
    const campaignId = option(args, '--campaign');
    const result = await runAdaptiveDiscovery({ rawRoot, campaignId });
    process.stdout.write(`${JSON.stringify({ status: result.pass ? 'PASS' : 'FAIL', summaryPath: result.summaryPath, campaignId, turnsCompleted: result.turnsCompleted, discoveryPass: result.discoveryPass })}\n`);
    return result.pass ? 0 : 1;
  }
  throw new Error(`Unsupported command: ${command}`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
