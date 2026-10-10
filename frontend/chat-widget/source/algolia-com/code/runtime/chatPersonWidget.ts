/**
 * chatPersonWidget — factory that wires connectChatPerson into a ready-to-register
 * InstantSearch widget for the <algolia-chat-person> element.
 *
 * Follows the same pattern as chatConfidenceWidget.ts.
 */

import { connectChatPerson, type ChatPersonWidgetParams } from './connectChatPerson';

export type { ChatPersonWidgetParams };

/**
 * Factory params. The person widget is a pure config carrier, so this adds
 * nothing to the connector params — the alias exists to mirror the naming of
 * the other widget factories.
 */
export type ChatPersonWidgetFactoryParams = ChatPersonWidgetParams;

export function chatPersonWidget(params: ChatPersonWidgetFactoryParams) {
  return connectChatPerson()(params);
}
