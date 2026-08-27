import type { LessonBlock } from './lesson.ts';

export interface LessonStepProgress {
  sessionId: string;
  lessonId: string;
  activeBlockId: string | null;
  completedBlockIds: string[];
  version: number;
  updatedAt: string;
}

export interface ActiveStepContext {
  sessionId: string;
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  knowledgeNodeId: string;
  activeBlockId: string | null;
  activeBlockType?: LessonBlock['type'];
  pathNodeId?: string;
  pathNodeType?: 'main' | 'prerequisite' | 'detour';
  detourDepth: number;
  detour: boolean;
}

export interface LessonProgressEventData extends LessonStepProgress {
  completed: boolean;
}

export interface AdvanceLessonProgressRequest {
  lessonId?: string;
  activeBlockId: string | null;
  version: number;
  restart?: boolean;
}
