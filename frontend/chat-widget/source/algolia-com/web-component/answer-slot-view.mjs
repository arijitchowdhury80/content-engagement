import { ANSWER_SLOT_STATUS } from "../../shared/core/answer-record.mjs";

const TELEMETRY_PILL_CLASS = "algolia-usage-pill";
const TLDR_STYLE = Object.freeze({
  background: "linear-gradient(135deg, rgba(255,255,255,.96) 0%, rgba(247,249,255,.94) 48%, rgba(237,245,255,.9) 100%)",
  border: "1px solid color-mix(in srgb, var(--algolia-border) 72%, #ffffff)",
  boxShadow: "0 16px 34px rgba(20,33,76,.12), 0 2px 7px rgba(20,33,76,.09), inset 0 1px rgba(255,255,255,.94), inset 0 -1px rgba(0,74,255,.08)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
});
const DETAILS_LABEL_STYLE = Object.freeze({
  letterSpacing: "var(--algolia-tracking-caps)",
});
const HEADING_SIZE_CLASS = Object.freeze({
  1: "text-algolia-xl",
  2: "text-algolia-lg",
  3: "text-algolia-md",
  4: "text-algolia-sm",
  5: "text-algolia-sm",
  6: "text-algolia-sm",
});
const INLINE_MARKDOWN_RE = /\*\*(.+?)\*\*|\*([^*\n]+?)\*|`([^`]+)`|\[([^[\]]+)\]\(\s*([^\s)]+)\s*\)/g;
const CODE_BLOCK_RE = /```(\w*)\n?([\s\S]*?)```/g;
const BULLET_RE = /^[*-]\s+(.*)$/;
const ORDERED_RE = /^\d+[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_RE = /^\|/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;

function formatTokenNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value ?? "");
}

function applyStyle(element, styles) {
  for (const [key, value] of Object.entries(styles)) element.style[key] = value;
}

function safeHref(value) {
  const raw = String(value || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    try {
      return new URL(raw, globalThis.location?.href || "https://www.algolia.com/").toString();
    } catch {
      return "";
    }
  }
  return "";
}

function escapedRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueUnsupportedTerms(terms = []) {
  return [...new Map(
    terms
      .map((term) => String(term || "").trim())
      .filter(Boolean)
      .map((term) => [term.toLowerCase(), term])
  ).values()].sort((left, right) => right.length - left.length);
}

function appendTextWithUnsupported(parent, text, unsupportedTerms) {
  const terms = uniqueUnsupportedTerms(unsupportedTerms);
  if (!terms.length) {
    parent.append(parent.ownerDocument.createTextNode(text));
    return;
  }
  const document = parent.ownerDocument;
  const lookup = new Set(terms.map((term) => term.toLowerCase()));
  const pattern = new RegExp(`(${terms.map(escapedRegex).join("|")})`, "gi");
  for (const part of String(text).split(pattern).filter(Boolean)) {
    if (!lookup.has(part.toLowerCase())) {
      parent.append(document.createTextNode(part));
      continue;
    }
    const span = document.createElement("span");
    span.className = "text-algolia-negative underline decoration-dotted underline-offset-2";
    span.title = "needs source review";
    span.dataset.sourceReview = "unsupported-term";
    span.textContent = part;
    parent.append(span);
  }
}

function appendInlineMarkdown(parent, text, unsupportedTerms = []) {
  const document = parent.ownerDocument;
  const source = String(text || "");
  const matcher = new RegExp(INLINE_MARKDOWN_RE.source, "g");
  let cursor = 0;
  let match;
  while ((match = matcher.exec(source)) !== null) {
    if (match.index > cursor) {
      appendTextWithUnsupported(parent, source.slice(cursor, match.index), unsupportedTerms);
    }
    const [, bold, italic, code, linkText, linkUrl] = match;
    if (bold !== undefined) {
      const strong = document.createElement("strong");
      strong.className = "font-algolia-bold";
      appendInlineMarkdown(strong, bold, unsupportedTerms);
      parent.append(strong);
    } else if (italic !== undefined) {
      const em = document.createElement("em");
      appendInlineMarkdown(em, italic, unsupportedTerms);
      parent.append(em);
    } else if (code !== undefined) {
      const codeElement = document.createElement("code");
      codeElement.className = "rounded-algolia-sm bg-algolia-surface-2 px-1 py-0.5 font-algolia-mono text-algolia-xs text-algolia-text";
      appendTextWithUnsupported(codeElement, code, unsupportedTerms);
      parent.append(codeElement);
    } else if (linkText !== undefined && linkUrl !== undefined) {
      const href = safeHref(linkUrl);
      if (href) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.className = "text-algolia-link underline underline-offset-2";
        appendInlineMarkdown(anchor, linkText, unsupportedTerms);
        parent.append(anchor);
      } else {
        appendInlineMarkdown(parent, linkText, unsupportedTerms);
      }
    }
    cursor = matcher.lastIndex;
  }
  if (cursor < source.length) appendTextWithUnsupported(parent, source.slice(cursor), unsupportedTerms);
}

function splitCodeBlocks(text) {
  const blocks = [];
  const source = String(text || "").trim();
  let cursor = 0;
  let match;
  const matcher = new RegExp(CODE_BLOCK_RE.source, "g");
  while ((match = matcher.exec(source)) !== null) {
    if (match.index > cursor) blocks.push({ type: "text", content: source.slice(cursor, match.index) });
    blocks.push({ type: "code-block", content: match[2], lang: match[1] || "" });
    cursor = matcher.lastIndex;
  }
  if (cursor < source.length) blocks.push({ type: "text", content: source.slice(cursor) });
  return blocks;
}

function paragraphBlocks(text) {
  return String(text || "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function appendProse(parent, lines, unsupportedTerms) {
  const p = parent.ownerDocument.createElement("p");
  p.className = "m-0 whitespace-pre-wrap break-words text-algolia-sm leading-ac-body text-algolia-text";
  appendInlineMarkdown(p, lines.join("\n"), unsupportedTerms);
  parent.append(p);
}

function appendHeading(parent, line, hasPriorContent, unsupportedTerms) {
  const document = parent.ownerDocument;
  const match = line.match(HEADING_RE);
  const level = match?.[1]?.length || 4;
  const p = document.createElement("p");
  p.className = `mb-0 break-words font-algolia-bold leading-ac-body text-algolia-text ${hasPriorContent ? "mt-5" : "mt-1"} ${HEADING_SIZE_CLASS[level] || "text-algolia-sm"}`;
  appendInlineMarkdown(p, match?.[2] || line, unsupportedTerms);
  parent.append(p);
}

function appendList(parent, kind, lines, unsupportedTerms) {
  const document = parent.ownerDocument;
  const list = document.createElement(kind === "ordered" ? "ol" : "ul");
  list.className = `m-0 space-y-2 py-1 pl-6 marker:font-algolia-bold marker:text-algolia-accent text-algolia-sm leading-ac-body text-algolia-text ${kind === "ordered" ? "list-decimal" : "list-disc"}`;
  const pattern = kind === "ordered" ? ORDERED_RE : BULLET_RE;
  for (const line of lines) {
    const item = document.createElement("li");
    appendInlineMarkdown(item, line.replace(pattern, "$1"), unsupportedTerms);
    list.append(item);
  }
  parent.append(list);
}

function appendTable(parent, lines, unsupportedTerms) {
  const document = parent.ownerDocument;
  const wrapper = document.createElement("div");
  wrapper.className = "overflow-x-auto";
  const table = document.createElement("table");
  table.className = "w-full border-collapse text-algolia-sm text-algolia-text";
  const rows = lines.map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
  const bodyRows = rows.length > 1 && rows[1].every((cell) => /^:?-+:?$/.test(cell) && cell.length > 0)
    ? rows.slice(2)
    : rows.slice(1);
  if (rows[0]?.length) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const cell of rows[0]) {
      const th = document.createElement("th");
      th.className = "border border-algolia-border bg-algolia-surface-2 px-3 py-2 text-left font-algolia-bold";
      appendInlineMarkdown(th, cell, unsupportedTerms);
      tr.append(th);
    }
    thead.append(tr);
    table.append(thead);
  }
  if (bodyRows.length) {
    const tbody = document.createElement("tbody");
    for (const row of bodyRows) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        td.className = "border border-algolia-border px-3 py-2";
        appendInlineMarkdown(td, cell, unsupportedTerms);
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
  }
  wrapper.append(table);
  parent.append(wrapper);
}

function appendTextBlock(parent, text, unsupportedTerms) {
  const groups = [];
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const kind = HEADING_RE.test(line) ? "heading" :
      HR_RE.test(line) ? "hr" :
      TABLE_RE.test(line) ? "table" :
      BULLET_RE.test(line) ? "bullet" :
      ORDERED_RE.test(line) ? "ordered" :
      "prose";
    const last = groups.at(-1);
    if (last && ["prose", "bullet", "ordered", "table"].includes(kind) && last.kind === kind) {
      last.lines.push(line);
    } else {
      groups.push({ kind, lines: [line] });
    }
  }

  groups.forEach((group, index) => {
    if (group.kind === "heading") appendHeading(parent, group.lines[0], index > 0, unsupportedTerms);
    else if (group.kind === "hr") {
      const hr = parent.ownerDocument.createElement("hr");
      hr.className = "my-1 border-algolia-border";
      parent.append(hr);
    } else if (group.kind === "bullet" || group.kind === "ordered") appendList(parent, group.kind, group.lines, unsupportedTerms);
    else if (group.kind === "table") appendTable(parent, group.lines, unsupportedTerms);
    else appendProse(parent, group.lines, unsupportedTerms);
  });
}

function renderMarkdown(document, text, unsupportedTerms = []) {
  const root = document.createElement("div");
  root.className = "flex flex-col gap-3";
  splitCodeBlocks(text).forEach((block) => {
    if (block.type === "code-block") {
      const pre = document.createElement("pre");
      pre.className = "m-0 max-w-full overflow-x-auto rounded-algolia-sm border border-algolia-border bg-algolia-surface-2 p-3 font-algolia-mono text-algolia-xs leading-ac-body text-algolia-text";
      const code = document.createElement("code");
      code.className = "whitespace-pre";
      code.textContent = String(block.content || "").replace(/\n$/, "");
      pre.append(code);
      root.append(pre);
    } else {
      for (const paragraph of paragraphBlocks(block.content)) appendTextBlock(root, paragraph, unsupportedTerms);
    }
  });
  return root;
}

function telemetryPillPart(document, className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function renderSourceDetails(document, group) {
  const details = document.createElement("details");
  details.className = "flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-1";
  const summary = document.createElement("summary");
  summary.className = "acs-source-group-pill inline-flex shrink-0 cursor-pointer list-none items-center gap-1.5 rounded-algolia-full border border-algolia-border px-2 py-0.5 transition-all duration-algolia-fast ease-algolia-ease hover:border-algolia-accent";
  summary.setAttribute("aria-label", `${group.label}: ${group.sources.length} sources`);

  const label = document.createElement("span");
  label.className = "text-algolia-2xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-text-secondary";
  label.textContent = group.label;

  const count = document.createElement("span");
  count.className = "acs-source-group-count inline-flex min-w-[18px] items-center justify-center rounded-algolia-full bg-algolia-accent-tint px-1.5 text-algolia-2xs font-algolia-bold text-algolia-accent";
  count.textContent = String(group.sources.length);

  summary.append(label, count);
  details.append(summary);

  const list = document.createElement("div");
  list.className = "mt-1 flex flex-wrap items-center gap-1.5";
  for (const source of group.sources) {
    const href = source.url;
    const item = href ? document.createElement("a") : document.createElement("span");
    item.className = href
      ? "acs-source-pill acs-source-pill--link inline-flex max-w-full items-center rounded-algolia-full border border-algolia-border px-2.5 py-0.5 text-algolia-xs text-algolia-text no-underline transition-all duration-algolia-fast ease-algolia-ease hover:border-algolia-accent"
      : "acs-source-pill acs-source-pill--static inline-flex max-w-full items-center rounded-algolia-full border border-algolia-border px-2.5 py-0.5 text-algolia-xs text-algolia-text opacity-90";
    item.title = source.title;
    if (href) {
      item.href = href;
      item.target = "_blank";
      item.rel = "noopener noreferrer";
    }
    const text = document.createElement("span");
    text.className = "max-w-algolia-source-name overflow-hidden text-ellipsis whitespace-nowrap";
    text.textContent = source.displayTitle;
    item.append(text);
    list.append(item);
  }
  details.append(list);
  return details;
}

function renderSources(element, slot, options = {}) {
  const document = element.ownerDocument;
  element.replaceChildren();
  if (slot.status === ANSWER_SLOT_STATUS.EMPTY || slot.status === ANSWER_SLOT_STATUS.LOADING) return;

  const section = document.createElement("div");
  section.className = "acs-source-section flex flex-col gap-2 pt-5";
  section.setAttribute("aria-label", "Sources");

  const label = document.createElement("span");
  label.className = "acs-answer-section-label text-algolia-xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-text";
  label.textContent = "Sources";
  section.append(label);

  const groups = Array.isArray(options.sourceGroups) ? options.sourceGroups : [];
  if (slot.status === ANSWER_SLOT_STATUS.READY && groups.length) {
    const pills = document.createElement("div");
    pills.className = "flex flex-wrap items-center gap-1.5";
    for (const group of groups) pills.append(renderSourceDetails(document, group));
    section.append(pills);
  } else {
    const unavailable = document.createElement("span");
    unavailable.className = "text-algolia-xs text-algolia-text-muted";
    unavailable.textContent = slot.message || "Sources unavailable.";
    section.append(unavailable);
  }

  element.append(section);
}

function renderTelemetry(element, slot) {
  const document = element.ownerDocument;
  element.replaceChildren();
  if (slot.status === ANSWER_SLOT_STATUS.EMPTY || slot.status === ANSWER_SLOT_STATUS.LOADING) return;

  const pill = document.createElement("span");
  pill.className = TELEMETRY_PILL_CLASS;
  pill.setAttribute("aria-live", "polite");

  const usage = slot.value;
  if (slot.status === ANSWER_SLOT_STATUS.READY && usage) {
    const inputTokens = formatTokenNumber(usage.inputTokens);
    const outputTokens = formatTokenNumber(usage.outputTokens);
    const text = `In ${inputTokens} / ${outputTokens} Out`;
    pill.dataset.usageText = text;
    pill.title = `Current response: ${inputTokens} input tokens and ${outputTokens} output tokens`;
    pill.replaceChildren(
      telemetryPillPart(document, `${TELEMETRY_PILL_CLASS}__in`, `In ${inputTokens}`),
      telemetryPillPart(document, `${TELEMETRY_PILL_CLASS}__divider`, " / "),
      telemetryPillPart(document, `${TELEMETRY_PILL_CLASS}__out`, `${outputTokens} Out`),
    );
  } else {
    pill.textContent = slot.message || "Tokens unavailable";
    pill.title = "Token usage could not be loaded; the answer is unaffected";
  }

  element.appendChild(pill);
}

function renderCompareAction(element, slot) {
  const document = element.ownerDocument;
  element.replaceChildren();
  if (slot.status !== ANSWER_SLOT_STATUS.READY || !slot.value?.available) return;

  const button = document.createElement("button");
  button.id = "acs-compare-toggle";
  button.type = "button";
  button.textContent = slot.value.label || "Compare with Prod";
  button.setAttribute("aria-pressed", slot.value.pressed ? "true" : "false");
  button.removeAttribute("aria-disabled");
  button.setAttribute(
    "aria-label",
    slot.value.pressed
      ? "Stop comparing answer with production"
      : "Compare answer with production",
  );
  button.title = slot.value.title ||
    "Send the latest answer's exact finalized request to live algolia.com Ask AI";
  element.appendChild(button);
}

function renderFollowUp(element, slot) {
  const document = element.ownerDocument;
  element.replaceChildren();
  if (slot.status === ANSWER_SLOT_STATUS.EMPTY || slot.status === ANSWER_SLOT_STATUS.LOADING) return;

  const wrapper = document.createElement("div");
  wrapper.className = "acs-followup-wrap flex flex-col gap-2 pt-6";

  if (slot.status !== ANSWER_SLOT_STATUS.READY || !slot.value) {
    const unavailable = document.createElement("div");
    unavailable.className = "acs-followup-card flex w-full items-center rounded-algolia-lg px-4 py-3 text-left text-algolia-sm font-algolia-bold text-algolia-text-muted";
    unavailable.textContent = slot.message || "Discovery follow-up unavailable.";
    wrapper.append(unavailable);
    element.append(wrapper);
    return;
  }

  const question = String(slot.value).trim();
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.algoliaFollowUp = question;
  button.className = "acs-followup-card group flex w-full items-center rounded-algolia-lg px-4 py-3 text-left transition-all duration-algolia-fast ease-algolia-ease disabled:cursor-not-allowed disabled:opacity-50";

  const text = document.createElement("span");
  text.className = "block min-w-0 text-algolia-sm font-algolia-bold leading-ac-body text-algolia-text";
  text.textContent = question;
  button.append(text);
  wrapper.append(button);
  element.append(wrapper);
}

function renderTldr(element, slot, viewModel, options = {}) {
  const document = element.ownerDocument;
  element.replaceChildren();
  if (slot.status === ANSWER_SLOT_STATUS.EMPTY || slot.status === ANSWER_SLOT_STATUS.LOADING) return;
  element.className = "acs-answer-tldr rounded-algolia-lg px-4 py-3";
  applyStyle(element, TLDR_STYLE);

  const content = document.createElement("div");
  content.className = "flex flex-col gap-3";
  const analogy = viewModel?.tldr?.analogy;
  const short = viewModel?.tldr?.short;

  if (analogy?.status === ANSWER_SLOT_STATUS.READY && analogy.value) {
    const block = document.createElement("div");
    block.className = "acs-answer-analogy";
    block.style.fontStyle = "italic";
    block.append(renderMarkdown(document, analogy.value, options.unsupportedTerms));
    content.append(block);
  }
  if (short?.status === ANSWER_SLOT_STATUS.READY && short.value) {
    const block = document.createElement("div");
    block.className = "acs-answer-short";
    block.append(renderMarkdown(document, short.value, options.unsupportedTerms));
    content.append(block);
  }
  element.append(content);
}

function renderDetails(element, slot, viewModel, options = {}) {
  const document = element.ownerDocument;
  element.replaceChildren();
  if (slot.status === ANSWER_SLOT_STATUS.EMPTY || slot.status === ANSWER_SLOT_STATUS.LOADING) return;
  element.className = "acs-answer-details flex flex-col gap-2 pt-5";

  const label = document.createElement("span");
  label.className = "acs-answer-details-label acs-answer-section-label text-algolia-xs font-algolia-bold uppercase tracking-algolia-caps text-algolia-text";
  applyStyle(label, DETAILS_LABEL_STYLE);
  label.textContent = "Details";
  element.append(label);

  if (slot.status === ANSWER_SLOT_STATUS.READY && slot.value) {
    element.append(renderMarkdown(document, slot.value, options.unsupportedTerms));
  } else {
    const unavailable = document.createElement("span");
    unavailable.className = "text-algolia-xs text-algolia-text-muted";
    unavailable.textContent = slot.message || "Details unavailable.";
    element.append(unavailable);
  }
}

export function createAlgoliaAnswerBodyContainer(document) {
  const container = document.createElement("div");
  container.setAttribute("data-algolia-rendered-answer-body", "true");
  container.className = "acs-answer-layer flex flex-col gap-5";
  return container;
}

export function renderAlgoliaAnswerBodySlot(element, slot, viewModel, options = {}) {
  const part = element.getAttribute("part");
  if (part === "answer-tldr") {
    renderTldr(element, slot, viewModel, options);
    return;
  }
  if (part === "answer-details") {
    renderDetails(element, slot, viewModel, options);
    return;
  }
  element.hidden = true;
}

export function createAlgoliaAnswerFooterContainer(document) {
  const container = document.createElement("div");
  container.setAttribute("data-algolia-rendered-answer-footer", "true");
  container.className = "acs-rendered-answer-footer flex flex-nowrap items-center justify-end gap-2";
  return container;
}

export function configureAlgoliaAnswerFooterLayout({
  hostFooter,
  sourceContainer,
  controlsContainer,
  controlsFooter,
  confidenceControl,
} = {}) {
  if (hostFooter?.style) {
    hostFooter.style.flexWrap = "nowrap";
    hostFooter.style.alignItems = "center";
    hostFooter.style.columnGap = "8px";
    hostFooter.style.rowGap = "12px";
    hostFooter.style.marginTop = "22px";
    hostFooter.style.paddingTop = "18px";
    hostFooter.style.borderTop = "1px solid color-mix(in srgb, var(--algolia-accent) 18%, var(--algolia-border))";
    hostFooter.style.boxShadow = "0 -1px rgba(255, 255, 255, 0.86)";
  }

  const sourceRegion = sourceContainer?.parentElement || sourceContainer;
  if (sourceRegion?.style) {
    sourceRegion.style.flex = "1 1 auto";
    sourceRegion.style.minWidth = "0";
    sourceRegion.style.order = "1";
  }
  const sourceSection = sourceContainer?.querySelector?.(".acs-source-section");
  if (sourceSection?.style) {
    sourceSection.style.marginTop = "0";
    sourceSection.style.paddingTop = "0";
    sourceSection.style.borderTop = "0";
    sourceSection.style.boxShadow = "none";
  }

  if (controlsContainer?.style) {
    controlsContainer.style.display = "flex";
    controlsContainer.style.flexWrap = "nowrap";
    controlsContainer.style.alignItems = "center";
    controlsContainer.style.justifyContent = "flex-end";
    controlsContainer.style.gap = "8px";
    controlsContainer.style.marginLeft = "auto";
    controlsContainer.style.order = "2";
  }

  if (controlsFooter?.style) {
    controlsFooter.className = "acs-answer-footer-controls flex flex-nowrap items-center justify-end gap-2";
    controlsFooter.style.display = "flex";
    controlsFooter.style.flexWrap = "nowrap";
    controlsFooter.style.alignItems = "center";
    controlsFooter.style.justifyContent = "flex-end";
    controlsFooter.style.gap = "8px";
    for (const child of controlsFooter.children || []) child.style.flexShrink = "0";
  }

  const confidence = confidenceControl;
  if (confidence?.style) {
    confidence.style.flexShrink = "0";
    confidence.style.order = "3";
  }
}

export function renderAlgoliaAnswerFooterSlot(element, slot, viewModel, options = {}) {
  const part = element.getAttribute("part");
  if (part === "answer-sources") {
    renderSources(element, slot, options);
    return;
  }
  if (part === "answer-telemetry") {
    renderTelemetry(element, slot);
    return;
  }
  if (part === "answer-actions") {
    renderCompareAction(element, slot);
    return;
  }
  if (part === "answer-follow-up") {
    renderFollowUp(element, slot);
    return;
  }
  element.hidden = true;
}
