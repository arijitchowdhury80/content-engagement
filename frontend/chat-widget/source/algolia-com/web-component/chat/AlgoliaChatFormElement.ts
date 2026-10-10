/**
 * <algolia-chat-form> — declarative config carrier for the form tool bundle.
 *
 * Publishes its field schema so the form-tool bundle knows what to render when
 * the agent calls `submit_lead_form`. Children with `data-field` attributes
 * define the form fields; the element name and order in the DOM set the field
 * order in the form.
 *
 * Attributes on <algolia-chat-form>:
 *   tool-name    Agent tool name to intercept (default: "submit_lead_form")
 *   title        Form panel heading
 *   description  Optional helper text below the heading
 *   submit-label Label for the submit button
 *   cancel-label Label for the cancel button
 *
 * Child elements (data-field):
 *   <span data-field="email" data-label="Work email" data-type="email" data-required>
 *
 * Config is published as `window.ALGOLIA_FORM_CONFIG` (legacy global that the
 * form-tool bundle reads) or via `window.algoliaFormTool.configure()` when the
 * bundle is already loaded.
 *
 * Example:
 *   <algolia-chat>
 *     <algolia-chat-form title="Contact us" submit-label="Send">
 *       <span data-field="name"    data-label="Full name"   data-type="text"  data-required></span>
 *       <span data-field="email"   data-label="Work email"  data-type="email" data-required></span>
 *       <span data-field="company" data-label="Company"     data-type="text"></span>
 *     </algolia-chat-form>
 *   </algolia-chat>
 */

export interface FormFieldConfig {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel';
  required?: boolean;
  placeholder?: string;
}

export interface FormToolConfig {
  toolName?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  cancelLabel?: string;
  fields?: FormFieldConfig[];
}

function applyConfig(config: FormToolConfig): void {
  const formTool = (window as unknown as Record<string, unknown>).algoliaFormTool as
    { configure?: (cfg: FormToolConfig) => void } | undefined;
  if (typeof formTool?.configure === 'function') {
    formTool.configure(config);
    return;
  }
  (window as unknown as Record<string, unknown>).ALGOLIA_FORM_CONFIG = config;
}

function readFields(el: Element): FormFieldConfig[] {
  const fields: FormFieldConfig[] = [];
  for (const child of el.querySelectorAll('[data-field]')) {
    const name = child.getAttribute('data-field');
    const label = child.getAttribute('data-label');
    if (!name || !label) continue;
    const type = child.getAttribute('data-type') as FormFieldConfig['type'];
    const placeholder = child.getAttribute('data-placeholder') ?? undefined;
    fields.push({
      name,
      label,
      type: type ?? 'text',
      required: child.hasAttribute('data-required'),
      placeholder,
    });
  }
  return fields;
}

export class AlgoliaChatFormElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['tool-name', 'title', 'description', 'submit-label', 'cancel-label'];
  }

  connectedCallback(): void {
    this.style.display = 'none';
    applyConfig(this._readConfig());
  }

  attributeChangedCallback(_name: string, previous: string | null, next: string | null): void {
    if (!this.isConnected || previous === next) return;
    applyConfig(this._readConfig());
  }

  private _readConfig(): FormToolConfig {
    const cfg: FormToolConfig = {
      fields: readFields(this),
    };
    const t = this.getAttribute('tool-name');
    if (t) cfg.toolName = t;
    const ti = this.getAttribute('title');
    if (ti) cfg.title = ti;
    const d = this.getAttribute('description');
    if (d) cfg.description = d;
    const sl = this.getAttribute('submit-label');
    if (sl) cfg.submitLabel = sl;
    const cl = this.getAttribute('cancel-label');
    if (cl) cfg.cancelLabel = cl;
    return cfg;
  }
}

if (!customElements.get('algolia-chat-form')) {
  customElements.define('algolia-chat-form', AlgoliaChatFormElement);
}
