import type { LearningPathNode, LearningPathPatch } from './learning.ts';
import type { Lesson } from './lesson.ts';
import type { LessonPatch } from './patch.ts';

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
  | 'agent.text.delta'
  | 'agent.tool.started'
  | 'agent.tool.completed'
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

export interface AgentTextDeltaEventData {
  requestId: string;
  delta: string;
}

export interface AgentToolStartedEventData {
  requestId: string;
  toolCallId: string;
  toolName: string;
}

export interface AgentToolCompletedEventData {
  requestId: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
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
