import test from "node:test";
import assert from "node:assert/strict";

import { ANSWER_LIFECYCLE } from "../source/shared/core/answer-record.mjs";
import {
  createPresentationFromAnswerText,
  toAnswerPresentation,
} from "../source/shared/widget/answer-presentation.mjs";
import { createAnswerRenderer } from "../source/shared/widget/answer-renderer.mjs";

const identity = Object.freeze({
  widgetInstanceId: "widget-1",
  conversationId: "conversation-1",
  answerSegmentId: "segment-1",
  networkAttemptId: "attempt-1",
});

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  querySelectorAllByPart(part, output = []) {
    if (this.getAttribute("part") === part) output.push(this);
    for (const child of this.children) child.querySelectorAllByPart(part, output);
    return output;
  }
}

function fakeDocument() {
  const doc = {
    createElement(tagName) {
      return new FakeElement(tagName, doc);
    },
  };
  return doc;
}

function fakeContainer() {
  const doc = fakeDocument();
  return new FakeElement("div", doc);
}

test("shared renderer owns one semantic placement for every answer slot", () => {
  const record = createPresentationFromAnswerText({
    identity,
    text: [
      "API calls are like little door swings at a busy store.",
      "",
      "Short version: most data-requesting interactions count.",
      "",
      "Debounce typing and protect shared backend traffic.",
      "",
      "Are you protecting against bots or normal browsing?",
    ].join("\n"),
    sources: [{ title: "Docs" }],
    telemetry: { inputTokens: 12345, outputTokens: 678 },
    compareAction: { label: "Compare with Prod" },
    confidence: { score: 8.3 },
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
  });
  const presentation = toAnswerPresentation(record);
  const container = fakeContainer();
  const renderedParts = [];
  const renderer = createAnswerRenderer({
    renderSlot(element, slot) {
      renderedParts.push(element.getAttribute("part"));
      element.textContent = slot.message || (typeof slot.value === "string" ? slot.value : "");
    },
  });

  const root = renderer.render(container, presentation);

  assert.equal(container.children[0], root);
  assert.equal(root.getAttribute("part"), "answer");
  assert.equal(root.getAttribute("data-answer-identity"), presentation.identityKey);
  assert.deepEqual(renderedParts, [
    "answer-tldr-analogy",
    "answer-tldr-short",
    "answer-details",
    "answer-sources",
    "answer-telemetry",
    "answer-compare-action",
    "answer-confidence",
    "answer-follow-up",
    "answer-progress",
    "answer-error-retry",
  ]);

  const footers = root.querySelectorAllByPart("answer-footer");
  assert.equal(footers.length, 1);
  assert.equal(
    footers[0].getAttribute("data-order"),
    "sources telemetry compareAction confidence followUp"
  );
  assert.equal(footers[0].getAttribute("data-post-stream"), "true");
});

test("shared renderer defers post-answer footer regions while streaming", () => {
  const record = createPresentationFromAnswerText({
    identity,
    text: [
      "Search implementation is like setting up checkout lanes.",
      "",
      "Short version: start simple, then scale the controls.",
      "",
      "Use the docs to confirm the exact integration path.",
    ].join("\n"),
    sources: [{ title: "Docs" }],
    telemetry: { inputTokens: 1200, outputTokens: 40 },
    compareAction: { label: "Compare with Prod" },
    confidence: { score: 8 },
    lifecycle: ANSWER_LIFECYCLE.STREAMING,
  });
  const container = fakeContainer();
  const renderer = createAnswerRenderer();
  const root = renderer.render(container, toAnswerPresentation(record));

  assert.equal(root.querySelectorAllByPart("answer-sources")[0].getAttribute("data-state"), "ready");
  assert.equal(root.querySelectorAllByPart("answer-telemetry")[0].getAttribute("data-state"), "loading");
  assert.equal(root.querySelectorAllByPart("answer-compare-action")[0].getAttribute("data-state"), "loading");
  assert.equal(root.querySelectorAllByPart("answer-confidence")[0].getAttribute("data-state"), "loading");
  assert.equal(root.querySelectorAllByPart("answer-follow-up")[0].getAttribute("data-state"), "empty");
});

test("shared renderer ignores caller-supplied footer order and uses the canonical order", () => {
  const record = createPresentationFromAnswerText({
    identity,
    text: [
      "Search implementation is like setting up checkout lanes.",
      "",
      "Short version: start simple, then scale the controls.",
      "",
      "Use the docs to confirm the exact integration path.",
    ].join("\n"),
    sources: [{ title: "Docs" }],
    telemetry: { inputTokens: 1200, outputTokens: 40 },
    compareAction: { label: "Compare with Prod" },
    confidence: { score: 8 },
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
  });
  const presentation = toAnswerPresentation(record);
  const spoofed = {
    ...presentation,
    footer: {
      ...presentation.footer,
      order: ["confidence", "followUp", "sources"],
    },
  };
  const container = fakeContainer();
  const renderedParts = [];
  const renderer = createAnswerRenderer({
    renderSlot(element) {
      renderedParts.push(element.getAttribute("part"));
    },
  });

  const root = renderer.render(container, spoofed);

  assert.equal(
    root.querySelectorAllByPart("answer-footer")[0].getAttribute("data-order"),
    "sources telemetry compareAction confidence followUp"
  );
  assert.deepEqual(renderedParts.slice(3, 8), [
    "answer-sources",
    "answer-telemetry",
    "answer-compare-action",
    "answer-confidence",
    "answer-follow-up",
  ]);
});
