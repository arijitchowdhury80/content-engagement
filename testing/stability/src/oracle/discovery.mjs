function patternMatches(text, pattern) {
  return new RegExp(pattern, 'i').test(text);
}

export function evaluateDiscoveryQuestion({ campaign, question, matches, repeated }) {
  const failures = [];
  if (!question?.trim()) failures.push('missing-discovery-question');
  if (campaign.forbiddenQuestionPatterns.some((pattern) => patternMatches(question ?? '', pattern))) {
    failures.push('forbidden-discovery-question');
  }
  if (matches.length === 0) failures.push('unclassified-discovery-question');
  if (new Set(matches).size > 1) failures.push('multiple-slots-in-one-discovery-question');
  if (repeated) failures.push('repeated-confirmed-discovery-slot');
  return { pass: failures.length === 0, failures };
}

export function evaluateProfileCompleteness(campaign, confirmed) {
  const missingSlots = campaign.requiredSlots.filter((slot) => !(slot in confirmed));
  return { pass: missingSlots.length === 0, missingSlots };
}

export function evaluateSubstantiveAnswerShape(answerText) {
  const text = String(answerText ?? '').trim();
  const failures = [];
  if (text.length < 80) failures.push('substantive-answer-too-short');
  if (/[,;:\-–—]$/.test(text)) failures.push('substantive-answer-truncated');
  return { pass: failures.length === 0, failures, characterCount: text.length };
}

export function evaluateFinalContinuity({ campaign, answerText, confirmed }) {
  const confirmedText = JSON.stringify(confirmed).toLowerCase();
  const availableMarkers = campaign.expectedFactMentions.filter((marker) => confirmedText.includes(marker.toLowerCase()));
  const mentioned = availableMarkers.filter((marker) => patternMatches(answerText ?? '', marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const requiredMentions = Math.min(3, availableMarkers.length);
  const failures = [];
  if (requiredMentions === 0) failures.push('no-confirmed-profile-facts');
  if (mentioned.length < requiredMentions) failures.push('insufficient-confirmed-fact-use');
  return { pass: failures.length === 0, failures, availableMarkers, mentioned, requiredMentions };
}
