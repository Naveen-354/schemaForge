import type { KnowledgeEntry } from '@schemaforge/shared';
import { knowledge } from '../store/repos.js';

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'have', 'has', 'not', 'all', 'any', 'into', 'table', 'tables', 'database', 'schema', 'query', 'show', 'find', 'what', 'which', 'how', 'why', 'does', 'should']);

export function terms(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}

/**
 * Selective knowledge retrieval: score entries by term overlap so only relevant knowledge reaches a model.
 * Agent-scoped memory is only visible to that agent; user preferences are global.
 */
export function searchKnowledge(projectId: string, query: string, limit = 6, agentId?: string | null): KnowledgeEntry[] {
  const all = knowledge.list({ projectId }).filter((k) => k.scope !== 'agent' || k.agentId === agentId);
  const qs = terms(query);
  if (qs.length === 0) return all.slice(0, limit);
  const scored = all.map((k) => {
    const hay = `${k.title} ${k.category} ${k.tags.join(' ')} ${k.content}`.toLowerCase();
    let score = 0;
    for (const t of qs) {
      if (k.title.toLowerCase().includes(t)) score += 3;
      if (k.tags.some((tag) => tag.toLowerCase().includes(t))) score += 2;
      if (hay.includes(t)) score += 1;
    }
    return { k, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.k);
}
