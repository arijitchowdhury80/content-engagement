/** Client-side names of tools that must never appear as narrated answer text. */
const TOOL_NAMES = 'ask_specialist|get_visitor_profile|submit_lead_form';

const PSEUDO_TAG_CALL_RE = new RegExp(`\`?<call:\\s*(?:${TOOL_NAMES})\\b[^<>]*/?>\`?`, 'gi');
const BARE_CALL_RE = new RegExp(`\`?\\b(?:${TOOL_NAMES})\\s*\\([^()]*\\)\`?`, 'gi');
const HIDDEN_COMMENT_RE = /<!--[\s\S]*?-->/g;
const FENCED_CODE_RE = /```(?:\w*)\n?[\s\S]*?```/g;

const OFFER_TARGET_RE =
  '(?:\\w+\\s+)?specialist|our (?:sales|tech(?:nical)?|product) team|someone (?:who|that)';
const OFFER_VERB_RE = "i can|i'll|i will|we can|let me";
const SPECIALIST_OFFER_SENTENCE_RE = new RegExp(
  `(?<=^|[.!?]\\*{0,2}\\s+)[^.!?\\n]*\\b(?:${OFFER_VERB_RE})\\b[^.!?\\n]*\\b(?:${OFFER_TARGET_RE})\\b[^.!?\\n]*[.!?]`,
  'gi',
);

function normalizeProseSpacing(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripLeakedToolCallSyntax(text: string): string {
  return normalizeProseSpacing(text.replace(PSEUDO_TAG_CALL_RE, '').replace(BARE_CALL_RE, ''));
}

export function stripDeadSpecialistOffer(text: string): string {
  return normalizeProseSpacing(text.replace(SPECIALIST_OFFER_SENTENCE_RE, ''));
}

function cleanVisibleProse(text: string): string {
  const withoutHiddenState = text.replace(HIDDEN_COMMENT_RE, '');
  return stripDeadSpecialistOffer(stripLeakedToolCallSyntax(withoutHiddenState));
}

/** Apply every display-only prose filter while preserving fenced code examples. */
export function cleanVisibleAnswerText(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FENCED_CODE_RE.lastIndex = 0;

  while ((match = FENCED_CODE_RE.exec(text)) !== null) {
    parts.push(cleanVisibleProse(text.slice(lastIndex, match.index)), match[0]);
    lastIndex = FENCED_CODE_RE.lastIndex;
  }
  parts.push(cleanVisibleProse(text.slice(lastIndex)));
  return parts.join('').trim();
}
