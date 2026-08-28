import type { Lesson, UserKnowledgeState } from '@opentutor/protocol';
import type { KnowledgeArtifact } from '@opentutor/knowledge-core';

export type TeachingStrategy = 'intro' | 'deep_dive' | 'code_first' | 'remedial';

export interface GenerateLessonInput {
  courseId: string;
  knowledgeNodeId: string;
  artifact: KnowledgeArtifact;
  userState?: UserKnowledgeState | null;
  learningGoal?: string;
  language?: 'zh' | 'en';
  neighboringNodes?: {
    prerequisites: string[];
    next: string[];
  };
  strategy?: TeachingStrategy;
}

export interface LessonGenerator {
  generate(input: GenerateLessonInput): Promise<Lesson>;
}
