/**
 * activeInstance — module-global singleton that holds the resolved
 * InstanceConfig for the current embed. Components read branding, strings,
 * agent config, etc. from this object.
 *
 * Initialised to a structuredClone of `defaultInstance` so mutations
 * (e.g. from `setActiveInstance`) never touch the imported default.
 * `applyRuntimeConfig` (config/runtime.ts) calls `setActiveInstance` to
 * merge attribute-sourced config in.
 *
 * `getAgentByKey` resolves a display name from the agent key so UI
 * components never need to walk the agents array themselves.
 *
 * ## Why the config is an external store
 *
 * Components read `activeInstance` fields directly at render time, which is
 * enough for the first paint but invisible to React afterwards: a host that
 * changed `product-title` on `<algolia-chat>` saw nothing happen, because
 * nothing told React the config had moved. `useActiveConfig` closes that loop —
 * the widget root subscribes, so re-applying config (from an attribute change,
 * or a programmatic `applyRuntimeConfig`) re-renders the tree.
 */
import { useSyncExternalStore } from 'react';
import type { InstanceConfig, AgentDescriptor } from './instance';
import { defaultInstance } from './defaults';

export const activeInstance: InstanceConfig = structuredClone(defaultInstance);

/**
 * Bumped on every config change. Used as the store snapshot: `activeInstance` is
 * mutated in place, so its identity can't signal a change, but a counter can.
 */
let version = 0;
const subscribers = new Set<() => void>();

/** Replace the active instance, merging new values in-place so existing
 *  references to `activeInstance` (e.g. component imports) stay current. */
export function setActiveInstance(next: InstanceConfig): void {
  Object.assign(activeInstance, next);
  version += 1;
  subscribers.forEach((cb) => cb());
}

/** Subscribe to config changes. Returns an unsubscribe function. */
export function subscribeToConfig(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Current config revision. Changes whenever `setActiveInstance` runs. */
export function getConfigVersion(): number {
  return version;
}

/**
 * React hook — re-renders the caller whenever the resolved config changes.
 *
 * Subscribing at the widget root is enough for the whole tree: no component
 * below it is memoised, and they all read `activeInstance` during render.
 */
export function useActiveConfig(): number {
  return useSyncExternalStore(subscribeToConfig, getConfigVersion);
}

/** Look up an agent descriptor by its key string across primary, specialists,
 *  and classifier. Returns undefined when the key is not recognised. */
export function getAgentByKey(key: string): AgentDescriptor | undefined {
  const { primary, specialists, classifier } = activeInstance.agents;
  if (key === primary.key) return primary;
  if (classifier && key === classifier.key) return classifier;
  return specialists.find((s) => s.key === key);
}
