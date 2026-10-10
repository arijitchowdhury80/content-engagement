/** Identity passed out-of-band to host transport. It is never serialized into the request. */
export interface OrchestratorRuntimeContext {
  widgetInstanceId: string;
  turnId: string;
  answerSegmentId: string;
}

/** Explicit host-owned transport boundary for primary orchestrator requests. */
export type OrchestratorTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
  runtimeContext?: OrchestratorRuntimeContext,
) => Promise<Response>;

let transport: OrchestratorTransport | null = null;

export function setOrchestratorTransport(next: OrchestratorTransport | null): void {
  transport = typeof next === 'function' ? next : null;
}

export function getOrchestratorTransport(): OrchestratorTransport | undefined {
  return transport ?? undefined;
}
