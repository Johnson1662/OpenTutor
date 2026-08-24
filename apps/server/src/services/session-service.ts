import type {
  LearningPathNode,
  LearningPathPatch,
  LearningSessionSnapshot,
  LessonActivatedEventData,
  LessonUpdatedEventData,
  PathPatchEventData,
  Lesson,
} from '@opentutor/protocol';
import { NotFoundError, type SessionRepository } from '@opentutor/database';
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
    detour: { id: string; knowledgeNodeId: string; title: string; note?: string },
    options?: { activeLessonId?: string; diagnosisId?: string }
  ): Promise<{ path: LearningPathNode[]; newVersion: number }> {
    const snapshot = this.sessionRepo.getSessionSnapshot(sessionId);
    if (!snapshot) {
      throw new NotFoundError('Session', sessionId);
    }

    const courseId = snapshot.courseId ?? 'transformer';
    const activeNode = snapshot.path.find((n) => n.status === 'current');

    // 1. Generate/ensure detour lesson asynchronously before entering the DB transaction
    let detourLesson: Lesson | undefined;
    if (this.coordinator) {
      detourLesson = await this.coordinator.ensureLessonForNode(
        sessionId,
        courseId,
        detour.knowledgeNodeId,
        detour.title
      );
    }

    // 2. Perform atomic domain transaction: validate pathVersion, push frame with diagnosisId, switch active lesson, patch path
    const result = this.sessionRepo.insertDetour(sessionId, baseVersion, detour, {
      activeLessonId: options?.activeLessonId ?? detourLesson?.id,
      frame: activeNode
        ? {
          parentPathNodeId: activeNode.id,
          savedLessonId: snapshot.lesson.id,
          diagnosisId: options?.diagnosisId ?? null,
        }
        : undefined,
    });
    if (detourLesson) {
      const activatedEvent: LessonActivatedEventData = {
        lesson: detourLesson,
        previousLessonId: snapshot.lesson.id,
      };
      this.eventBus.publish(sessionId, 'lesson.activated', activatedEvent);

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

    const eventData: PathPatchEventData = {
      baseVersion,
      version: result.newVersion,
      patches: result.patches,
    };
    this.eventBus.publish(sessionId, 'path.patch', eventData);

    return { path: result.path, newVersion: result.newVersion };
  }

  async completeCurrentNode(
    sessionId: string,
    baseVersion: number
  ): Promise<{ path: LearningPathNode[]; newVersion: number }> {
    const snapshot = this.sessionRepo.getSessionSnapshot(sessionId);
    if (!snapshot) {
      throw new NotFoundError('Session', sessionId);
    }

    const activeNode = snapshot.path.find((n) => n.status === 'current');
    const isDetour = activeNode?.type === 'detour';

    // 1. Perform atomic domain transaction: validate pathVersion, pop frame if detour, restore saved lesson, advance path
    const result = this.sessionRepo.completeCurrentNode(sessionId, baseVersion, {
      popDetourFrame: isDetour,
    });

    // 2. If a detour completed and a previous lesson was restored, publish lesson.activated
    if (result.resumedLessonId) {
      const resumedSnapshot = this.sessionRepo.getSessionSnapshot(sessionId);
      if (resumedSnapshot && resumedSnapshot.lesson.id === result.resumedLessonId) {
        const activatedEvent: LessonActivatedEventData = {
          lesson: resumedSnapshot.lesson,
          previousLessonId: snapshot.lesson.id,
        };
        this.eventBus.publish(sessionId, 'lesson.activated', activatedEvent);

        const lessonUpdate: LessonUpdatedEventData = {
          lessonId: resumedSnapshot.lesson.id,
          version: resumedSnapshot.lesson.version,
          changes: {
            title: resumedSnapshot.lesson.title,
            objective: resumedSnapshot.lesson.objective,
            status: resumedSnapshot.lesson.status,
          },
        };
        this.eventBus.publish(sessionId, 'lesson.updated', lessonUpdate);
      }
    }

    const eventData: PathPatchEventData = {
      baseVersion,
      version: result.newVersion,
      patches: result.patches,
    };
    this.eventBus.publish(sessionId, 'path.patch', eventData);

    return { path: result.path, newVersion: result.newVersion };
  }
}
