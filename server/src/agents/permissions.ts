import type { Agent, AgentPermissions, PermissionDecision, Project, SqlRisk, Task } from '@schemaforge/shared';
import { DEFAULT_PERMISSIONS } from '@schemaforge/shared';
import { settings } from '../store/repos.js';
import { pj } from '../store/db.js';
import type { ToolDefinition } from './tools.js';

export type PolicyLayer = Partial<AgentPermissions>;

/** Policies can be set at workspace and project level (stored in settings) in addition to the agent. */
export function getPolicy(scope: 'workspace' | 'project', id: string): PolicyLayer {
  return pj<PolicyLayer>(settings.get(`policy:${scope}:${id}`), {});
}

export function setPolicy(scope: 'workspace' | 'project', id: string, layer: PolicyLayer | null): void {
  settings.set(`policy:${scope}:${id}`, layer ? JSON.stringify(layer) : null);
}

const ORDER: PermissionDecision[] = ['allow', 'ask', 'deny'];

/** Most restrictive decision wins across layers. */
function strictest(...decisions: (PermissionDecision | undefined)[]): PermissionDecision | undefined {
  let out: PermissionDecision | undefined;
  for (const d of decisions) {
    if (!d) continue;
    if (!out || ORDER.indexOf(d) > ORDER.indexOf(out)) out = d;
  }
  return out;
}

function defaultToolDecision(tool: ToolDefinition): PermissionDecision {
  switch (tool.risk) {
    case 'read': return 'allow';
    case 'write': return 'ask';
    case 'exec': return 'ask';
    case 'sql': return 'allow'; // refined by sql policy
  }
}

export interface EffectiveDecision {
  decision: PermissionDecision;
  reason: string;
}

/**
 * Resolve the effective decision for a tool call by combining workspace, project, agent and task layers.
 * SQL tools use the SQL risk buckets; other tools use tool-level entries.
 */
export function resolveDecision(opts: { tool: ToolDefinition; sqlRisk?: SqlRisk; agent: Agent; project: Project; task: Task }): EffectiveDecision {
  const { tool, sqlRisk, agent, project, task } = opts;
  const layers: { name: string; policy: PolicyLayer }[] = [
    { name: 'workspace', policy: getPolicy('workspace', project.workspaceId) },
    { name: 'project', policy: getPolicy('project', project.id) },
    { name: 'agent', policy: agent.permissions },
    { name: 'task', policy: ((task.context as { permissions?: PolicyLayer }).permissions ?? {}) },
  ];

  const explicit: { name: string; decision: PermissionDecision }[] = [];
  for (const l of layers) {
    const toolDecision = l.policy.tools?.[tool.name];
    if (toolDecision) explicit.push({ name: `${l.name} tool policy`, decision: toolDecision });
    if (tool.risk === 'sql' && sqlRisk) {
      const d = l.policy.sql?.[sqlRisk];
      if (d) explicit.push({ name: `${l.name} sql.${sqlRisk}`, decision: d });
    }
  }
  if (explicit.length === 0) {
    if (tool.risk === 'sql' && sqlRisk) {
      const d = agent.permissions.sql?.[sqlRisk] ?? DEFAULT_PERMISSIONS.sql[sqlRisk];
      return { decision: d, reason: `agent sql.${sqlRisk}` };
    }
    const d = strictest(agent.permissions.defaultTool, defaultToolDecision(tool)) ?? defaultToolDecision(tool);
    return { decision: d, reason: `default for ${tool.risk} tools` };
  }
  const decision = strictest(...explicit.map((e) => e.decision))!;
  const from = explicit.filter((e) => e.decision === decision).map((e) => e.name).join(', ');
  return { decision, reason: from };
}
