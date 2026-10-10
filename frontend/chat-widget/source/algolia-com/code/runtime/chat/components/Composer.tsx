import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { activeInstance } from '../../config/active';

export interface ComposerProps {
  disabled: boolean;
  onSend: (query: string) => void;
}

const MAX_HEIGHT_PX = 180;

/** Sticky-bottom composer. Auto-resizing textarea; Enter sends, Shift+Enter
 *  inserts a newline. Send button is disabled while streaming and meets the
 *  44px touch target. */
export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      part="composer"
      className="flex items-end gap-2.5 rounded-algolia-xl border border-algolia-border bg-algolia-surface p-2 shadow-algolia-2 backdrop-blur-xl transition-colors duration-algolia-fast ease-algolia-ease focus-within:border-algolia-accent"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="acs-composer-input" className="sr-only">
        {activeInstance.strings.composer.label}
      </label>
      <textarea
        id="acs-composer-input"
        part="composer-input"
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={activeInstance.strings.composer.placeholder}
        className="min-h-algolia-control max-h-[180px] flex-1 resize-none border-none bg-transparent px-2 py-2.5 text-algolia-sm text-algolia-text placeholder:text-algolia-text-muted focus:outline-none disabled:opacity-60"
      />
      <button
        type="submit"
        part="composer-send"
        disabled={disabled || !value.trim()}
        aria-label={activeInstance.strings.composer.sendAria}
        className="algolia-glow-accent min-h-algolia-control min-w-algolia-control rounded-algolia-full border-none bg-algolia-accent px-5 font-algolia-medium text-algolia-text-on-accent transition-colors duration-algolia-fast ease-algolia-ease hover:bg-algolia-accent-hover disabled:opacity-45"
      >
        {activeInstance.strings.composer.send}
      </button>
    </form>
  );
}
