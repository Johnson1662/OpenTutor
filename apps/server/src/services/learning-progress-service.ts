import type {
  LessonProgressEventData,
  LessonStepProgress,
  UserKnowledgeState,
} from '@opentutor/protocol';
import {
  NotFoundError,
  BlockNotFoundError,
  ProgressStateConflictError,
  type LessonProgressRepository,
  type LessonRepository,
} from '@opentutor/database';
import type { SessionService } from './session-service.ts';
import type { EventBus } from '../events/event-bus.ts';

export interface AdvanceLessonProgressResponse {
  progress: LessonStepProgress;
  snapshot: ReturnType<SessionService['getSnapshot']>;
}

export class LearningProgressService {
  private readonly sessionService: SessionService;
  private readonly eventBus: EventBus;
  private readonly progressRepo?: LessonProgressRepository;
  private readonly lessonRepo?: LessonRepository;

  constructor(
    sessionService: SessionService,
    eventBus: EventBus,
    progressRepo?: LessonProgressRepository,
    lessonRepo?: LessonRepository
  ) {
    this.sessionService = sessionService;
    this.eventBus = eventBus;
    this.progressRepo = progressRepo;
    this.lessonRepo = lessonRepo;
  }

  getProgress(sessionId: string, lessonId?: string): LessonStepProgress {
    const snapshot = this.sessionService.getSnapshot(sessionId);
    if (!snapshot) throw new NotFoundError('Session', sessionId);

    const targetLessonId = lessonId ?? snapshot.lesson.id;
    if (targetLessonId === snapshot.lesson.id && snapshot.lessonProgress) {
      return snapshot.lessonProgress;
    }
    if (!this.progressRepo) {
      throw new Error('Lesson progress persistence is not configured');
    }
    const lesson =
      targetLessonId === snapshot.lesson.id
        ? snapshot.lesson
        : this.lessonRepo?.getLesson(targetLessonId);
    if (!lesson) throw new NotFoundError('Lesson', targetLessonId);
    return this.progressRepo.getOrCreate(
      sessionId,
      targetLessonId,
      lesson.blocks.map((block) => block.id)
    );
  }

  activateBlock(sessionId: string, lessonId: string, blockId: string): LessonStepProgress {
    if (!this.progressRepo || !this.lessonRepo) {
      throw new Error('Lesson progress persistence is not configured');
    }

    const snapshot = this.sessionService.getSnapshot(sessionId);
    if (!snapshot) throw new NotFoundError('Session', sessionId);
    if (snapshot.lesson.id !== lessonId) {
      throw new Error(`LESSON_NOT_ACTIVE: ${lessonId}`);
    }
    if (!snapshot.lesson.blocks.some((block) => block.id === blockId)) {
      throw new BlockNotFoundError(blockId);
    }

    const progress =
      snapshot.lessonProgress ??
      this.progressRepo.getOrCreate(
        sessionId,
        lessonId,
        snapshot.lesson.blocks.map((block) => block.id)
      );
    const next = this.progressRepo.activate(sessionId, lessonId, blockId);
    if (next.version !== progress.version) {
      const progressEvent: LessonProgressEventData = {
        ...next,
        completed: next.activeBlockId === null,
      };
      this.eventBus.publish(sessionId, 'lesson.progress', progressEvent);
    }
    return next;
  }

  async advance(
    sessionId: string,
    lessonId: string,
    expectedVersion: number,
    activeBlockId: string | null,
    restart = false
  ): Promise<AdvanceLessonProgressResponse> {
    if (!this.progressRepo || !this.lessonRepo) {
      throw new Error('Lesson progress persistence is not configured');
    }

    const snapshot = this.sessionService.getSnapshot(sessionId);
    if (!snapshot) throw new NotFoundError('Session', sessionId);
    if (snapshot.lesson.id !== lessonId) {
      throw new Error(`LESSON_NOT_ACTIVE: ${lessonId}`);
    }

    const progress =
      snapshot.lessonProgress ??
      this.progressRepo.getOrCreate(
        sessionId,
        lessonId,
        snapshot.lesson.blocks.map((block) => block.id)
      );
    const blockIds = snapshot.lesson.blocks.map((block) => block.id);
    if (activeBlockId !== null && !blockIds.includes(activeBlockId)) {
      throw new BlockNotFoundError(activeBlockId);
    }
    if (restart && progress.activeBlockId !== activeBlockId) {
      throw new ProgressStateConflictError(sessionId, lessonId, activeBlockId, progress.activeBlockId);
    }
    const result = restart
      ? this.progressRepo.restart(sessionId, lessonId, expectedVersion, blockIds, activeBlockId)
      : this.progressRepo.advance(sessionId, lessonId, expectedVersion, activeBlockId, blockIds);

    const progressEvent: LessonProgressEventData = {
      ...result.progress,
      completed: result.completed,
    };
    this.eventBus.publish(sessionId, 'lesson.progress', progressEvent);

    const nextSnapshot = this.sessionService.getSnapshot(sessionId);
    return { progress: result.progress ?? progress, snapshot: nextSnapshot };
  }

  onKnowledgeStateUpdated(sessionId: string, state: UserKnowledgeState): void {
    const snapshot = this.sessionService.getSnapshot(sessionId);
    if (!snapshot) return;

    const currentNode = snapshot.path.find((n) => n.status === 'current');
    if (!currentNode || currentNode.knowledgeNodeId !== state.knowledgeNodeId) return;

    if (state.status === 'mastered') {
      void this.sessionService.completeCurrentNode(sessionId, snapshot.pathVersion).catch((error) => {
        this.eventBus.publish(sessionId, 'error', { error: error instanceof Error ? error.message : String(error) });
      });
    }
  }
}
