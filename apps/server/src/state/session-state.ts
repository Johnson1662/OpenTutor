import type { LearningEvent, LearningPathNode, Lesson } from '@opentutor/protocol';
import type { ServerResponse } from 'node:http';

export interface SessionState {
  lesson: Lesson;
  path: LearningPathNode[];
  pathVersion: number;
  seq: number;
  events: LearningEvent[];
  listeners: Set<ServerResponse>;
}
