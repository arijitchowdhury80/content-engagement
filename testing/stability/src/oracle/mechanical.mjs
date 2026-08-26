const HARD_FAILURES = new Set([
  'wrong-target', 'production-request', 'duplicate-user-message', 'unbounded', 'blank-success',
  'duplicate-answer', 'duplicate-side-effect', 'stream-disappearance', 'transcript-reorder',
  'page-crash', 'observer-loss', 'unsafe-retry', 'attempt-budget', 'cross-user-state',
  'completion-step-budget', 'retry-budget',
  'reset-contract', 'navigation-contract',
  'unexpected-background-completion',
  'terminal-error',
]);

export function evaluateMechanicalTurn(observation) {
  const failures = [];
  if (observation.userMessageCount !== 1) failures.push('duplicate-user-message');
  if (!['success', 'error'].includes(observation.terminalState)) failures.push('unbounded');
  if (observation.terminalState === 'error') failures.push('terminal-error');
  if (observation.terminalState === 'success' && !String(observation.answerText ?? '').trim()) failures.push('blank-success');
  if (observation.pageCrashed) failures.push('page-crash');
  if (observation.observerLost) failures.push('observer-loss');
  if (observation.crossUserCanary) failures.push('cross-user-state');
  if (observation.unsafeRetry) failures.push('unsafe-retry');
  if (observation.completionSteps > observation.completionStepCeiling) failures.push('completion-step-budget');
  if (observation.retryAttempts > observation.retryAttemptCeiling) failures.push('retry-budget');
  if ((observation.backgroundCompletionAttempts ?? 0) > (observation.backgroundCompletionCeiling ?? 0)) failures.push('unexpected-background-completion');
  if (observation.duplicateAnswer) failures.push('duplicate-answer');
  return {
    pass: failures.length === 0,
    failures,
    hardFailure: failures.some((failure) => HARD_FAILURES.has(failure)),
  };
}
