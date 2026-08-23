import { SessionRepository, type Database } from '@opentutor/database';
import type { LearningPathNode, Lesson } from '@opentutor/protocol';
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

interface LessonDbRow {
 id: string;
 course_id: string;
 knowledge_node_id: string;
 title: string;
 objective: string | null;
 version: number;
 blocks: string;
 status: Lesson['status'];
}

export class LearningSessionCoordinator {
 private readonly db: Database;
 private readonly artifactCompiler: ArtifactCompiler;
 private readonly lessonGenerator: LessonGenerator;
 private readonly sessionRepo: SessionRepository;

 constructor(
  db: Database,
  artifactCompiler: ArtifactCompiler,
  lessonGenerator?: LessonGenerator,
  sessionRepo?: SessionRepository
 ) {
  this.db = db;
  this.artifactCompiler = artifactCompiler;
  this.lessonGenerator = lessonGenerator ?? new FakeLessonGenerator();
  this.sessionRepo = sessionRepo ?? new SessionRepository(db);
 }

 async ensureLessonForNode(
  sessionId: string,
  courseId: string,
  knowledgeNodeId: string,
  nodeTitle: string
 ): Promise<Lesson> {
  // 1. Check if lesson already exists in database
  const row = this.db
   .prepare(
    'SELECT id, course_id, knowledge_node_id, title, objective, version, blocks, status FROM lessons WHERE course_id = ? AND knowledge_node_id = ?'
   )
   .get(courseId, knowledgeNodeId) as LessonDbRow | undefined;

  if (row) {
   return {
    schemaVersion: '1.0',
    id: row.id,
    courseId: row.course_id,
    knowledgeNodeId: row.knowledge_node_id,
    title: row.title,
    objective: row.objective ?? undefined,
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
  // Ensure session row exists in learning_sessions
  this.db
   .prepare(
    `INSERT OR IGNORE INTO learning_sessions (id, user_id, course_id, path_version, created_at, updated_at)
         VALUES (?, 'default-user', ?, 1, datetime('now'), datetime('now'))`
   )
   .run(sessionId, courseId);

  const detourLesson = await this.ensureLessonForNode(
   sessionId,
   courseId,
   detourKnowledgeNodeId,
   detourTitle
  );

  const detourPathNodeId = `detour-${detourKnowledgeNodeId}`;
  const activeFrame = this.sessionRepo.peekActiveFrame(sessionId);
  const depth = (activeFrame ? activeFrame.depth : 0) + 1;

  this.sessionRepo.pushFrame({
   id: `frame-${sessionId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
   sessionId,
   detourPathNodeId,
   parentPathNodeId: currentPathNodeId,
   savedLessonId: currentLessonId,
   depth,
  });

  const detourPathNode: LearningPathNode = {
   id: detourPathNodeId,
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
  const top = this.sessionRepo.popActiveFrame(sessionId);
  if (!top) {
   return { resumedLesson: null, resumedNodeId: null };
  }

  // Fetch the saved parent lesson
  const row = this.db
   .prepare(
    'SELECT id, course_id, knowledge_node_id, title, objective, version, blocks, status FROM lessons WHERE id = ?'
   )
   .get(top.savedLessonId) as LessonDbRow | undefined;

  let resumedLesson: Lesson | null = null;
  if (row) {
   resumedLesson = {
    schemaVersion: '1.0',
    id: row.id,
    courseId: row.course_id,
    knowledgeNodeId: row.knowledge_node_id,
    title: row.title,
    objective: row.objective ?? undefined,
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
