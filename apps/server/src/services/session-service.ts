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
}
