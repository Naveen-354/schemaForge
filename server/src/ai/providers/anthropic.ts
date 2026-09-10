import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, CompletionRequest, CompletionResponse, CompletionUsage, ToolCall } from '../types.js';
import { settings } from '../../store/repos.js';

// USD per 1M tokens (input, output). Unknown models fall back to Opus-tier pricing.
const PRICING: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic';
  readonly defaultModel = 'claude-opus-5';

  private apiKey(): string | null {
    return settings.getSecret('anthropic.apiKey') ?? process.env.ANTHROPIC_API_KEY ?? null;
  }

  isConfigured(): boolean {
    return !!this.apiKey() || !!process.env.ANTHROPIC_AUTH_TOKEN;
  }

  models(): string[] {
    return Object.keys(PRICING);
  }

  baseUrl(): string | null {
    return process.env.ANTHROPIC_BASE_URL ?? null;
  }

  private client(): Anthropic {
    const key = this.apiKey();
    return key ? new Anthropic({ apiKey: key }) : new Anthropic();
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const client = this.client();
    const started = Date.now();
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content.map((p): Anthropic.ContentBlockParam => {
        if (p.type === 'text') return { type: 'text', text: p.text || '(empty)' };
        if (p.type === 'tool_use') return { type: 'tool_use', id: p.id, name: p.name, input: p.input };
        return { type: 'tool_result', tool_use_id: p.toolUseId, content: p.content || '(no output)', is_error: p.isError };
      }),
    }));
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const useFallbacks = /^claude-(opus-5|fable)/.test(req.model) && settings.get('anthropic.fallbacks') !== 'off';
    const params = {
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      system: [{ type: 'text' as const, text: req.system, cache_control: { type: 'ephemeral' as const } }],
      messages,
      tools,
    };

    let response: Anthropic.Message;
    if (useFallbacks) {
      // Server-side refusal fallback: if a safety classifier declines, the API re-runs on a fallback model.
      const beta = client.beta.messages as unknown as { create(p: unknown, o?: unknown): Promise<Anthropic.Message> };
      response = await beta.create(
        { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        { signal: req.signal },
      );
    } else {
      response = await client.messages.create(params, { signal: req.signal });
    }

    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    const usage: CompletionUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    let stopReason: CompletionResponse['stopReason'] = 'other';
    let note: string | undefined;
    switch (response.stop_reason) {
      case 'end_turn': stopReason = 'end_turn'; break;
      case 'tool_use': stopReason = 'tool_use'; break;
      case 'max_tokens': stopReason = 'max_tokens'; break;
      case 'refusal': {
        stopReason = 'refusal';
        const details = (response as unknown as { stop_details?: { category?: string | null; explanation?: string } }).stop_details;
        note = `Model declined the request${details?.category ? ` (category: ${details.category})` : ''}${details?.explanation ? `: ${details.explanation}` : ''}`;
        break;
      }
      default: stopReason = toolCalls.length ? 'tool_use' : 'end_turn';
    }
    return { text, toolCalls, stopReason, usage, model: response.model, latencyMs: Date.now() - started, note };
  }

  estimateCostUsd(model: string, usage: CompletionUsage): number {
    const [inp, out] = PRICING[model] ?? [5, 25];
    const cacheRead = (usage.cacheReadTokens ?? 0) * inp * 0.1;
    const cacheWrite = (usage.cacheWriteTokens ?? 0) * inp * 1.25;
    return (usage.inputTokens * inp + usage.outputTokens * out + cacheRead + cacheWrite) / 1_000_000;
  }
}
