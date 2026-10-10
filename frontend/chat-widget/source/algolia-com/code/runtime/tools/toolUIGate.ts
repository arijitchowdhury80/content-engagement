/**
 * toolUIGate — module-level gate for tool-driven interactive UI.
 *
 * Generalizes the ConsentGate suspend-on-human pattern so any host-registered
 * tool can block the turn until the user fills out a form, makes a choice, or
 * takes any other explicit action. The gate is observable via
 * useSyncExternalStore so the ChatWidget re-renders immediately when a pending
 * schema arrives from a tool handler.
 *
 * Flow:
 *   1. Tool handler calls toolUIGate.request(schema) → returns Promise<data|null>
 *   2. ChatWidget sees the pending schema via useToolUI() and renders the
 *      tool-ui slot region (built-in form or host-overridden markup).
 *   3. User fills the form and submits → toolUIGate.settle(data) resolves step 1.
 *   4. User dismisses or the turn is aborted → toolUIGate.dismiss() → null.
 *
 * Exposed on window.algoliaChat as `toolUI` so external bundles (form-tool)
 * can drive it without importing this module directly:
 *
 *   window.algoliaChat.registerTool('submit_lead_form', async (input) => {
 *     const data = await window.algoliaChat.toolUI.request({
 *       title: 'Contact us',
 *       fields: [
 *         { name: 'name',  label: 'Full name',  type: 'text',  required: true },
 *         { name: 'email', label: 'Work email', type: 'email', required: true },
 *       ],
 *     });
 *     if (!data) return { cancelled: true };
 *     return { captured: data };
 *   });
 */

import { useSyncExternalStore } from 'react';

// ── Schema types ──────────────────────────────────────────────────────────────

export interface ToolUIField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel';
  required?: boolean;
  placeholder?: string;
}

export interface ToolUISchema {
  /** Form title rendered above the fields. */
  title?: string;
  /** Optional description / helper text below the title. */
  description?: string;
  /** Ordered list of input fields. */
  fields: ToolUIField[];
  /** Label for the submit button. Defaults to "Submit". */
  submitLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
}

// ── Gate state ────────────────────────────────────────────────────────────────

export interface ToolUIState {
  schema: ToolUISchema | null;
}

// Stable sentinel for the idle state. useSyncExternalStore compares snapshots
// with Object.is, so returning a fresh object literal each call would cause an
// infinite re-render loop (React error #185). All three mutation functions
// (request, settle, dismiss) reassign _snapshot to either a new object or this
// constant so the reference only changes when the schema actually changes.
const EMPTY: ToolUIState = { schema: null };

// Externally-visible snapshot — the value returned by getSnapshot. Mutated
// only in request/settle/dismiss, never during a render.
let _snapshot: ToolUIState = EMPTY;

// The pending resolver lives separately from the public snapshot so
// getSnapshot never needs to touch it and the two concerns stay decoupled.
let _resolver: ((data: Record<string, string> | null) => void) | null = null;

const _subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of _subscribers) cb();
}

// Standalone functions so they can be passed to useSyncExternalStore without
// bind() and without the this-binding footgun of method shorthand.
function getSnapshot(): ToolUIState {
  return _snapshot;
}

function subscribe(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => {
    _subscribers.delete(cb);
  };
}

// ── Public gate object ────────────────────────────────────────────────────────

export const toolUIGate = {
  getSnapshot,
  subscribe,

  /**
   * Request a tool UI interaction. Suspends the calling tool handler until
   * the user submits (returns the form data) or cancels (returns null).
   *
   * Only one pending UI is supported at a time. A second call while one is
   * already pending immediately returns null so the turn does not deadlock.
   */
  request(schema: ToolUISchema): Promise<Record<string, string> | null> {
    if (_resolver) {
      console.warn(
        '[algolia-chat] toolUIGate.request() called while a tool UI is already pending — returning null.',
      );
      return Promise.resolve(null);
    }
    return new Promise<Record<string, string> | null>((resolve) => {
      _resolver = resolve;
      _snapshot = { schema };
      notify();
    });
  },

  /**
   * Resolve the pending tool UI with the user's data.
   * No-op when no request is outstanding.
   */
  settle(data: Record<string, string>): void {
    const resolver = _resolver;
    if (!resolver) return;
    _resolver = null;
    _snapshot = EMPTY;
    notify();
    resolver(data);
  },

  /**
   * Cancel the pending tool UI (user dismissed or turn aborted).
   * No-op when no request is outstanding.
   */
  dismiss(): void {
    const resolver = _resolver;
    if (!resolver) return;
    _resolver = null;
    _snapshot = EMPTY;
    notify();
    resolver(null);
  },
};

// ── React hook ────────────────────────────────────────────────────────────────

/** Subscribe to pending tool UI state. Triggers a re-render when a tool
 *  requests interactive UI or when the pending form is settled/dismissed. */
export function useToolUI(): ToolUIState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
