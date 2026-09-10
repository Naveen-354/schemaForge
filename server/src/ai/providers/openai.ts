import type { AiProvider, CompletionRequest, CompletionResponse, CompletionUsage, ToolCall } from '../types.js';
import { settings } from '../../store/repos.js';

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * OpenAI-compatible chat completions provider. Works with OpenAI, Ollama (`http://localhost:11434/v1`),
 * LM Studio, vLLM, OpenRouter and similar endpoints. Uses plain fetch to keep the dependency surface small.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI-compatible';

  get defaultModel(): string {
    return settings.get('openai.defaultModel') ?? process.env.OPENAI_MODEL ?? 'gpt-4.1';
  }

  private apiKey(): string | null {
    return settings.getSecret('openai.apiKey') ?? process.env.OPENAI_API_KEY ?? null;
  }

  baseUrl(): string {
    return (settings.get('openai.baseUrl') ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  isConfigured(): boolean {
    // Local servers (Ollama etc.) do not need a key.
    return !!this.apiKey() || /localhost|127\.0\.0\.1/.test(this.baseUrl());
  }

  models(): string[] {
    const extra = (settings.get('openai.models') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return [...new Set([this.defaultModel, ...extra])];
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    const messages: OaiMessage[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
        const calls = m.content.filter((p) => p.type === 'tool_use').map((p) => {
          const t = p as { id: string; name: string; input: Record<string, unknown> };
          return { id: t.id, type: 'function' as const, function: { name: t.name, arguments: JSON.stringify(t.input) } };
        });
        messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      } else {
        for (const p of m.content) {
          if (p.type === 'text') messages.push({ role: 'user', content: p.text });
          else if (p.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: p.toolUseId, content: p.content });
        }
      }
    }
    const body = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 8000,
      tools: req.tools.length
        ? req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
        : undefined,
    };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = this.apiKey();
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await fetch(`${this.baseUrl()}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI-compatible API error ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json() as {
      model?: string;
      choices: { message: OaiMessage; finish_reason: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((c) => {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function.arguments || '{}'); } catch { input = { _raw: c.function.arguments }; }
      return { id: c.id, name: c.function.name, input };
    });
    const finish = choice?.finish_reason;
    const stopReason: CompletionResponse['stopReason'] = toolCalls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end_turn';
    return {
      text: msg?.content ?? '',
      toolCalls,
      stopReason,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      model: data.model ?? req.model,
      latencyMs: Date.now() - started,
    };
  }

  estimateCostUsd(_model: string, usage: CompletionUsage): number {
    const inp = Number(settings.get('openai.priceInputPerM') ?? 0);
    const out = Number(settings.get('openai.priceOutputPerM') ?? 0);
    return (usage.inputTokens * inp + usage.outputTokens * out) / 1_000_000;
  }
}
