export interface BaseLessonBlock {
  id: string;
  knowledgeNodeIds?: string[];
  state?: 'normal' | 'loading' | 'error';
}

export interface TextBlock extends BaseLessonBlock {
  type: 'text';
  variant: 'paragraph' | 'definition' | 'example' | 'callout' | 'summary';
  content: string;
}

export interface CodeBlock extends BaseLessonBlock {
  type: 'code';
  language: string;
  code: string;
  explanation?: string;
}

export interface DiagramBlock extends BaseLessonBlock {
  type: 'diagram';
  diagramType: 'flow' | 'relationship' | 'sequence';
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
}

export type QuizAnswerSpec =
  | {
    type: 'single_choice';
    correctOptionId: string;
  }
  | {
    type: 'multiple_choice';
    correctOptionIds: string[];
  }
  | {
    type: 'open';
    rubric: {
      concepts: string[];
      referenceAnswer?: string;
    };
  };

export interface QuizBlock extends BaseLessonBlock {
  type: 'quiz';
  question: string;
  answerType?: 'text' | 'single_choice' | 'multiple_choice';
  options?: { id: string; text: string }[];
  answerSpec?: QuizAnswerSpec;
  difficulty?: number | 'easy' | 'medium' | 'hard';
  assessmentKind?: 'lesson_quiz' | 'probe';
  targetKnowledgeNodeId?: string;
  candidateMisconceptionIds?: string[];
}

export type LessonBlock = TextBlock | CodeBlock | DiagramBlock | QuizBlock;

export interface Lesson {
  schemaVersion: '1.0';
  id: string;
  courseId: string;
  knowledgeNodeId: string;
  title: string;
  objective?: string;
  version: number;
  blocks: LessonBlock[];
  status: 'generating' | 'active' | 'completed';
}
