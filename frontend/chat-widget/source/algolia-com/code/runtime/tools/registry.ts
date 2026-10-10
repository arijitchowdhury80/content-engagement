/**
 * tools/registry — thin re-export of the ToolHandler and ToolRegistry types
 * from agentStudio so callers can import them without depending on the full
 * network client module.
 *
 * runToolLoop lives in agentStudio.ts because it needs the network primitives;
 * this module provides the types needed by feature modules (useChat,
 * personAgent) without creating a circular dependency.
 */
export type { ToolHandler, ToolRegistry, RunToolLoopOptions } from '../shared/agentStudio';
