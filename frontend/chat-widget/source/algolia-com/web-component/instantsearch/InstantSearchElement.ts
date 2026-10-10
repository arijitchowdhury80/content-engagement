/**
 * <algolia-instant-search> — the root orchestrator element.
 *
 * Mirrors the AEM `algolia-instant-search` pattern: this element owns the
 * `instantsearch()` instance and its lifecycle. Child elements create
 * InstantSearch widgets and bubble an `algolia-widget-added` event up the DOM;
 * this root intercepts those events and calls `search.addWidgets([widget])`.
 * When a child disconnects it bubbles `algolia-widget-removed` and this root
 * calls `search.removeWidgets([widget])`.
 *
 * InstantSearch is used as an orchestration/lifecycle layer only — the chat
 * widget talks to Agent Studio and does not consume Algolia search results.
 * A `hitsPerPage: 0` configure widget is added automatically so the initial
 * search is essentially free.
 *
 * Usage:
 *   <algolia-instant-search app-id="XXX" api-key="yyy" index-name="my_index">
 *     <algolia-chat ...>
 *       <algolia-agent role="primary" agent-id="..."></algolia-agent>
 *     </algolia-chat>
 *   </algolia-instant-search>
 *
 * Attributes
 *   app-id          Algolia Application ID
 *   api-key         Browser-safe SEARCH-ONLY key. `search-api-key` is accepted as
 *                   an alias, matching the name <algolia-chat> uses.
 *   index-name      Algolia index name
 *
 * All three are read once at connect — see `attributeChangedCallback`.
 */

import instantsearch from 'instantsearch.js';
import { configure } from 'instantsearch.js/es/widgets';
import { liteClient } from 'algoliasearch/lite';
import {
  ALGOLIA_WIDGET_ADDED,
  ALGOLIA_WIDGET_REMOVED,
  ATTR_APP_ID,
  ATTR_API_KEY,
  ATTR_SEARCH_API_KEY,
  ATTR_INDEX_NAME,
} from './constants';
import { applyRootConfig } from '@algolia-central/chat-central';

type ISInstance = ReturnType<typeof instantsearch>;
// Derive widget param types from the IS instance to avoid importing Widget directly.
type ISAddWidgetParam = Parameters<ISInstance['addWidgets']>[0][number];
type ISRemoveWidgetParam = Parameters<ISInstance['removeWidgets']>[0][number];

export class AlgoliaInstantSearchElement extends HTMLElement {
  private search: ISInstance | null = null;
  private addWidgetListener: ((e: Event) => void) | null = null;
  private removeWidgetListener: ((e: Event) => void) | null = null;

  static get observedAttributes(): string[] {
    return [ATTR_APP_ID, ATTR_API_KEY, ATTR_SEARCH_API_KEY, ATTR_INDEX_NAME];
  }

  /**
   * Report a credential change instead of ignoring it.
   *
   * The search client, the InstantSearch instance, and every widget registered by
   * descendants are built from these attributes at connect. Rebuilding here would
   * silently drop the child widgets that bubbled up to the old instance, so the
   * honest contract is: re-insert the element to switch application. Previously
   * `observedAttributes` advertised live updates and nothing happened.
   */
  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (!this.search || previous === next) return;
    console.warn(
      `[algolia-instant-search] ${name} changed after connect, but the search client and ` +
        `the widgets registered by descendants are already built from the previous value. ` +
        `Remove and re-insert <algolia-instant-search> to switch application or index.`,
    );
  }

  connectedCallback(): void {
    const appId = this.getAttribute(ATTR_APP_ID) ?? '';
    const apiKey = this.getAttribute(ATTR_API_KEY) ?? this.getAttribute(ATTR_SEARCH_API_KEY) ?? '';
    const indexName = this.getAttribute(ATTR_INDEX_NAME) ?? '';

    applyRootConfig({ appId, searchKey: apiKey, indexName });

    const searchClient = liteClient(appId, apiKey);

    this.search = instantsearch({
      indexName: indexName || '_',
      searchClient,
    });

    // A hitsPerPage:0 configure widget keeps the initial search cheap — we
    // only need InstantSearch for its widget lifecycle, not its results.
    this.search.addWidgets([configure({ hitsPerPage: 0 })]);

    // Register widgets bubbled up from descendants. Our custom widget objects
    // satisfy the IS Widget contract at runtime but can't be statically verified
    // against IS's built-in generic Widget type, so we cast through unknown.
    this.addWidgetListener = (e: Event) => {
      const ce = e as CustomEvent<ISAddWidgetParam>;
      if (ce.detail && this.search) {
        this.search.addWidgets([ce.detail]);
        ce.stopPropagation();
      }
    };

    this.removeWidgetListener = (e: Event) => {
      const ce = e as CustomEvent<ISRemoveWidgetParam>;
      if (ce.detail && this.search) {
        try {
          this.search.removeWidgets([ce.detail]);
        } catch {
          // widget may already be gone if IS was disposed
        }
        ce.stopPropagation();
      }
    };

    this.addEventListener(ALGOLIA_WIDGET_ADDED, this.addWidgetListener);
    this.addEventListener(ALGOLIA_WIDGET_REMOVED, this.removeWidgetListener);

    this.search.start();
  }

  disconnectedCallback(): void {
    if (this.addWidgetListener) {
      this.removeEventListener(ALGOLIA_WIDGET_ADDED, this.addWidgetListener);
      this.addWidgetListener = null;
    }
    if (this.removeWidgetListener) {
      this.removeEventListener(ALGOLIA_WIDGET_REMOVED, this.removeWidgetListener);
      this.removeWidgetListener = null;
    }
    if (this.search) {
      this.search.dispose();
      this.search = null;
    }
  }
}

if (!customElements.get('algolia-instant-search')) {
  customElements.define('algolia-instant-search', AlgoliaInstantSearchElement);
}
