import { createAnswerHarnessObserver } from "../../shared/widget/answer-harness-observer.mjs";
import {
  createConfidenceContribution,
  createErrorRetryContribution,
  createOpaqueActionContribution,
  createProgressContribution,
  createSourcesContribution,
  createTelemetryContribution,
} from "../../shared/widget/answer-contributors.mjs";
import {
  ANSWER_LIFECYCLE,
  ANSWER_SLOT_STATUS,
  answerIdentityKey,
} from "../../shared/core/answer-record.mjs";
import { toAnswerPresentation } from "../../shared/widget/answer-presentation.mjs";
import {
  createAnswerBodyRenderer,
  createAnswerFooterRenderer,
  createAnswerSlotRenderer,
} from "../../shared/widget/answer-renderer.mjs";
import {
  createAlgoliaAnswerContentContribution,
  normalizeAlgoliaAnswerContent,
} from "../code/answer-content-normalizer.mjs";
import { createAlgoliaConfidenceContribution } from "../code/answer-confidence-normalizer.mjs";
import {
  createAlgoliaSourceGroups,
  sourcePresentationSignature,
} from "../code/answer-source-presentation-model.mjs";
import {
  configureAlgoliaAnswerFooterLayout,
  createAlgoliaAnswerBodyContainer,
  createAlgoliaAnswerFooterContainer,
  renderAlgoliaAnswerBodySlot,
  renderAlgoliaAnswerFooterSlot,
} from "./answer-slot-view.mjs";

const MIGRATED_FOOTER_SLOTS = new Set(["telemetry", "actions"]);
const MIGRATED_WIDGET_SLOTS = new Set(["sources", "telemetry", "actions", "followUp"]);
const MAX_LOCAL_BRIDGE_RECORDS = 200;

function detailIdentityKey(detail) {
  try {
    return detail?.answerIdentity ? answerIdentityKey(detail.answerIdentity) : "";
  } catch {
    return "";
  }
}

function detailSegmentKey(detail) {
  const identity = detail?.answerIdentity || detail;
  const parts = [
    identity?.widgetInstanceId,
    identity?.conversationId,
    identity?.answerSegmentId,
  ].map((value) => String(value || "").trim());
  return parts.every(Boolean) ? parts.map(encodeURIComponent).join(":") : "";
}

function isClosedLifecycle(lifecycle) {
  return lifecycle === ANSWER_LIFECYCLE.SUPERSEDED ||
    lifecycle === ANSWER_LIFECYCLE.RESET ||
    lifecycle === ANSWER_LIFECYCLE.DISCONNECTED;
}

function createLocalFooterBridge(target) {
  const recordsByKey = new Map();
  const placementsByKey = new Map();
  const placementsBySegment = new Map();
  const latestRecordKeyBySegment = new Map();
  const lastFooterByKey = new Map();
  const relocationObserversByKey = new Map();
  const confidenceObserversByKey = new Map();
  const unsupportedTermsByKey = new Map();
  const renderFooterSlot = (element, slot, viewModel) => renderAlgoliaAnswerFooterSlot(
    element,
    slot,
    viewModel,
    { sourceGroups: createAlgoliaSourceGroups(slot?.value) },
  );
  const bodyRenderer = createAnswerBodyRenderer({
    renderSlot: (element, slot, viewModel) => renderAlgoliaAnswerBodySlot(element, slot, viewModel, {
      unsupportedTerms: unsupportedTermsByKey.get(viewModel.identityKey) || [],
    }),
  });
  const renderer = createAnswerFooterRenderer({
    renderSlot: renderFooterSlot,
    shouldRenderSlot: (slotKey) => MIGRATED_FOOTER_SLOTS.has(slotKey),
  });
  const sourceRenderer = createAnswerSlotRenderer({
    slotKey: "sources",
    renderSlot: renderFooterSlot,
  });
  const followUpRenderer = createAnswerSlotRenderer({
    slotKey: "followUp",
    renderSlot: renderFooterSlot,
  });

  function enabled() {
    return target.ALGOLIA_ANSWER_RENDERER_AUTHORITY === true;
  }

  function containerForFooter(footer) {
    if (!footer?.ownerDocument) return null;
    let container = footer.querySelector?.(":scope > [data-algolia-rendered-answer-footer]") || null;
    if (!container) {
      container = createAlgoliaAnswerFooterContainer(footer.ownerDocument);
      footer.appendChild(container);
    }
    return container;
  }

  function sourceContainerForFooter(footer) {
    if (!footer?.ownerDocument) return null;
    let container = footer.querySelector?.(":scope > [data-algolia-rendered-answer-sources]") || null;
    if (container) return container;
    const children = [...(footer.children || [])];
    const sourceSlot = children.find((node) => {
      const classes = new Set(String(node.className || "").split(/\s+/));
      return classes.has("min-w-0") && classes.has("flex-1");
    }) || null;
    container = footer.ownerDocument.createElement("div");
    container.setAttribute("data-algolia-rendered-answer-sources", "true");
    container.className = "min-w-0 flex-1";
    if (sourceSlot) {
      sourceSlot.replaceChildren(container);
    } else {
      footer.insertBefore(container, footer.firstChild);
    }
    return container;
  }

  function followUpContainerForFooter(footer, placement) {
    const card = footer?.parentElement;
    if (!card?.ownerDocument) return null;
    const messageId = String(placement?.messageId || "");
    let container = card.querySelector?.(
      `:scope > [data-algolia-rendered-answer-follow-up][data-algolia-answer-message-id="${CSS.escape(messageId)}"]`
    ) || null;
    if (!container) {
      container = card.ownerDocument.createElement("div");
      container.setAttribute("data-algolia-rendered-answer-follow-up", "true");
      container.dataset.algoliaAnswerMessageId = messageId;
      container.addEventListener("click", (event) => {
        const button = event.target?.closest?.("button[data-algolia-follow-up]");
        const question = String(button?.dataset?.algoliaFollowUp || "").trim();
        if (!question) return;
        try {
          target.navigator?.clipboard?.writeText?.(question)?.catch?.(() => {});
        } catch {
          // Copy feedback is best effort; asking the follow-up is authoritative.
        }
        const host = container.getRootNode?.()?.host;
        if (typeof host?.ask === "function") host.ask(question);
      });
    }
    if (container.previousElementSibling !== footer) {
      footer.insertAdjacentElement("afterend", container);
    }
    return container;
  }

  function removeDuplicateMigratedRegions(footer, identityKey, placement) {
    const root = footer?.getRootNode?.();
    if (!root?.querySelectorAll || !identityKey) return;
    const messageId = String(placement?.messageId || "");
    for (const container of root.querySelectorAll(
      "[data-algolia-rendered-answer-sources], [data-algolia-rendered-answer-follow-up]"
    )) {
      if (container.getAttribute("data-answer-identity") !== identityKey) continue;
      if (container.closest?.("[data-algolia-answer-footer]") === footer) continue;
      if (
        messageId &&
        container.matches("[data-algolia-rendered-answer-follow-up]") &&
        container.dataset?.algoliaAnswerMessageId === messageId &&
        container.parentElement === footer.parentElement
      ) {
        continue;
      }
      container.remove();
    }
  }

  function removeDuplicateContainers(footer, identityKey, placement) {
    const root = footer?.getRootNode?.();
    if (!root?.querySelectorAll || !identityKey) return;
    for (const container of root.querySelectorAll("[data-algolia-rendered-answer-footer]")) {
      if (container.parentElement === footer) continue;
      const rendered = container.querySelector?.("footer[data-answer-footer]") || null;
      if (rendered?.getAttribute("data-answer-footer") !== identityKey) continue;
      const parent = container.parentElement;
      container.remove();
      if (
        parent?.dataset?.algoliaAnswerFooter === String(placement?.messageId || "") &&
        !parent.querySelector?.(".acs-source-section, algolia-confidence-badge") &&
        !parent.textContent?.trim()
      ) {
        parent.remove();
      }
    }
  }

  function cancelRelocationObserver(key) {
    const pending = relocationObserversByKey.get(key);
    pending?.observer?.disconnect?.();
    if (pending?.timeoutId && typeof target.clearTimeout === "function") {
      target.clearTimeout(pending.timeoutId);
    }
    relocationObserversByKey.delete(key);
  }

  function cancelConfidenceObserver(key) {
    const pending = confidenceObserversByKey.get(key);
    pending?.observer?.disconnect?.();
    if (pending?.timeoutId && typeof target.clearTimeout === "function") {
      target.clearTimeout(pending.timeoutId);
    }
    confidenceObserversByKey.delete(key);
  }

  function trimRecordState() {
    while (recordsByKey.size > MAX_LOCAL_BRIDGE_RECORDS) {
      const key = recordsByKey.keys().next().value;
      cancelRelocationObserver(key);
      cancelConfidenceObserver(key);
      recordsByKey.delete(key);
      placementsByKey.delete(key);
      lastFooterByKey.delete(key);
      unsupportedTermsByKey.delete(key);
    }
    for (const map of [placementsBySegment, latestRecordKeyBySegment]) {
      while (map.size > MAX_LOCAL_BRIDGE_RECORDS) {
        map.delete(map.keys().next().value);
      }
    }
  }

  function footerNeedsRelocation(footer) {
    if (!footer?.parentElement) return false;
    if (footer.querySelector?.(".acs-source-section, algolia-confidence-badge")) return false;
    const siblings = [...footer.parentElement.children];
    const footerIndex = siblings.indexOf(footer);
    const answerIndex = siblings.findIndex((node) =>
      node.matches?.(".acs-answer-layer") || node.querySelector?.(".acs-answer-layer")
    );
    if (answerIndex < 0) return true;
    return answerIndex >= 0 && footerIndex >= 0 && footerIndex < answerIndex;
  }

  function hasRelocationDestination(key, footer) {
    const root = footer?.getRootNode?.();
    const placement = placementsByKey.get(key);
    const messageId = String(placement?.messageId || "");
    if (!root?.querySelectorAll || !messageId) return false;
    const card = footer?.parentElement;
    if (card && [...card.children].some((node) =>
      node !== footer && node.querySelector?.(".acs-source-section, algolia-confidence-badge")
    )) {
      return true;
    }
    const matchingFooters = [...root.querySelectorAll("[data-algolia-answer-footer]")]
      .filter((node) => node.dataset?.algoliaAnswerFooter === messageId);
    if (matchingFooters.some((node) => node.querySelector?.(".acs-source-section, algolia-confidence-badge"))) {
      return true;
    }
    return Boolean(card && [...card.children].some((node) =>
      node.matches?.(".acs-answer-layer") || node.querySelector?.(".acs-answer-layer")
    ));
  }

  function bestFooterForPlacement(footer, placement) {
    const card = footer?.parentElement;
    if (!card) return footer;
    const messageId = String(placement?.messageId || footer.dataset?.algoliaAnswerFooter || "");
    const isFooterLike = (node) => {
      const classes = new Set(String(node.className || "").split(/\s+/));
      return classes.has("flex") && classes.has("items-end") &&
        classes.has("justify-between") && classes.has("gap-4");
    };
    const candidates = [...card.children].filter((node) =>
      node.dataset?.algoliaAnswerFooter === messageId || isFooterLike(node)
    );
    const answer = answerBodyForCard(card);
    const answerIndex = [...card.children].indexOf(answer);
    const richFooter = candidates.find((node) => node.querySelector?.("algolia-confidence-badge")) ||
      candidates.find((node) => {
        const index = [...card.children].indexOf(node);
        return answerIndex >= 0 && index > answerIndex;
      }) ||
      candidates.find((node) => node.querySelector?.(".acs-source-section")) ||
      footer;
    richFooter.dataset.algoliaAnswerFooter = footer.dataset?.algoliaAnswerFooter || String(placement?.messageId || "");
    richFooter.dataset.algoliaAnswerAgent = footer.dataset?.algoliaAnswerAgent || "primary";
    return richFooter;
  }

  function removeDuplicateAnswerFooters(footer, placement) {
    const card = footer?.parentElement;
    const messageId = String(placement?.messageId || footer?.dataset?.algoliaAnswerFooter || "");
    if (!card || !messageId) return;
    for (const candidate of [...card.children]) {
      if (candidate === footer || candidate.dataset?.algoliaAnswerFooter !== messageId) continue;
      candidate.remove();
    }
  }

  function legacyBodyForCard(card) {
    if (!card?.querySelectorAll) return null;
    return [...card.querySelectorAll(".acs-answer-layer")]
      .find((node) => !node.hasAttribute("data-algolia-rendered-answer-body")) || null;
  }

  function renderedBodyForCard(card) {
    return card?.querySelector?.(":scope > [data-algolia-rendered-answer-body]") || null;
  }

  function answerBodyForCard(card) {
    return renderedBodyForCard(card) || legacyBodyForCard(card);
  }

  function moveFooterAfterAnswer(footer) {
    const card = footer?.parentElement;
    const answer = answerBodyForCard(card);
    if (!card || !answer || answer === footer) return footer;
    const children = [...card.children];
    const footerIndex = children.indexOf(footer);
    const answerIndex = children.indexOf(answer);
    if (footerIndex < 0 || answerIndex < 0 || footerIndex > answerIndex) return footer;
    answer.insertAdjacentElement("afterend", footer);
    return footer;
  }

  function collectUnsupportedTerms(card) {
    return [...(card?.querySelectorAll?.('[data-source-review="unsupported-term"]') || [])]
      .map((node) => node.textContent?.trim() || "")
      .filter(Boolean);
  }

  function canRenderBody(viewModel) {
    return viewModel?.tldr?.analogy?.status === ANSWER_SLOT_STATUS.READY &&
      Boolean(viewModel.tldr.analogy.value) &&
      viewModel?.details?.status === ANSWER_SLOT_STATUS.READY &&
      Boolean(viewModel.details.value);
  }

  function clearEmptyFailedPresentation(key) {
    const footer = lastFooterByKey.get(key);
    if (!footer?.isConnected) return false;
    const card = footer.parentElement;
    renderedBodyForCard(card)?.remove();
    const sourceContainer = footer.querySelector?.("[data-algolia-rendered-answer-sources]");
    const sourceRegion = sourceContainer?.parentElement;
    if (sourceRegion?.parentElement === footer) sourceRegion.remove();
    else sourceContainer?.remove();
    footer.querySelector?.(":scope > [data-algolia-rendered-answer-footer]")?.remove();
    for (const followUp of card?.querySelectorAll?.(
      `:scope > [data-algolia-rendered-answer-follow-up][data-answer-identity="${CSS.escape(key)}"]`
    ) || []) {
      followUp.remove();
    }
    if (!footer.querySelector?.("algolia-confidence-badge") && !footer.textContent?.trim()) {
      footer.remove();
    }
    cancelRelocationObserver(key);
    cancelConfidenceObserver(key);
    return true;
  }

  function findConfidenceControl(footer, container) {
    return container?.querySelector?.("algolia-confidence-badge") ||
      [...(footer?.children || [])].find((child) => child.tagName === "ALGOLIA-CONFIDENCE-BADGE") ||
      null;
  }

  function observeLateConfidence(key, footer) {
    const root = footer?.getRootNode?.();
    if (!key || !root?.querySelector || typeof target.MutationObserver !== "function") return;
    if (confidenceObserversByKey.has(key)) return;
    const observer = new target.MutationObserver(() => {
      const latestFooter = lastFooterByKey.get(key) || footer;
      if (!latestFooter?.querySelector?.("algolia-confidence-badge")) return;
      cancelConfidenceObserver(key);
      renderByKey(key);
    });
    observer.observe(root, { childList: true, subtree: true });
    const timeoutId = typeof target.setTimeout === "function"
      ? target.setTimeout(() => cancelConfidenceObserver(key), 30000)
      : null;
    confidenceObserversByKey.set(key, { observer, timeoutId });
  }

  function unhideLegacyBody(card) {
    const legacy = legacyBodyForCard(card);
    if (legacy) {
      legacy.hidden = false;
      legacy.removeAttribute("aria-hidden");
      legacy.style.removeProperty("display");
    }
    renderedBodyForCard(card)?.remove();
  }

  function renderBodyByKey(key, footer, viewModel) {
    if (!enabled() || !key || !footer?.parentElement) return false;
    const card = footer.parentElement;
    if (!canRenderBody(viewModel)) {
      unhideLegacyBody(card);
      return false;
    }
    const legacy = legacyBodyForCard(card);
    if (!legacy) return false;
    unsupportedTermsByKey.set(key, collectUnsupportedTerms(card));
    let container = renderedBodyForCard(card);
    if (!container) {
      container = createAlgoliaAnswerBodyContainer(card.ownerDocument);
      card.insertBefore(container, legacy);
    }
    bodyRenderer.render(container, viewModel);
    legacy.hidden = true;
    legacy.setAttribute("aria-hidden", "true");
    legacy.style.setProperty("display", "none", "important");
    return true;
  }

  function observeFooterRelocation(key, footer) {
    const root = footer?.getRootNode?.();
    if (!key || !root || typeof target.MutationObserver !== "function") return;
    if (relocationObserversByKey.has(key)) return;
    const observer = new target.MutationObserver(() => {
      const latestFooter = lastFooterByKey.get(key) || footer;
      if (!hasRelocationDestination(key, latestFooter)) return;
      cancelRelocationObserver(key);
      renderByKey(key);
    });
    observer.observe(root, { childList: true, subtree: true });
    const timeoutId = typeof target.setTimeout === "function"
      ? target.setTimeout(() => cancelRelocationObserver(key), 10000)
      : null;
    relocationObserversByKey.set(key, { observer, timeoutId });
  }

  function renderByKey(key) {
    if (!enabled() || !key) return false;
    const record = recordsByKey.get(key) || target.algoliaAnswerHarness?.getRecord?.(key);
    const segmentKey = detailSegmentKey(record?.identity);
    let placement = placementsByKey.get(key);
    if (!placement && segmentKey && latestRecordKeyBySegment.get(segmentKey) === key) {
      const segmentPlacement = placementsBySegment.get(segmentKey);
      if (segmentPlacement) {
        placement = Object.freeze({ ...segmentPlacement, answerIdentity: record.identity });
        placementsByKey.set(key, placement);
      }
    }
    if (!record || !placement) return false;
    const viewModel = toAnswerPresentation(record);
    if (
      record.lifecycle === ANSWER_LIFECYCLE.FAILED &&
      viewModel?.details?.status !== ANSWER_SLOT_STATUS.READY
    ) {
      return clearEmptyFailedPresentation(key);
    }
    let footer = target.algoliaHandoffToOrchestrator?.ensureAnswerFooter?.(placement);
    footer = bestFooterForPlacement(footer, placement);
    lastFooterByKey.set(key, footer);
    renderBodyByKey(key, footer, viewModel);
    footer = bestFooterForPlacement(moveFooterAfterAnswer(footer), placement);
    footer = moveFooterAfterAnswer(footer);
    const container = containerForFooter(footer);
    if (!container) return false;
    removeDuplicateAnswerFooters(footer, placement);
    removeDuplicateContainers(footer, key, placement);
    removeDuplicateMigratedRegions(footer, key, placement);
    const sourceContainer = sourceContainerForFooter(footer);
    if (sourceContainer) sourceRenderer.render(sourceContainer, viewModel);
    const confidenceControl = findConfidenceControl(footer, container);
    const controlsFooter = renderer.render(container, viewModel);
    configureAlgoliaAnswerFooterLayout({
      hostFooter: footer,
      sourceContainer,
      controlsContainer: container,
      controlsFooter,
      confidenceControl,
    });
    if (confidenceControl) cancelConfidenceObserver(key);
    else observeLateConfidence(key, footer);
    const followUpContainer = followUpContainerForFooter(footer, placement);
    if (followUpContainer) followUpRenderer.render(followUpContainer, viewModel);
    if (footerNeedsRelocation(footer)) observeFooterRelocation(key, footer);
    else cancelRelocationObserver(key);
    return true;
  }

  function placementMatches(current, next) {
    if (!current || !next) return false;
    return detailIdentityKey(current) === detailIdentityKey(next) &&
      String(current.messageId || "") === String(next.messageId || "") &&
      String(current.question || "") === String(next.question || "") &&
      String(current.runtimeTurnId || "") === String(next.runtimeTurnId || "");
  }

  return Object.freeze({
    isEnabled: enabled,
    hasSlot(slotKey) {
      return enabled() && MIGRATED_WIDGET_SLOTS.has(slotKey);
    },
    handleRecord(record) {
      if (!record?.identityKey) return;
      recordsByKey.set(record.identityKey, record);
      const segmentKey = detailSegmentKey(record.identity);
      if (segmentKey && !isClosedLifecycle(record.lifecycle)) {
        latestRecordKeyBySegment.delete(segmentKey);
        latestRecordKeyBySegment.set(segmentKey, record.identityKey);
      }
      trimRecordState();
      renderByKey(record.identityKey);
    },
    registerPlacement(detail) {
      const key = detailIdentityKey(detail);
      if (!key) return false;
      const current = placementsByKey.get(key);
      if (placementMatches(current, detail) && lastFooterByKey.get(key)?.isConnected) {
        return renderByKey(key);
      }
      placementsByKey.set(key, detail);
      const segmentKey = detailSegmentKey(detail);
      if (segmentKey) {
        const latestKey = latestRecordKeyBySegment.get(segmentKey);
        if (!latestKey || latestKey === key) {
          placementsBySegment.delete(segmentKey);
          placementsBySegment.set(segmentKey, detail);
        }
      }
      trimRecordState();
      return renderByKey(key);
    },
    renderPlacement(detail) {
      return renderByKey(detailIdentityKey(detail));
    },
  });
}

function installAnswerHarnessRuntime(target = globalThis) {
  const footerBridge = target.algoliaAnswerFooterRenderer || createLocalFooterBridge(target);
  const existing = target.algoliaAnswerHarness;
  const harness = existing?.accept ? existing : createAnswerHarnessObserver({
    onRecord: (record) => footerBridge.handleRecord(record),
  });
  const createConfidence = (input = {}) => createAlgoliaConfidenceContribution({
    ...input,
    existingRecord: input.existingRecord || harness.getRecord(input.identity),
  });
  target.algoliaAnswerHarness = harness;
  target.algoliaAnswerFooterRenderer = footerBridge;
  target.algoliaAnswerContributors = Object.freeze({
    createAnswerContentContribution: createAlgoliaAnswerContentContribution,
    createConfidenceContribution: createConfidence,
    createErrorRetryContribution,
    createOpaqueActionContribution,
    createProgressContribution,
    createSourcesContribution,
    createTelemetryContribution,
    sourcePresentationSignature,
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
