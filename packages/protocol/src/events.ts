import type { LearningPathNode, LearningPathPatch } from './learning';
import type { Lesson } from './lesson';
import type { LessonPatch } from './patch';

export type TutorAction = 'simpler' | 'show_code' | 'visualize' | 'softmax_unknown';

export interface AssessmentResult {
  id: string;
  knowledgeNodeId: string;
  lessonId: string;
  blockId?: string;
  result: 'correct' | 'partial' | 'incorrect';
  confidence: number;
  feedback: string;
}

export type LearningEventType =
  | 'agent.started'
  | 'agent.completed'
  | 'lesson.patch'
  | 'lesson.updated'
  | 'path.patch'
  | 'assessment.completed'
  | 'knowledge.updated'
  | 'error';

export interface LearningEvent<T = unknown> {
  id: string;
  seq: number;
  type: LearningEventType;
  sessionId: string;
  timestamp: string;
  data: T;
}

export interface AgentStartedEventData {
  requestId: string;
  action?: TutorAction;
}

export interface AgentCompletedEventData {
  requestId: string;
  message: string;
}

export interface LessonPatchEventData {
  lessonId: string;
  baseVersion: number;
  version: number;
  patches: LessonPatch[];
}

export interface LessonUpdatedEventData {
  lessonId: string;
  version: number;
  changes: Partial<Pick<Lesson, 'status' | 'title' | 'objective'>>;
}

export interface PathPatchEventData {
  baseVersion: number;
  version: number;
  patches: LearningPathPatch[];
}

export interface AssessmentCompletedEventData {
  assessment: AssessmentResult;
}

export interface KnowledgeUpdatedEventData {
  knowledgeNodeId: string;
  status: 'unknown' | 'learning' | 'weak' | 'mastered';
  confidence: number;
}

export interface LearningSessionSnapshot {
  sessionId: string;
  lesson: Lesson;
  path: LearningPathNode[];
  pathVersion: number;
  lastSeq: number;
}
