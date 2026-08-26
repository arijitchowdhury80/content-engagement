function array(value) {
  return Array.isArray(value) ? value : [];
}

function exportedMessages(conversation) {
  return array(conversation?.messages ?? conversation?.conversation?.messages);
}

function messageIds(conversation) {
  return new Set(exportedMessages(conversation).map((message) => message?.id).filter(Boolean));
}

function partTypes(message) {
  return array(message?.parts).map((part) => part?.type).filter(Boolean);
}

export function reconcileConversation({ browserAttempts, exportedConversation }) {
  if (!Array.isArray(browserAttempts)) throw new Error('browserAttempts must be an array');
  const exportedIds = messageIds(exportedConversation);
  const joins = [];
  const ambiguous = [];

  for (const attempt of browserAttempts) {
    const requestIds = array(attempt.requestMessages).map((message) => message?.id).filter(Boolean);
    const responseId = attempt.responseMessageId ?? null;
    const missingRequestIds = requestIds.filter((id) => !exportedIds.has(id));
    const responseMatched = responseId ? exportedIds.has(responseId) : null;
    const exact = missingRequestIds.length === 0 && responseMatched !== false;
    const record = {
      turnId: attempt.turnId,
      attemptId: attempt.attemptId,
      conversationId: attempt.conversationId,
      requestMessageIds: requestIds,
      responseMessageId: responseId,
      missingRequestIds,
      responseMatched,
      exact,
    };
    joins.push(record);
    if (!exact) ambiguous.push(record);
  }

  const toolParts = exportedMessages(exportedConversation).flatMap((message) =>
    partTypes(message).filter((type) => String(type).startsWith('tool-')),
  );

  return {
    schemaVersion: 'ConversationReconciliation.v1',
    status: ambiguous.length === 0 ? 'PASS' : 'AMBIGUOUS',
    exactJoinRate: joins.length === 0 ? null : joins.filter((join) => join.exact).length / joins.length,
    exportedMessageCount: exportedIds.size,
    exportedToolPartCount: toolParts.length,
    joins,
    ambiguous,
  };
}
