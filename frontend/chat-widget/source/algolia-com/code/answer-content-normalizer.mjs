import { ANSWER_LIFECYCLE } from "../../shared/core/answer-record.mjs";
import { createAnswerContentContribution } from "../../shared/widget/answer-contributors.mjs";

const HEADING_RE = /^\s{0,3}#{1,6}\s+/;
const BULLET_RE = /^\s*[-*+]\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const CODE_FENCE_RE = /^\s*(```|~~~)/;
const TABLE_RE = /^\s*\|.+\|\s*$/;
const HR_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const DISCOVERY_MARKER_RE = /<\s*(?:pivot|discovery|followup)\s*>([\s\S]*?)<\s*\/\s*(?:pivot|discovery|followup)\s*>/i;
const TRAILING_QUESTION_RE = /(?:^|\n)([^.!?\n][^\n]{24,240}\?)\s*$/;
const ANALOGY_RE = /^it['’]s\s+like\b/i;
const ANALOGY_PHRASE_RE = /\b(?:is|are|feels?|works?|looks?)\b(?:\s+\S+){0,3}\s+like\b/i;
const ANALOGY_IMPERATIVE_RE = /\b(?:think of|imagine|picture)\b/i;
const ANALOGY_COLON_RE = /:\s*[^.?!]+(?:is|are)\s+like\b/i;
const SHORT_ANSWER_RE = /^(?:(?:the\s+)?short\s+(?:version|answer))(?:\s*:|\s+is\b)/i;
const SOFT_LEAD_IN_RE =
  /^(?:i\s+can|i(?:'|’)ll|i\s+will|i\s+would|since\s+we|before\s+we|let(?:'|’)s|we\s+can|happy\s+to)\b/i;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function plainText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nonEmptyParagraphs(text) {
  return plainText(text).split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function isProseBlock(text) {
  const value = plainText(text);
  return Boolean(value) &&
    !CODE_FENCE_RE.test(value) &&
    !HEADING_RE.test(value) &&
    !BULLET_RE.test(value) &&
    !ORDERED_RE.test(value) &&
    !TABLE_RE.test(value) &&
    !HR_RE.test(value);
}

function looksLikeAnalogyBlock(text) {
  const value = plainText(text);
  return ANALOGY_RE.test(value) ||
    ANALOGY_PHRASE_RE.test(value) ||
    ANALOGY_IMPERATIVE_RE.test(value) ||
    ANALOGY_COLON_RE.test(value);
}

function isShortAnswerBlock(text) {
  return isProseBlock(text) && SHORT_ANSWER_RE.test(plainText(text));
}

function isSoftLeadInBlock(text) {
  const value = plainText(text);
  return isProseBlock(value) && value.length <= 320 && SOFT_LEAD_IN_RE.test(value);
}

function cleanDetails(text) {
  return plainText(text).replace(/^\s{0,3}#{1,6}\s*details\s*\n+/i, "").trim();
}

function withoutTrailingQuestion(text, question) {
  if (!question) return text;
  const escaped = question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\s*${escaped}\\s*$`), "").trim();
}

function stripDiscoveryMarker(text) {
  const match = plainText(text).match(DISCOVERY_MARKER_RE);
  if (!match) return { text: plainText(text), followUp: null };
  return {
    text: plainText(text).replace(match[0], "").trim(),
    followUp: match[1].trim() || null,
  };
}

function extractFollowUp(answerText) {
  const marked = stripDiscoveryMarker(answerText);
  if (marked.followUp) return marked;
  const match = marked.text.match(TRAILING_QUESTION_RE);
  const followUp = match?.[1]?.trim() || null;
  return { text: withoutTrailingQuestion(marked.text, followUp), followUp };
}

export function normalizeAlgoliaAnswerContent(answerText) {
  const extracted = extractFollowUp(answerText);
  const paragraphs = nonEmptyParagraphs(extracted.text);
  if (paragraphs.length < 2) {
    return deepFreeze({
      tldrAnalogy: null,
      tldrShort: null,
      details: extracted.text,
      followUp: extracted.followUp,
    });
  }

  const analogyIndex = paragraphs.findIndex(
    (part, index) => index < 3 && isProseBlock(part) && looksLikeAnalogyBlock(part)
  );
  let tldrStart = 0;
  let tldrSize = 0;

  if (
    analogyIndex >= 0 &&
    (analogyIndex === 0 || paragraphs.slice(0, analogyIndex).every(isSoftLeadInBlock))
  ) {
    tldrStart = analogyIndex;
    tldrSize = 1;
    if (isShortAnswerBlock(paragraphs[analogyIndex + 1] || "")) {
      tldrSize = 2;
    } else if (
      analogyIndex === 0 &&
      paragraphs[1] &&
      isProseBlock(paragraphs[1])
    ) {
      tldrSize = 2;
    }
  } else {
    if (!isProseBlock(paragraphs[0])) {
      return deepFreeze({
        tldrAnalogy: null,
        tldrShort: null,
        details: extracted.text,
        followUp: extracted.followUp,
      });
    }
    if (isShortAnswerBlock(paragraphs[1] || "")) tldrSize = 2;
  }

  if (tldrSize < 1) {
    return deepFreeze({
      tldrAnalogy: null,
      tldrShort: null,
      details: extracted.text,
      followUp: extracted.followUp,
    });
  }

  const tldrBlocks = paragraphs.slice(tldrStart, tldrStart + tldrSize);
  const leadIns = paragraphs.slice(0, tldrStart).filter((part) => !isSoftLeadInBlock(part));
  const remaining = paragraphs.slice(tldrStart + tldrSize);

  return deepFreeze({
    tldrAnalogy: tldrBlocks[0] || null,
    tldrShort: tldrBlocks.slice(1).join("\n\n").trim() || null,
    details: cleanDetails([...leadIns, ...remaining].join("\n\n")),
    followUp: extracted.followUp,
  });
}

export function createAlgoliaAnswerContentContribution({
  identity,
  text = "",
  followUp = null,
  lifecycle = ANSWER_LIFECYCLE.STREAMING,
} = {}) {
  const content = normalizeAlgoliaAnswerContent(text);
  return createAnswerContentContribution({
    identity,
    lifecycle,
    tldrAnalogy: content.tldrAnalogy,
    tldrShort: content.tldrShort,
    details: content.details,
    followUp: content.followUp || followUp,
  });
}
