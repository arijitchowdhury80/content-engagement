/**
 * chatWidget — the public factory for the algolia.chat InstantSearch widget.
 *
 * Wires `connectChat` (the connector) to `createChatRenderer` (the React
 * renderer harness) following the pattern from the Algolia "Create your own
 * widgets" guide. The returned widget object is registered with InstantSearch
 * via `search.addWidgets([chatWidget({ container, apiRef })])`.
 *
 * The `component` parameter is optional: it defaults to the built-in
 * `ChatWidget` component. Pass a custom component to override the entire chat
 * UI while keeping the IS connector/renderer plumbing intact.
 *
 * Usage (standard — no custom UI):
 *   import { chatWidget } from '@algolia-central/chat-central';
 *   const widget = chatWidget({ container, apiRef });
 *   search.addWidgets([widget]);
 *
 * Usage (custom UI):
 *   import { chatWidget } from '@algolia-central/chat-central';
 *   import { MyChatUI } from './MyChatUI';
 *   const widget = chatWidget({ container, apiRef, component: MyChatUI });
 */

import type { ComponentType } from 'react';
import { connectChat } from './connectChat';
import { createChatRenderer, type WidgetApi, type ChatComponentProps } from './chatRenderer';
import { ChatWidget } from './chat/ChatWidget';

export interface ChatWidgetParams {
  /** DOM element (typically inside a shadow root) where React is mounted. */
  container: HTMLElement;
  /** Ref owned by the host element; React populates it with open/ask on mount. */
  apiRef: { current: WidgetApi | null };
  /**
   * The chat UI component to mount. Defaults to the built-in `ChatWidget`.
   * Override only when you need to replace the entire chat UI.
   */
  component?: ComponentType<ChatComponentProps>;
  /** Notified whenever the chat panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /**
   * The custom element (or any DOM element) that hosts this widget. When
   * provided it is made available to the React tree via `HostSlotsContext` so
   * `SlotOutlet` and `TemplateOutlet` can discover `<template slot="…">` and
   * other light-DOM children supplied by the embedding page.
   *
   * The `<algolia-chat>` custom element passes `this` here. Direct consumers
   * of `chatWidget()` can pass the container's parent or any element whose
   * children carry the slot children they want to project.
   */
  hostElement?: Element;
}

export function chatWidget({
  container,
  apiRef,
  component = ChatWidget,
  onOpenChange,
  hostElement,
}: ChatWidgetParams) {
  const { render, dispose } = createChatRenderer({
    container,
    apiRef,
    component,
    onOpenChange,
    hostElement,
  });
  const createWidget = connectChat(render, dispose);

  return {
    ...createWidget({ container }),
    $$widgetType: 'algolia.chat',
  };
}
