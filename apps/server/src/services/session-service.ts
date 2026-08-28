import type {
  ActiveStepContext,
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

  getActiveStepContext(sessionId: string): ActiveStepContext | null {
    const snapshot = this.sessionRepo.getSessionSnapshot(sessionId);
    if (!snapshot) return null;

    const activeNode = snapshot.path.find((node) => node.status === 'current');
    const activeBlock = snapshot.lessonProgress?.activeBlockId
      ? snapshot.lesson.blocks.find((block) => block.id === snapshot.lessonProgress?.activeBlockId)
      : undefined;
    const activeFrame = this.sessionRepo.peekActiveFrame(sessionId);

    return {
      sessionId,
      courseId: snapshot.courseId ?? snapshot.lesson.courseId,
      lessonId: snapshot.lesson.id,
      lessonTitle: snapshot.lesson.title,
      knowledgeNodeId: snapshot.lesson.knowledgeNodeId,
      activeBlockId: snapshot.lessonProgress?.activeBlockId ?? null,
      activeBlockType: activeBlock?.type,
      pathNodeId: activeNode?.id,
      pathNodeType: activeNode?.type,
      detourDepth: activeFrame?.depth ?? 0,
      detour: activeNode?.type === 'detour',
    };
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

    const courseId = snapshot.courseId ?? snapshot.lesson.courseId;
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
    baseVersion: number,
    options?: { deferNextLesson?: boolean }
  ): Promise<{ path: LearningPathNode[]; newVersion: number }> {
    const snapshot = this.sessionRepo.getSessionSnapshot(sessionId);
    if (!snapshot) {
      throw new NotFoundError('Session', sessionId);
    }

    const activeNode = snapshot.path.find((n) => n.status === 'current');
    const isDetour = activeNode?.type === 'detour';
    const nextNode = !isDetour
      ? snapshot.path.slice(snapshot.path.findIndex((node) => node.status === 'current') + 1).find((node) => node.status === 'upcoming')
      : undefined;
    const deferNextLesson = Boolean(options?.deferNextLesson && nextNode && this.coordinator);
    let nextLesson: Lesson | undefined;
    if (nextNode && this.coordinator && !deferNextLesson) {
      nextLesson = await this.coordinator.ensureLessonForNode(
        sessionId,
        snapshot.courseId ?? snapshot.lesson.courseId,
        nextNode.knowledgeNodeId,
        nextNode.title
      );
    }

    const completionOptions = {
      popDetourFrame: isDetour,
      ...(nextNode && this.coordinator && !isDetour && !deferNextLesson
        ? { nextLessonId: nextLesson!.id }
        : {}),
    };
    const result = this.sessionRepo.completeCurrentNode(sessionId, baseVersion, completionOptions);

    const nextSnapshot = this.sessionRepo.getSessionSnapshot(sessionId);
    if (
      nextSnapshot &&
      nextSnapshot.lesson.id !== snapshot.lesson.id &&
      !nextSnapshot.lesson.id.startsWith('empty-lesson-')
    ) {
      const activatedEvent: LessonActivatedEventData = {
        lesson: nextSnapshot.lesson,
        previousLessonId: snapshot.lesson.id,
      };
      this.eventBus.publish(sessionId, 'lesson.activated', activatedEvent);

      const lessonUpdate: LessonUpdatedEventData = {
        lessonId: nextSnapshot.lesson.id,
        version: nextSnapshot.lesson.version,
        changes: {
          title: nextSnapshot.lesson.title,
          objective: nextSnapshot.lesson.objective,
          status: nextSnapshot.lesson.status,
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

    if (deferNextLesson && nextNode && this.coordinator) {
      nextLesson = await this.coordinator.ensureLessonForNode(
        sessionId,
        snapshot.courseId ?? snapshot.lesson.courseId,
        nextNode.knowledgeNodeId,
        nextNode.title
      );
      const currentSnapshot = this.sessionRepo.getSessionSnapshot(sessionId);
      const stillOnNextNode = currentSnapshot?.path.some(
        (node) => node.id === nextNode.id && node.status === 'current'
      );
      if (stillOnNextNode) {
        this.sessionRepo.setActiveLesson(sessionId, nextLesson.id);
        this.eventBus.publish(sessionId, 'lesson.activated', {
          lesson: nextLesson,
          previousLessonId: snapshot.lesson.id,
        });
        this.eventBus.publish(sessionId, 'lesson.updated', {
          lessonId: nextLesson.id,
          version: nextLesson.version,
          changes: {
            title: nextLesson.title,
            objective: nextLesson.objective,
            status: nextLesson.status,
          },
        });
      }
    }

    return { path: result.path, newVersion: result.newVersion };
  }
}
