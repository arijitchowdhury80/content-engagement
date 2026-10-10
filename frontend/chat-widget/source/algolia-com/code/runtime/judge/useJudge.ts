/**
 * useJudge — auto-fires the live judge once an assistant answer finishes
 * streaming, and exposes its verdict.
 *
 * Driven by a single `JudgeTarget` rather than the whole turn list, so one
 * hook instance can track a moving target. Each distinct `id` fires and caches
 * independently, so both segments in a handed-off turn each get judged once.
 * A ref-backed cache guarantees a re-render never re-fires a call for an id
 * that's already judging/done/error.
 *
 * Judge config (mode, url, apiKey, agentId) is read from the IS renderState
 * via `useWidgetState()` — the chatConfidence leaf widget publishes it into
 * `renderState.chatConfidence`. When no chatConfidence widget is registered,
 * `judgeAnswer` falls back to the global env singleton (`getRuntimeEnv()`) for
 * backward compat with attribute-based judge config on `<algolia-chat>`.
 */
import { useEffect, useRef, useState } from 'react';
import {
  judgeAnswer,
  isJudgeConfigured,
  type JudgeRuntimeConfig,
} from './hostedJudgeClient';
import { useWidgetState } from '../chat/widgetContext';
import type { JudgeVerdict } from './types';
import type { AnswerSegment } from '../chat/types';
import type { ChatConfidenceDescriptor } from '../connectChatConfidence';
import { cleanVisibleAnswerText } from '../chat/visibleAnswer';

export type JudgeStatus = 'idle' | 'judging' | 'done' | 'error';

export interface UseJudgeResult {
  status: JudgeStatus;
  verdict?: JudgeVerdict;
}

/** The answer to judge: a stable identity + the question it answered + its segment. */
export interface JudgeTarget {
  /** Stable per-answer key, e.g. `${turnId}:${segment.agent}`. */
  id: string;
  question: string;
  segment: AnswerSegment;
}

interface CacheEntry {
  status: JudgeStatus;
  verdict?: JudgeVerdict;
}

function toJudgeConfig(
  descriptor: ChatConfidenceDescriptor | null,
): JudgeRuntimeConfig | undefined {
  if (!descriptor) return undefined;
  return {
    mode: descriptor.mode,
    url: descriptor.url,
    apiKey: descriptor.apiKey,
    agents: descriptor.agents,
  };
}

export function useJudge(target: JudgeTarget | null): UseJudgeResult {
  const { confidence } = useWidgetState();
  // Gate every judge call on judging being explicitly configured. Without this
  // guard, an unconfigured widget POSTs to http://localhost:8788 after every
  // answer, and the badge renders an "unavailable" state the host never asked for.
  const effectiveTarget = isJudgeConfigured(confidence) ? target : null;
  const confidenceRef = useRef(confidence);
  // Keep the ref up to date after every render so async judge callbacks always
  // read the latest confidence config without being listed as effect deps.
  useEffect(() => {
    confidenceRef.current = confidence;
  });

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const [, setTick] = useState(0);

  const id = effectiveTarget?.id;
  const status = effectiveTarget?.segment.status;
  const text = effectiveTarget?.segment.text;

  useEffect(() => {
    if (!effectiveTarget || !id) return;
    if (status !== 'success' || !text?.trim()) return;
    if (cacheRef.current.has(id)) return;

    const question = effectiveTarget.question;
    const answer = cleanVisibleAnswerText(effectiveTarget.segment.text);
    const hits = effectiveTarget.segment.rawHits ?? [];
    const judgeConfig = toJudgeConfig(confidenceRef.current);
    const panelId = effectiveTarget.segment.agent;

    cacheRef.current.set(id, { status: 'judging' });
    setTick((n) => n + 1);

    judgeAnswer({ question, answer, hits, panelId }, fetch, judgeConfig)
      .then((verdict) => {
        cacheRef.current.set(id, {
          status: verdict.error ? 'error' : 'done',
          verdict,
        });
        setTick((n) => n + 1);

        // Notify standalone <algolia-confidence-badge> elements rendered by
        // chatConfidenceWidget({ container }) outside the chat shadow root.
        if (!verdict.error) {
          try {
            document.dispatchEvent(
              new CustomEvent('algolia-verdict', {
                detail: { verdict, question },
                bubbles: false,
              }),
            );
          } catch {
            // Guard against SSR / non-browser environments.
          }
        }
      })
      .catch((err: unknown) => {
        cacheRef.current.set(id, {
          status: 'error',
          verdict: {
            panelId: effectiveTarget.segment.agent,
            dims: { grounding: 0, coverage: 0, depth: 0, relevance: 0 },
            synthesizedScore: 0,
            composite: 0,
            preGateScore: 0,
            gateTripped: false,
            borderline: false,
            flaggedClaims: [],
            perJudge: [],
            rationale: '',
            error: err instanceof Error ? err.message : String(err),
          },
        });
        setTick((n) => n + 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status, text]);

  if (!id) return { status: 'idle' };
  // Reading the ref during render is intentional: cacheRef backs the verdict
  // cache that is only written in effects/async callbacks, never mid-render.
  // setTick() in those callbacks triggers the re-render that reads this.
  // eslint-disable-next-line react-hooks/refs
  const cached = cacheRef.current.get(id);
  if (!cached) return { status: 'idle' };
  return cached;
}
