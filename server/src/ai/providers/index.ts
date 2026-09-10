import type { ProviderId, ProviderStatus } from '@schemaforge/shared';
import type { AiProvider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAiCompatibleProvider } from './openai.js';
import { HeuristicProvider } from './heuristic.js';

const providers: Record<ProviderId, AiProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAiCompatibleProvider(),
  heuristic: new HeuristicProvider(),
};

export function getProvider(id: ProviderId): AiProvider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export function providerStatuses(): ProviderStatus[] {
  return Object.values(providers).map((p) => ({
    id: p.id, name: p.name, configured: p.isConfigured(), baseUrl: p.baseUrl(), defaultModel: p.defaultModel, models: p.models(),
  }));
}

/** Provider used for newly created agents when none is specified: the first configured "real" model, else heuristic. */
export function defaultProviderId(): ProviderId {
  if (providers.anthropic.isConfigured()) return 'anthropic';
  if (providers.openai.isConfigured() && process.env.OPENAI_API_KEY) return 'openai';
  return 'heuristic';
}
