/**
 * Brand-neutral semantic answer renderer.
 *
 * The renderer owns placement only. Callers provide a presentation callback for
 * labels, markup, and visual treatment; contributors never place footer DOM.
 */

import {
  ANSWER_FOOTER_SLOT_ORDER,
  assertPresentationPart,
  assertPresentationState,
} from "../presentation-contract.mjs";

const TLDR_REGIONS = Object.freeze([
  ["answer-tldr-analogy", (viewModel) => viewModel.tldr?.analogy],
  ["answer-tldr-short", (viewModel) => viewModel.tldr?.short],
]);

const BODY_REGIONS = Object.freeze([
  ["answer-details", (viewModel) => viewModel.details],
]);

const FOOTER_PART_BY_SLOT = Object.freeze({
  sources: "answer-sources",
  telemetry: "answer-telemetry",
  actions: "answer-actions",
  confidence: "answer-confidence",
  followUp: "answer-follow-up",
});

function assertContainer(container) {
  if (!container?.ownerDocument?.createElement || typeof container.replaceChildren !== "function") {
    throw new TypeError("Answer renderer requires a DOM container.");
  }
}

function assertViewModel(viewModel) {
  if (!viewModel?.identityKey || !viewModel?.lifecycle) {
    throw new TypeError("Answer renderer requires a normalized answer view model.");
  }
}

function region(document, part, slot, renderSlot, viewModel) {
  if (!slot || typeof slot !== "object") {
    throw new TypeError(`Answer view model is missing ${part}.`);
  }

  const element = document.createElement("div");
  element.setAttribute("part", assertPresentationPart(part));
  element.setAttribute("data-state", assertPresentationState(slot.status));

  if (typeof renderSlot === "function") {
    renderSlot(element, slot, viewModel);
  } else if (typeof slot.value === "string") {
    element.textContent = slot.value;
  } else if (slot.message) {
    element.textContent = slot.message;
  }

  return element;
}

function hasRenderableSlot(slot) {
  return Boolean(slot && slot.status !== "empty" && slot.status !== "loading");
}

function aggregateTldrSlot(viewModel) {
  const analogy = viewModel.tldr?.analogy;
  const short = viewModel.tldr?.short;
  const status = hasRenderableSlot(analogy) || hasRenderableSlot(short)
    ? "ready"
    : analogy?.status || short?.status || "empty";
  return {
    key: "tldr",
    status,
    value: { analogy, short },
    message: status === "empty" ? "No TL;DR content provided." : "",
  };
}

function bodyOnlyContent(document, renderSlot, viewModel) {
  const fragment = [];
  const tldrSlot = aggregateTldrSlot(viewModel);
  const tldr = region(document, "answer-tldr", tldrSlot, renderSlot, viewModel);
  if (hasRenderableSlot(viewModel.tldr?.analogy) || hasRenderableSlot(viewModel.tldr?.short)) {
    fragment.push(tldr);
  }

  for (const [part, select] of BODY_REGIONS) {
    const slot = select(viewModel);
    if (hasRenderableSlot(slot)) {
      fragment.push(region(document, part, slot, renderSlot, viewModel));
    }
  }
  return fragment;
}

export function createAnswerBodyRenderer({ renderSlot = null } = {}) {
  return Object.freeze({
    render(container, viewModel) {
      assertContainer(container);
      assertViewModel(viewModel);

      container.setAttribute("part", assertPresentationPart("answer"));
      container.setAttribute("data-state", assertPresentationState(viewModel.lifecycle));
      container.setAttribute("data-answer-identity", viewModel.identityKey);
      container.replaceChildren(...bodyOnlyContent(container.ownerDocument, renderSlot, viewModel));
      return container;
    },
  });
}

export function createAnswerFooterRenderer({ renderSlot = null, shouldRenderSlot = null } = {}) {
  return Object.freeze({
    render(container, viewModel) {
      assertContainer(container);
      assertViewModel(viewModel);

      const document = container.ownerDocument;
      const footer = document.createElement("footer");
      footer.setAttribute("part", assertPresentationPart("answer-footer"));
      footer.setAttribute("data-answer-footer", viewModel.identityKey);
      footer.setAttribute("data-post-stream", String(Boolean(viewModel.footer?.postStream)));
      footer.setAttribute("data-order", ANSWER_FOOTER_SLOT_ORDER.join(" "));

      for (const slotKey of ANSWER_FOOTER_SLOT_ORDER) {
        if (typeof shouldRenderSlot === "function" && !shouldRenderSlot(slotKey, viewModel)) continue;
        const part = FOOTER_PART_BY_SLOT[slotKey];
        if (!part) continue;
        footer.append(region(document, part, viewModel.footer?.[slotKey], renderSlot, viewModel));
      }

      container.replaceChildren(footer);
      return footer;
    },
  });
}

export function createAnswerSlotRenderer({ slotKey, renderSlot = null } = {}) {
  const part = FOOTER_PART_BY_SLOT[slotKey];
  if (!part) throw new TypeError(`Unknown answer footer slot: ${slotKey}`);

  return Object.freeze({
    render(container, viewModel) {
      assertContainer(container);
      assertViewModel(viewModel);

      const slot = viewModel.footer?.[slotKey];
      container.setAttribute("data-answer-identity", viewModel.identityKey);
      container.replaceChildren(region(container.ownerDocument, part, slot, renderSlot, viewModel));
      return container;
    },
  });
}

export function createAnswerRenderer({ renderSlot = null } = {}) {
  return Object.freeze({
    render(container, viewModel) {
      assertContainer(container);
      assertViewModel(viewModel);

      const document = container.ownerDocument;
      const root = document.createElement("article");
      root.setAttribute("part", assertPresentationPart("answer"));
      root.setAttribute("data-state", assertPresentationState(viewModel.lifecycle));
      root.setAttribute("data-answer-identity", viewModel.identityKey);

      const tldr = document.createElement("section");
      tldr.setAttribute("part", assertPresentationPart("answer-tldr"));
      for (const [part, select] of TLDR_REGIONS) {
        tldr.append(region(document, part, select(viewModel), renderSlot, viewModel));
      }
      root.append(tldr);

      for (const [part, select] of BODY_REGIONS) {
        root.append(region(document, part, select(viewModel), renderSlot, viewModel));
      }

      const footer = document.createElement("footer");
      footer.setAttribute("part", assertPresentationPart("answer-footer"));
      footer.setAttribute("data-answer-footer", viewModel.identityKey);
      footer.setAttribute("data-post-stream", String(Boolean(viewModel.footer?.postStream)));
      footer.setAttribute("data-order", ANSWER_FOOTER_SLOT_ORDER.join(" "));
      for (const slotKey of ANSWER_FOOTER_SLOT_ORDER) {
        const part = FOOTER_PART_BY_SLOT[slotKey];
        if (!part) continue;
        footer.append(region(document, part, viewModel.footer?.[slotKey], renderSlot, viewModel));
      }
      root.append(footer);

      root.append(region(document, "answer-progress", viewModel.progress, renderSlot, viewModel));
      root.append(region(document, "answer-error-retry", viewModel.errorRetry, renderSlot, viewModel));

      container.replaceChildren(root);
      return root;
    },
  });
}
