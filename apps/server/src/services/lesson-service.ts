import type { Lesson, LessonPatch, LessonPatchEventData } from '@opentutor/protocol';
import type { LessonRepository } from '@opentutor/database';
import type { EventBus } from '../events/event-bus.ts';

export class LessonService {
  private readonly lessonRepo: LessonRepository;
  private readonly eventBus: EventBus;

  constructor(lessonRepo: LessonRepository, eventBus: EventBus) {
    this.lessonRepo = lessonRepo;
    this.eventBus = eventBus;
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
    const result = this.lessonRepo.applyPatches(lessonId, baseVersion, patches);

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
