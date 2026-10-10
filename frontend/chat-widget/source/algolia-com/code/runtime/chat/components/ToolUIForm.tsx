/**
 * ToolUIForm — default renderer for tool-driven interactive forms.
 *
 * Rendered by ChatWidget while a tool handler is suspended on toolUIGate.
 * Uses theme tokens and WidgetStrings so it looks native in any theme.
 * Hosts can replace this entirely by projecting `<div slot="tool-ui">` from
 * their light DOM — toolUIGate.settle/dismiss are available on
 * window.algoliaChat.toolUI so external markup can still resolve the gate.
 *
 * DOM nodes are created declaratively — no innerHTML or string interpolation —
 * so no escaping holes exist for values arriving from an LLM tool call.
 */
import { useRef, type FormEvent } from 'react';
import { toolUIGate, type ToolUISchema } from '../../tools/toolUIGate';
import { activeInstance } from '../../config/active';

export interface ToolUIFormProps {
  schema: ToolUISchema;
}

/** Resolves a button label, preferring the tool's schema over the widget's
 *  configured strings, falling back to a built-in default. */
function resolveLabel(
  fromSchema: string | undefined,
  fromConfig: string | undefined,
  fallback: string,
): string {
  return fromSchema ?? fromConfig ?? fallback;
}

export function ToolUIForm({ schema }: ToolUIFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const cfgLabels = activeInstance.strings.toolUI;
  const submitLabel = resolveLabel(schema.submitLabel, cfgLabels?.submitLabel, 'Submit');
  const cancelLabel = resolveLabel(schema.cancelLabel, cfgLabels?.cancelLabel, 'Cancel');

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, string> = {};
    for (const field of schema.fields) {
      data[field.name] = (fd.get(field.name) as string | null) ?? '';
    }
    toolUIGate.settle(data);
  }

  function handleCancel(): void {
    toolUIGate.dismiss();
  }

  return (
    <div className="mx-auto w-full max-w-algolia-measure rounded-algolia-lg border border-algolia-border bg-algolia-surface p-4 shadow-algolia-1">
      {schema.title && (
        <h2 className="mb-1 text-algolia-base font-algolia-bold text-algolia-text">
          {schema.title}
        </h2>
      )}
      {schema.description && (
        <p className="mb-3 text-algolia-sm text-algolia-text-muted">{schema.description}</p>
      )}

      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-3">
          {schema.fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1">
              <label
                htmlFor={`tool-ui-${field.name}`}
                className="text-algolia-sm font-algolia-bold text-algolia-text"
              >
                {field.label}
                {field.required && (
                  <span className="ml-1 text-algolia-accent" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
              <input
                id={`tool-ui-${field.name}`}
                name={field.name}
                type={field.type ?? 'text'}
                required={field.required}
                placeholder={field.placeholder}
                className="min-h-algolia-control rounded-algolia-md border border-algolia-border bg-algolia-surface px-3 py-2 text-algolia-sm text-algolia-text placeholder-algolia-text-muted outline-none focus:border-algolia-accent focus:ring-1 focus:ring-algolia-accent"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            className="min-h-algolia-control flex-1 rounded-algolia-md bg-algolia-accent px-4 py-2 text-algolia-sm font-algolia-bold text-algolia-text-on-accent transition-opacity hover:opacity-90"
          >
            {submitLabel}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-algolia-control rounded-algolia-md border border-algolia-border px-4 py-2 text-algolia-sm text-algolia-text-muted transition-colors hover:border-algolia-accent hover:text-algolia-text"
          >
            {cancelLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
