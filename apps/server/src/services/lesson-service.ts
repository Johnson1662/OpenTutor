import type { Lesson, LessonPatch, LessonPatchEventData } from '@opentutor/protocol';
import { ActiveBlockRemovalError, type LessonProgressRepository, type LessonRepository } from '@opentutor/database';
import type { EventBus } from '../events/event-bus.ts';

export class LessonService {
  private readonly lessonRepo: LessonRepository;
  private readonly eventBus: EventBus;
  private readonly progressRepo?: LessonProgressRepository;

  constructor(lessonRepo: LessonRepository, eventBus: EventBus, progressRepo?: LessonProgressRepository) {
    this.lessonRepo = lessonRepo;
    this.eventBus = eventBus;
    this.progressRepo = progressRepo;
  }

  getLesson(lessonId: string): Lesson | null {
    return this.lessonRepo.getLesson(lessonId);
  }

  getLessonBySession(sessionId: string): Lesson | null {
    return this.lessonRepo.getLessonBySession(sessionId);
  }

  applyPatches(
    sessionId: string,
    lessonId: string,
    baseVersion: number,
    patches: LessonPatch[]
  ): { lesson: Lesson; newVersion: number } {
    if (this.progressRepo) {
      const activeLesson = this.lessonRepo.getLessonBySession(sessionId);
      if (!activeLesson) {
        throw new Error(`SESSION_NOT_FOUND: ${sessionId}`);
      }
      if (activeLesson.id !== lessonId) {
        throw new Error(`LESSON_NOT_ACTIVE: ${lessonId}`);
      }
      const currentLesson = this.lessonRepo.getLesson(lessonId);
      if (currentLesson) {
        const progress = this.progressRepo.getOrCreate(
          sessionId,
          lessonId,
          currentLesson.blocks.map((block) => block.id)
        );
        const activeRemoval = patches.find(
          (patch) => patch.op === 'remove' && patch.blockId === progress.activeBlockId
        );
        if (activeRemoval && progress.activeBlockId) {
          throw new ActiveBlockRemovalError(progress.activeBlockId);
        }
      }
    }

    const result = this.lessonRepo.applyPatches(lessonId, baseVersion, patches);
    const progress = this.progressRepo?.reconcile(
      sessionId,
      lessonId,
      result.lesson.blocks.map((block) => block.id)
    );
    if (progress) {
      this.eventBus.publish(sessionId, 'lesson.progress', {
        ...progress,
        completed: progress.activeBlockId === null,
      });
    }

    const eventData: LessonPatchEventData = {
      lessonId,
      baseVersion,
      version: result.newVersion,
      patches,
    };

    this.eventBus.publish(sessionId, 'lesson.patch', eventData);

    return result;
  }
}
