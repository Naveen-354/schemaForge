import { EventEmitter } from 'node:events';
import type { EventLevel, EventType, SfEvent } from '@schemaforge/shared';
import { events as eventRepo } from './store/repos.js';
import { newId, now } from './store/db.js';

export interface EmitInput {
  type: EventType;
  message: string;
  level?: EventLevel;
  workspaceId: string;
  projectId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  connectionId?: string | null;
  data?: Record<string, unknown> | null;
}

class EventBus extends EventEmitter {
  emitEvent(input: EmitInput): SfEvent {
    const e = eventRepo.insert({
      id: newId(),
      type: input.type,
      level: input.level ?? 'info',
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      connectionId: input.connectionId ?? null,
      message: input.message,
      data: input.data ?? null,
      createdAt: now(),
    });
    this.emit('event', e);
    return e;
  }

  /** Lightweight state-change notification (not persisted): tells clients to refetch an entity. */
  notify(entity: 'task' | 'agent' | 'approval' | 'artifact' | 'connection' | 'project' | 'knowledge' | 'run', id: string, projectId?: string | null): void {
    this.emit('change', { entity, id, projectId: projectId ?? null, at: now() });
  }
}

export const bus = new EventBus();
bus.setMaxListeners(100);
