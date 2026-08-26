function matchesPattern(text, pattern) {
  return new RegExp(pattern, 'i').test(text);
}

export function createPersonaDriver(campaign) {
  const askedSlots = new Set();
  const confirmed = {};
  const history = [];

  return {
    answer(question) {
      const matchedResponses = campaign.responses.filter((response) =>
        response.questionPatterns.some((pattern) => matchesPattern(question, pattern)));
      const matches = matchedResponses.map((response) => response.slot);
      const selected = matchedResponses.find((response) => !askedSlots.has(response.slot)) ?? matchedResponses[0] ?? null;
      if (!selected) {
        const result = { question, slot: null, matches, answer: campaign.fallbackAnswer, repeated: false, unclassified: true, reveals: {} };
        history.push(result);
        return result;
      }
      const repeated = askedSlots.has(selected.slot);
      askedSlots.add(selected.slot);
      Object.assign(confirmed, selected.reveals);
      const answer = repeated ? `${campaign.repeatAnswerPrefix}${selected.answer}` : selected.answer;
      const result = { question, slot: selected.slot, matches, answer, repeated, unclassified: false, reveals: selected.reveals };
      history.push(result);
      return result;
    },
    snapshot() {
      return {
        confirmed: { ...confirmed },
        askedSlots: [...askedSlots],
        history: history.map((entry) => ({ ...entry, matches: [...entry.matches], reveals: { ...entry.reveals } })),
      };
    },
  };
}
