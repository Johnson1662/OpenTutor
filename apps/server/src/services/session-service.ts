import type {
  LearningPathNode,
  LearningPathPatch,
  LearningSessionSnapshot,
  LessonUpdatedEventData,
  PathPatchEventData,
} from '@opentutor/protocol';
import type { SessionRepository } from '@opentutor/database';
import type { LearningSessionCoordinator } from '@opentutor/lesson-core';
import type { EventBus } from '../events/event-bus.ts';

export class SessionService {
  private readonly sessionRepo: SessionRepository;
  private readonly coordinator?: LearningSessionCoordinator;
  private readonly eventBus: EventBus;

  constructor(
    sessionRepo: SessionRepository,
    eventBus: EventBus,
    coordinator?: LearningSessionCoordinator
  ) {
    this.sessionRepo = sessionRepo;
    this.coordinator = coordinator;
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

  async insertDetour(
    sessionId: string,
    baseVersion: number,
    detour: { id: string; knowledgeNodeId: string; title: string; note?: string }
  ): Promise<{ path: LearningPathNode[]; newVersion: number }> {
    const snapshot = this.sessionRepo.getSessionSnapshot(sessionId);
    const activeNode = snapshot?.path.find((n) => n.status === 'current');

    // 1. If coordinator is present, ensure/generate the detour lesson and switch active lesson
    if (this.coordinator && snapshot && activeNode) {
      const { detourLesson } = await this.coordinator.handleDetour(
        sessionId,
        'transformer',
        detour.knowledgeNodeId,
        detour.title,
        activeNode.id,
        snapshot.lesson.id
      );

      this.sessionRepo.setActiveLesson(sessionId, detourLesson.id);

      const lessonUpdate: LessonUpdatedEventData = {
        lessonId: detourLesson.id,
        version: detourLesson.version,
        changes: {
          title: detourLesson.title,
          objective: detourLesson.objective,
          status: detourLesson.status,
        },
      };
      this.eventBus.publish(sessionId, 'lesson.updated', lessonUpdate);
    }

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

  async completeCurrentNode(
    sessionId: string,
    baseVersion: number
  ): Promise<{ path: LearningPathNode[]; newVersion: number }> {
    const snapshot = this.sessionRepo.getSessionSnapshot(sessionId);
    const activeNode = snapshot?.path.find((n) => n.status === 'current');

    // 1. If completing a detour, restore previous lesson on the canvas
    if (this.coordinator && activeNode?.type === 'detour') {
      const { resumedLesson } = await this.coordinator.handleResume(sessionId, 'transformer');
      if (resumedLesson) {
        this.sessionRepo.setActiveLesson(sessionId, resumedLesson.id);

        const lessonUpdate: LessonUpdatedEventData = {
          lessonId: resumedLesson.id,
          version: resumedLesson.version,
          changes: {
            title: resumedLesson.title,
            objective: resumedLesson.objective,
            status: resumedLesson.status,
          },
        };
        this.eventBus.publish(sessionId, 'lesson.updated', lessonUpdate);
      }
    }

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
