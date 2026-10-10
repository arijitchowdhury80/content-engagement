function fallbackCopy(text: string): void {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  } catch {
    // Copying is a convenience; selecting the question must still work.
  }
}

export function copyQuestion(question: string): void {
  const text = question.trim();
  if (!text) return;

  try {
    if (!navigator.clipboard?.writeText) {
      fallbackCopy(text);
      return;
    }

    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } catch {
    fallbackCopy(text);
  }
}
