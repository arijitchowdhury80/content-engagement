/**
 * bind — template data-binding engine.
 *
 * Customers supply a `<template slot="message">` (or any region) whose inner
 * HTML uses `data-algolia-*` attributes as binding directives. This module
 * clones a template, walks the clone, and applies the data bindings.
 *
 * ## Supported directives
 *
 * | Attribute                    | Effect                                                    |
 * |------------------------------|-----------------------------------------------------------|
 * | data-algolia-text="path"     | Sets element.textContent to data[path]                    |
 * | data-algolia-html="path"     | Sets element.innerHTML (basic sanitisation applied)       |
 * | data-algolia-attr-X="path"   | Sets attribute X to data[path] (e.g. data-algolia-attr-src)|
 * | data-algolia-class="path"    | Appends the string at data[path] to className             |
 * | data-algolia-if="path"       | Removes element when !data[path]                          |
 * | data-algolia-unless="path"   | Removes element when data[path] is truthy                 |
 * | data-algolia-each="path"     | Repeats the element's children for each item in data[path]|
 * | data-algolia-action="action" | Wires a click handler for a built-in action               |
 *
 * ## Actions (data-algolia-action values)
 *
 * | Action       | Effect                                                            |
 * |--------------|-------------------------------------------------------------------|
 * | retry        | Calls actions.retry()                                             |
 * | ask          | Calls actions.ask(data["question"])                               |
 * | deep-dive    | Calls actions.deepDive()                                          |
 * | open-judge   | Calls actions.openJudge()                                         |
 * | close        | Calls actions.close()                                             |
 *
 * All resolving is done from a flat or nested plain-object data map.
 * The path is a dot-separated key sequence: "source.title", "streaming".
 *
 * The engine intentionally does NOT eval, does NOT support arbitrary JS
 * expressions, and sanitises innerHTML before insertion.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BindingData = Record<string, unknown>;

export interface BindingActions {
  retry?: () => void;
  ask?: (question: string) => void;
  deepDive?: () => void;
  openJudge?: () => void;
  close?: () => void;
}

// ---------------------------------------------------------------------------
// Path resolver
// ---------------------------------------------------------------------------

function resolvePath(data: BindingData, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, data);
}

// ---------------------------------------------------------------------------
// Minimal HTML sanitiser
// ---------------------------------------------------------------------------

/**
 * Strip dangerous content from HTML before setting innerHTML.
 * This is a lightweight allow-list approach — suitable for trusted widget
 * output (Algolia-generated answer text) but not for fully arbitrary HTML.
 */
function sanitizeHtml(html: string): string {
  // Use DOMParser in a detached document to parse safely.
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Remove script, style, and on* attributes.
  const dangerous = doc.querySelectorAll('script, style, [onload], [onerror]');
  dangerous.forEach((el) => el.remove());

  const allEls = doc.body.querySelectorAll('*');
  allEls.forEach((el) => {
    // Strip event-handler attributes
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    });
  });

  return doc.body.innerHTML;
}

// ---------------------------------------------------------------------------
// Safe string coercion (avoids no-base-to-string on `unknown` values)
// ---------------------------------------------------------------------------

function toStr(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

// ---------------------------------------------------------------------------
// Per-directive binding handlers
// Each returns true when the element was removed so the walker can skip it.
// ---------------------------------------------------------------------------

function applyIfDirective(el: Element, data: BindingData): boolean {
  const path = el.getAttribute('data-algolia-if');
  if (path === null) return false;
  if (!resolvePath(data, path)) {
    el.remove();
    return true;
  }
  el.removeAttribute('data-algolia-if');
  return false;
}

function applyUnlessDirective(el: Element, data: BindingData): boolean {
  const path = el.getAttribute('data-algolia-unless');
  if (path === null) return false;
  if (resolvePath(data, path)) {
    el.remove();
    return true;
  }
  el.removeAttribute('data-algolia-unless');
  return false;
}

function applyTextDirective(el: Element, data: BindingData): void {
  const path = el.getAttribute('data-algolia-text');
  if (path === null) return;
  el.textContent = toStr(resolvePath(data, path));
  el.removeAttribute('data-algolia-text');
}

function applyHtmlDirective(el: Element, data: BindingData): void {
  const path = el.getAttribute('data-algolia-html');
  if (path === null) return;
  const val = resolvePath(data, path);
  (el as HTMLElement).innerHTML = val != null ? sanitizeHtml(toStr(val)) : '';
  el.removeAttribute('data-algolia-html');
}

function applyAttrDirectives(el: Element, data: BindingData): void {
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-algolia-attr-')) continue;
    const attrName = attr.name.slice('data-algolia-attr-'.length);
    const val = resolvePath(data, attr.value);
    if (val != null) {
      el.setAttribute(attrName, toStr(val));
    } else {
      el.removeAttribute(attrName);
    }
    el.removeAttribute(attr.name);
  }
}

function applyClassDirective(el: Element, data: BindingData): void {
  const path = el.getAttribute('data-algolia-class');
  if (path === null) return;
  const val = resolvePath(data, path);
  if (typeof val === 'string') el.classList.add(...val.split(/\s+/).filter(Boolean));
  el.removeAttribute('data-algolia-class');
}

function applyActionDirective(el: Element, data: BindingData, actions: BindingActions): void {
  const action = el.getAttribute('data-algolia-action');
  if (action === null) return;
  const handler = buildActionHandler(action, data, actions);
  if (handler) el.addEventListener('click', handler);
  el.removeAttribute('data-algolia-action');
}

/** Clone each templateChildren node into el for one `each` item. */
function appendEachItem(
  el: Element,
  templateChildren: Node[],
  item: BindingData,
  actions: BindingActions,
): void {
  for (const tmpl of templateChildren) {
    const clone = tmpl.cloneNode(true) as Element;
    walkAndBind(clone, item, actions);
    el.appendChild(clone);
  }
}

function applyEachDirective(el: Element, data: BindingData, actions: BindingActions): void {
  const path = el.getAttribute('data-algolia-each');
  if (path === null) return;
  const items = resolvePath(data, path);
  el.removeAttribute('data-algolia-each');
  if (!Array.isArray(items)) return;
  const templateChildren = Array.from(el.children).map((c) => c.cloneNode(true));
  el.innerHTML = '';
  for (const item of items) appendEachItem(el, templateChildren, item as BindingData, actions);
}

// ---------------------------------------------------------------------------
// Action handler builder
// ---------------------------------------------------------------------------

type SimpleActionKey = 'retry' | 'deepDive' | 'openJudge' | 'close';

const SIMPLE_ACTION_MAP: Partial<Record<string, SimpleActionKey>> = {
  retry: 'retry',
  'deep-dive': 'deepDive',
  'open-judge': 'openJudge',
  close: 'close',
};

function buildAskHandler(data: BindingData, actions: BindingActions): ((e: Event) => void) | null {
  if (!actions.ask) return null;
  const q = resolvePath(data, 'question') ?? resolvePath(data, 'query');
  if (q == null) return null;
  const { ask } = actions;
  return () => ask(toStr(q));
}

function buildActionHandler(
  action: string,
  data: BindingData,
  actions: BindingActions,
): ((e: Event) => void) | null {
  if (action === 'ask') return buildAskHandler(data, actions);
  const key = SIMPLE_ACTION_MAP[action];
  if (!key) return null;
  const fn = actions[key];
  return fn ? () => fn() : null;
}

// ---------------------------------------------------------------------------
// Core binding walker
// ---------------------------------------------------------------------------

function walkAndBind(root: Element, data: BindingData, actions: BindingActions): void {
  const els: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of els) {
    if (!el.isConnected && !root.contains(el)) continue;
    if (applyIfDirective(el, data)) continue;
    if (applyUnlessDirective(el, data)) continue;
    applyTextDirective(el, data);
    applyHtmlDirective(el, data);
    applyAttrDirectives(el, data);
    applyClassDirective(el, data);
    applyActionDirective(el, data, actions);
    applyEachDirective(el, data, actions);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clone a `<template>` element and bind `data` into it using `data-algolia-*`
 * directives. Returns the bound DocumentFragment. The caller is responsible
 * for inserting it into the DOM.
 */
export function bindTemplate(
  template: HTMLTemplateElement,
  data: BindingData,
  actions: BindingActions = {},
): DocumentFragment {
  const clone = template.content.cloneNode(true) as DocumentFragment;

  // Walk each root child of the fragment separately.
  Array.from(clone.children).forEach((child) => {
    walkAndBind(child, data, actions);
  });

  return clone;
}

/**
 * Update an already-inserted DOM subtree with new data values. This patches
 * text/attributes in-place rather than re-cloning, so streaming text updates
 * (answerHtml, answerText) are efficient.
 *
 * Only `data-algolia-text` and `data-algolia-html` are re-applied by the
 * patcher; structural bindings (if/unless/each) require a full re-clone.
 */
export function patchBoundSubtree(root: Element, textUpdates: Record<string, string>): void {
  // We walk for placeholder data attributes that we stored when first binding.
  // To support patching we keep `data-algolia-patch-text` and
  // `data-algolia-patch-html` on elements after the initial bind —
  // the bind step strips the originals but we can re-annotate.
  // Simpler: caller re-clones from template on significant structural changes
  // and only calls patchBoundSubtree for streaming text diffs.
  const allEls = root.querySelectorAll('[data-algolia-live-text],[data-algolia-live-html]');
  allEls.forEach((el) => {
    const textKey = el.getAttribute('data-algolia-live-text');
    if (textKey && textKey in textUpdates) {
      el.textContent = textUpdates[textKey];
    }
    const htmlKey = el.getAttribute('data-algolia-live-html');
    if (htmlKey && htmlKey in textUpdates) {
      (el as HTMLElement).innerHTML = sanitizeHtml(textUpdates[htmlKey]);
    }
  });
}
