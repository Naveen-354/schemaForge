import type { ProviderId } from '@schemaforge/shared';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; name: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: ContentPart[];
}

export interface CompletionRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CompletionResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage: CompletionUsage;
  model: string;
  latencyMs: number;
  /** Provider-specific note (e.g. refusal category) surfaced to the activity log. */
  note?: string;
}

export interface AiProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly defaultModel: string;
  isConfigured(): boolean;
  models(): string[];
  baseUrl(): string | null;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  estimateCostUsd(model: string, usage: CompletionUsage): number;
}
