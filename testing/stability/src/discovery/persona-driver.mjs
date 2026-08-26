function matchesPattern(text, pattern) {
  return new RegExp(pattern, 'i').test(text);
}

function responseMatch(response, question) {
  const patterns = response.questionPatterns.filter((pattern) => matchesPattern(question, pattern));
  return {
    response,
    patterns,
    score: patterns.reduce((total, pattern) => total + pattern.replace(/[^a-z0-9]/gi, '').length, 0),
  };
}

export function createPersonaDriver(campaign) {
  const askedSlots = new Set();
  const confirmed = { ...(campaign.initialConfirmed ?? {}) };
  const history = [];

  return {
    answer(question) {
      const scored = campaign.responses.map((response) => responseMatch(response, question)).filter((match) => match.score > 0);
      const strongestScore = Math.max(0, ...scored.map((match) => match.score));
      const strongest = scored.filter((match) => match.score === strongestScore).map((match) => match.response);
      const matches = strongest.map((response) => response.slot);
      const selected = strongest.find((response) => !askedSlots.has(response.slot)) ?? strongest[0] ?? null;
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
