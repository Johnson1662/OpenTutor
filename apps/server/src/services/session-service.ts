import type { LearningPathNode, Lesson } from '@opentutor/protocol';

export interface SessionState {
  lesson: Lesson;
  path: LearningPathNode[];
  pathVersion: number;
  seq: number;
}

export class SessionService {
  constructor(private readonly state: SessionState) {}

  snapshot() {
    return {
      lesson: this.state.lesson,
      path: this.state.path,
      pathVersion: this.state.pathVersion,
    };
  }

  getState() {
    return this.state;
  }
}
