import test from "node:test";
import assert from "node:assert/strict";

import { ANSWER_LIFECYCLE } from "../source/shared/core/answer-record.mjs";
import {
  createPresentationFromAnswerText,
  toAnswerPresentation,
} from "../source/shared/widget/answer-presentation.mjs";
import {
  createAnswerBodyRenderer,
  createAnswerRenderer,
  createAnswerSlotRenderer,
} from "../source/shared/widget/answer-renderer.mjs";
import {
  configureAlgoliaAnswerFooterLayout,
  createAlgoliaAnswerFooterContainer,
} from "../source/algolia-com/web-component/answer-slot-view.mjs";

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
    this.style = {};
    this.className = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  append(...children) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
  }

  replaceChildren(...children) {
    for (const child of children) child.parentElement = this;
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

test("Algolia post-answer controls remain on one row", () => {
  const document = fakeDocument();
  const hostFooter = document.createElement("div");
  const sourceRegion = document.createElement("div");
  const sourceContainer = document.createElement("div");
  const confidence = document.createElement("algolia-confidence-badge");
  const controlsContainer = createAlgoliaAnswerFooterContainer(document);
  const footer = document.createElement("footer");
  const telemetry = document.createElement("div");
  const compare = document.createElement("div");
  sourceRegion.append(sourceContainer);
  footer.append(telemetry, compare);
  controlsContainer.append(footer);
  hostFooter.append(sourceRegion, confidence, controlsContainer);

  configureAlgoliaAnswerFooterLayout({
    hostFooter,
    sourceContainer,
    controlsContainer,
    controlsFooter: footer,
    confidenceControl: confidence,
  });

  assert.equal(footer.style.display, "flex");
  assert.equal(footer.style.flexWrap, "nowrap");
  assert.equal(telemetry.style.flexShrink, "0");
  assert.equal(compare.style.flexShrink, "0");
  assert.equal(sourceRegion.style.flex, "1 1 auto");
  assert.equal(controlsContainer.style.order, "2");
  assert.equal(confidence.parentElement, hostFooter);
  assert.equal(confidence.style.order, "3");
  assert.equal(hostFooter.style.columnGap, "8px");
});

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
    actions: { label: "Compare with Prod" },
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
    "answer-actions",
    "answer-confidence",
    "answer-follow-up",
    "answer-progress",
    "answer-error-retry",
  ]);

  const footers = root.querySelectorAllByPart("answer-footer");
  assert.equal(footers.length, 1);
  assert.equal(
    footers[0].getAttribute("data-order"),
    "sources telemetry actions confidence followUp"
  );
  assert.equal(footers[0].getAttribute("data-post-stream"), "true");
});

test("shared body renderer owns TLDR and Details without footer placement", () => {
  const record = createPresentationFromAnswerText({
    identity,
    text: [
      "API calls are like little door swings at a busy store.",
      "",
      "Short version: most data-requesting interactions count.",
      "",
      "Debounce typing and protect shared backend traffic.",
    ].join("\n"),
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
  });
  const presentation = toAnswerPresentation(record);
  const container = fakeContainer();
  const renderedParts = [];
  const renderer = createAnswerBodyRenderer({
    renderSlot(element, slot) {
      renderedParts.push(element.getAttribute("part"));
      element.textContent = slot.message || (typeof slot.value === "string" ? slot.value : "");
    },
  });

  const root = renderer.render(container, presentation);

  assert.equal(root, container);
  assert.equal(container.getAttribute("part"), "answer");
  assert.equal(container.getAttribute("data-answer-identity"), presentation.identityKey);
  assert.deepEqual(renderedParts, ["answer-tldr", "answer-details"]);
  assert.equal(container.querySelectorAllByPart("answer-footer").length, 0);
  assert.equal(container.querySelectorAllByPart("answer-progress").length, 0);
});

test("shared slot renderer can place one footer slot without rendering siblings", () => {
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
    actions: { label: "Compare with Prod" },
    lifecycle: ANSWER_LIFECYCLE.COMPLETE,
  });
  const presentation = toAnswerPresentation(record);
  const container = fakeContainer();
  const renderedParts = [];
  const renderer = createAnswerSlotRenderer({
    slotKey: "sources",
    renderSlot(element, slot) {
      renderedParts.push(element.getAttribute("part"));
      element.textContent = slot.status;
    },
  });

  renderer.render(container, presentation);

  assert.equal(container.getAttribute("data-answer-identity"), presentation.identityKey);
  assert.deepEqual(renderedParts, ["answer-sources"]);
  assert.equal(container.querySelectorAllByPart("answer-sources").length, 1);
  assert.equal(container.querySelectorAllByPart("answer-actions").length, 0);
  assert.equal(container.querySelectorAllByPart("answer-footer").length, 0);
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
    actions: { label: "Compare with Prod" },
    confidence: { score: 8 },
    lifecycle: ANSWER_LIFECYCLE.STREAMING,
  });
  const container = fakeContainer();
  const renderer = createAnswerRenderer();
  const root = renderer.render(container, toAnswerPresentation(record));

  assert.equal(root.querySelectorAllByPart("answer-sources")[0].getAttribute("data-state"), "ready");
  assert.equal(root.querySelectorAllByPart("answer-telemetry")[0].getAttribute("data-state"), "loading");
  assert.equal(root.querySelectorAllByPart("answer-actions")[0].getAttribute("data-state"), "loading");
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
    actions: { label: "Compare with Prod" },
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
    "sources telemetry actions confidence followUp"
  );
  assert.deepEqual(renderedParts.slice(3, 8), [
    "answer-sources",
    "answer-telemetry",
    "answer-actions",
    "answer-confidence",
    "answer-follow-up",
  ]);
});
