import type { Database } from '@opentutor/database';
import type { LearningPathNode, Lesson, LessonPatch } from '@opentutor/protocol';
import type { ArtifactCompiler } from '@opentutor/knowledge-core';
import type { LessonGenerator } from '../generator/lesson-generator-types.ts';
import { FakeLessonGenerator } from '../generator/fake-lesson-generator.ts';

export interface CoordinatorState {
 sessionId: string;
 courseId: string;
 currentPathNode: LearningPathNode;
 activeLesson: Lesson;
 detourStack: Array<{
  detourNodeId: string;
  parentPathNodeId: string;
  savedLessonId: string;
 }>;
}

export class LearningSessionCoordinator {
 private readonly db: Database;
 private readonly artifactCompiler: ArtifactCompiler;
 private readonly lessonGenerator: LessonGenerator;
 private readonly sessionDetourStacks = new Map<string, Array<{ detourNodeId: string; parentPathNodeId: string; savedLessonId: string }>>();

 constructor(
  db: Database,
  artifactCompiler: ArtifactCompiler,
  lessonGenerator?: LessonGenerator
 ) {
  this.db = db;
  this.artifactCompiler = artifactCompiler;
  this.lessonGenerator = lessonGenerator ?? new FakeLessonGenerator();
 }

 async ensureLessonForNode(
  sessionId: string,
  courseId: string,
  knowledgeNodeId: string,
  nodeTitle: string
 ): Promise<Lesson> {
  // 1. Check if lesson already exists in database
  const row = this.db
   .prepare('SELECT id, course_id, knowledge_node_id, title, objective, version, blocks, status FROM lessons WHERE course_id = ? AND knowledge_node_id = ?')
   .get(courseId, knowledgeNodeId) as any;

  if (row) {
   return {
    schemaVersion: '1.0',
    id: row.id,
    courseId: row.course_id,
    knowledgeNodeId: row.knowledge_node_id,
    title: row.title,
    objective: row.objective,
    version: row.version,
    blocks: typeof row.blocks === 'string' ? JSON.parse(row.blocks) : row.blocks,
    status: row.status,
   };
  }

  // 2. Otherwise fetch or compile artifact and generate lesson
  let artifact = this.artifactCompiler.getLatestArtifact(knowledgeNodeId);
  if (!artifact) {
   const compiled = await this.artifactCompiler.compile(knowledgeNodeId, nodeTitle);
   artifact = compiled.content;
  }

  const lesson = await this.lessonGenerator.generate({
   courseId,
   knowledgeNodeId,
   artifact,
  });

  // Persist new lesson
  this.db
   .prepare(
    `INSERT INTO lessons (id, course_id, knowledge_node_id, title, objective, version, blocks, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO NOTHING`
   )
   .run(
    lesson.id,
    lesson.courseId,
    lesson.knowledgeNodeId,
    lesson.title,
    lesson.objective ?? '',
    lesson.version,
    JSON.stringify(lesson.blocks),
    lesson.status
   );

  return lesson;
 }

 async handleDetour(
  sessionId: string,
  courseId: string,
  detourKnowledgeNodeId: string,
  detourTitle: string,
  currentPathNodeId: string,
  currentLessonId: string
 ): Promise<{ detourLesson: Lesson; detourPathNode: LearningPathNode }> {
  const stack = this.sessionDetourStacks.get(sessionId) ?? [];
  stack.push({
   detourNodeId: detourKnowledgeNodeId,
   parentPathNodeId: currentPathNodeId,
   savedLessonId: currentLessonId,
  });
  this.sessionDetourStacks.set(sessionId, stack);

  const detourLesson = await this.ensureLessonForNode(
   sessionId,
   courseId,
   detourKnowledgeNodeId,
   detourTitle
  );

  const detourPathNode: LearningPathNode = {
   id: `detour-${detourKnowledgeNodeId}`,
   knowledgeNodeId: detourKnowledgeNodeId,
   title: detourTitle,
   type: 'detour',
   status: 'current',
   position: 0,
   note: 'Diagnostic detour to resolve conceptual prerequisite gap.',
  };

  return {
   detourLesson,
   detourPathNode,
  };
 }

 async handleResume(
  sessionId: string,
  courseId: string
 ): Promise<{ resumedLesson: Lesson | null; resumedNodeId: string | null }> {
  const stack = this.sessionDetourStacks.get(sessionId) ?? [];
  if (stack.length === 0) {
   return { resumedLesson: null, resumedNodeId: null };
  }

  const top = stack.pop()!;
  this.sessionDetourStacks.set(sessionId, stack);

  // Fetch the saved parent lesson
  const row = this.db
   .prepare('SELECT id, course_id, knowledge_node_id, title, objective, version, blocks, status FROM lessons WHERE id = ?')
   .get(top.savedLessonId) as any;

  let resumedLesson: Lesson | null = null;
  if (row) {
   resumedLesson = {
    schemaVersion: '1.0',
    id: row.id,
    courseId: row.course_id,
    knowledgeNodeId: row.knowledge_node_id,
    title: row.title,
    objective: row.objective,
    version: row.version,
    blocks: typeof row.blocks === 'string' ? JSON.parse(row.blocks) : row.blocks,
    status: row.status,
   };
  }

  return {
   resumedLesson,
   resumedNodeId: top.parentPathNodeId,
  };
 }
}
