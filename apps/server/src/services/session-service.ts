import type { LearningPathNode, LearningPathPatch, LearningSessionSnapshot, PathPatchEventData } from '@opentutor/protocol';
import type { SessionRepository } from '@opentutor/database';
import type { EventBus } from '../events/event-bus.ts';

export class SessionService {
  private readonly sessionRepo: SessionRepository;
  private readonly eventBus: EventBus;

  constructor(sessionRepo: SessionRepository, eventBus: EventBus) {
    this.sessionRepo = sessionRepo;
    this.eventBus = eventBus;
  }

  getSnapshot(sessionId: string): LearningSessionSnapshot | null {
    return this.sessionRepo.getSessionSnapshot(sessionId);
  }

  applyPathPatches(
    sessionId: string,
    baseVersion: number,
    patches: LearningPathPatch[]
  ): { path: LearningPathNode[]; newVersion: number } {
    const result = this.sessionRepo.applyPathPatches(sessionId, baseVersion, patches);

    const eventData: PathPatchEventData = {
      baseVersion,
      version: result.newVersion,
      patches,
    };

    this.eventBus.publish(sessionId, 'path.patch', eventData);
    return result;
  }

  insertDetour(
    sessionId: string,
    baseVersion: number,
    detour: { id: string; knowledgeNodeId: string; title: string; note?: string }
  ): { path: LearningPathNode[]; newVersion: number } {
    const result = this.sessionRepo.insertDetour(sessionId, baseVersion, detour);
    const eventData: PathPatchEventData = {
      baseVersion,
      version: result.newVersion,
      patches: [
        {
          op: 'insert_node',
          node: {
            id: detour.id,
            knowledgeNodeId: detour.knowledgeNodeId,
            title: detour.title,
            type: 'detour',
            status: 'current',
            position: 0,
            note: detour.note,
          },
        },
      ],
    };
    this.eventBus.publish(sessionId, 'path.patch', eventData);
    return result;
  }

  completeCurrentNode(
    sessionId: string,
    baseVersion: number
  ): { path: LearningPathNode[]; newVersion: number } {
    const result = this.sessionRepo.completeCurrentNode(sessionId, baseVersion);
    const eventData: PathPatchEventData = {
      baseVersion,
      version: result.newVersion,
      patches: [],
    };
    this.eventBus.publish(sessionId, 'path.patch', eventData);
    return result;
  }
}
