import { Type, type Static } from 'typebox';

export const CourseGoalAnalysisSchema = Type.Object({
  targetConcepts: Type.Array(Type.String()),
  depth: Type.Union([
    Type.Literal('beginner'),
    Type.Literal('intermediate'),
    Type.Literal('advanced'),
  ]),
  constraints: Type.Optional(Type.Array(Type.String())),
});

export type CourseGoalAnalysis = Static<typeof CourseGoalAnalysisSchema>;

export type CourseNodeRole = 'core' | 'prerequisite' | 'extension';

export interface CourseNode {
  courseId: string;
  knowledgeNodeId: string;
  title: string;
  role: CourseNodeRole;
  position: number;
}

export interface CourseEdge {
  courseId: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: string;
}

export interface CourseGraph {
  courseId: string;
  title: string;
  nodes: CourseNode[];
  edges: CourseEdge[];
}

export interface CompileCourseInput {
  courseId: string;
  title?: string;
  learningGoal: string;
  userId?: string;
}
