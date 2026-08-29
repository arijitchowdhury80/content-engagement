import { createAnswerHarnessObserver } from "./source/shared/widget/answer-harness-observer.mjs";
import {
  createAnswerContentContribution,
  createConfidenceContribution,
  createErrorRetryContribution,
  createOpaqueActionContribution,
  createProgressContribution,
  createSourcesContribution,
  createTelemetryContribution,
} from "./source/shared/widget/answer-contributors.mjs";
import { ANSWER_LIFECYCLE, ANSWER_SLOT_STATUS } from "./source/shared/core/answer-record.mjs";
import { splitAnswerContent } from "./source/shared/widget/answer-presentation.mjs";

function installAnswerHarnessRuntime(target = globalThis) {
  const existing = target.algoliaAnswerHarness;
  const harness = existing?.accept ? existing : createAnswerHarnessObserver();
  target.algoliaAnswerHarness = harness;
  target.algoliaAnswerContributors = Object.freeze({
    createAnswerContentContribution,
    createConfidenceContribution,
    createErrorRetryContribution,
    createOpaqueActionContribution,
    createProgressContribution,
    createSourcesContribution,
    createTelemetryContribution,
  });
  target.algoliaAnswerHarnessRuntime = Object.freeze({
    createAnswerHarnessObserver,
    splitAnswerContent,
    lifecycle: ANSWER_LIFECYCLE,
    slotStatus: ANSWER_SLOT_STATUS,
  });
  return harness;
}

installAnswerHarnessRuntime();

export { installAnswerHarnessRuntime };
