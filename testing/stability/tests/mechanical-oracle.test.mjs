import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateMechanicalTurn } from '../src/oracle/mechanical.mjs';

const PASS = {
  userMessageCount: 1,
  terminalState: 'success',
  answerText: 'Grounded answer',
  physicalCompletionRequests: 1,
  completionSteps: 1,
  completionStepCeiling: 4,
  retryAttempts: 0,
  retryAttemptCeiling: 1,
  backgroundCompletionAttempts: 0,
};

test('mechanical oracle passes one bounded nonempty terminal turn', () => {
  assert.deepEqual(evaluateMechanicalTurn(PASS), { pass: true, failures: [], hardFailure: false });
});

test('mechanical oracle cannot hide blank, duplicate, leaked, or over-budget outcomes', () => {
  const result = evaluateMechanicalTurn({
    ...PASS,
    userMessageCount: 2,
    answerText: ' ',
    duplicateAnswer: true,
    crossUserCanary: true,
    unsafeRetry: true,
    completionSteps: 5,
    retryAttempts: 2,
    backgroundCompletionAttempts: 3,
  });
  assert.equal(result.pass, false);
  assert.equal(result.hardFailure, true);
  assert.deepEqual(new Set(result.failures), new Set([
    'duplicate-user-message', 'blank-success', 'cross-user-state', 'unsafe-retry', 'completion-step-budget', 'retry-budget', 'unexpected-background-completion', 'duplicate-answer',
  ]));
});
