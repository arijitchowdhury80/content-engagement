import { createAnswerHarnessObserver } from "./source/shared/widget/answer-harness-observer.mjs";
import {
  createConfidenceContribution,
  createErrorRetryContribution,
  createOpaqueActionContribution,
  createProgressContribution,
  createSourcesContribution,
  createTelemetryContribution,
} from "./source/shared/widget/answer-contributors.mjs";
import { ANSWER_LIFECYCLE, ANSWER_SLOT_STATUS } from "./source/shared/core/answer-record.mjs";
import {
  createAlgoliaAnswerContentContribution,
  normalizeAlgoliaAnswerContent,
} from "./source/algolia-com/code/answer-content-normalizer.mjs";

function installAnswerHarnessRuntime(target = globalThis) {
  const existing = target.algoliaAnswerHarness;
  const harness = existing?.accept ? existing : createAnswerHarnessObserver();
  target.algoliaAnswerHarness = harness;
  target.algoliaAnswerContributors = Object.freeze({
    createAnswerContentContribution: createAlgoliaAnswerContentContribution,
    createConfidenceContribution,
    createErrorRetryContribution,
    createOpaqueActionContribution,
    createProgressContribution,
    createSourcesContribution,
    createTelemetryContribution,
  });
  target.algoliaAnswerHarnessRuntime = Object.freeze({
    createAnswerHarnessObserver,
    normalizeAnswerContent: normalizeAlgoliaAnswerContent,
    lifecycle: ANSWER_LIFECYCLE,
    slotStatus: ANSWER_SLOT_STATUS,
  });
  return harness;
}

installAnswerHarnessRuntime();

export { installAnswerHarnessRuntime };
