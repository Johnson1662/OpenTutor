import type { Lesson, LessonPatch } from '@opentutor/protocol';

export class LessonService {
  constructor(private lesson: Lesson) {}

  get() {
    return this.lesson;
  }

  patch(patches: LessonPatch[]) {
    // Commit 3 placeholder: move existing patch validation here from index.ts.
    return patches;
  }
}
