import type Database from 'better-sqlite3';
import type {
 LearningPathNode,
 LearningPathPatch,
 LearningSessionSnapshot,
 Lesson,
 LessonBlock,
} from '@opentutor/protocol';
import { NotFoundError, VersionConflictError } from '../errors.ts';

export function applyLearningPathPatches(
 nodes: LearningPathNode[],
 patches: LearningPathPatch[]
): LearningPathNode[] {
 let updatedNodes = [...nodes];

 for (const patch of patches) {
  if (patch.op === 'insert_node') {
   if (patch.before) {
    const index = updatedNodes.findIndex((n) => n.id === patch.before);
    const target = index < 0 ? updatedNodes.length : index;
    updatedNodes.splice(target, 0, patch.node);
   } else if (patch.after) {
    const index = updatedNodes.findIndex((n) => n.id === patch.after);
    const target = index < 0 ? updatedNodes.length : index + 1;
    updatedNodes.splice(target, 0, patch.node);
   } else {
    updatedNodes.push(patch.node);
   }
  } else if (patch.op === 'update_node') {
   updatedNodes = updatedNodes.map((n) =>
    n.id === patch.nodeId ? { ...n, ...patch.changes } : n
   );
  } else if (patch.op === 'remove_node') {
   updatedNodes = updatedNodes.filter((n) => n.id !== patch.nodeId);
  }
 }

 // Ensure consecutive 0-based positions
 return updatedNodes.map((node, index) => ({
  ...node,
  position: index,
 }));
}

interface SessionRow {
 id: string;
 user_id: string;
 course_id: string;
 active_lesson_id: string | null;
 path_version: number;
 created_at: string;
 updated_at: string;
}

interface PathNodeRow {
 id: string;
 session_id: string;
 knowledge_node_id: string;
 title: string;
 type: string;
 status: string;
 position: number;
 note: string | null;
 created_at: string;
 updated_at: string;
}

interface LessonRow {
 id: string;
 course_id: string;
 knowledge_node_id: string;
 title: string;
 objective: string | null;
 version: number;
 status: string;
 blocks: string;
}

export interface CreateSessionParams {
 id: string;
 userId?: string;
 courseId: string;
 activeLessonId?: string;
 pathVersion?: number;
 path?: LearningPathNode[];
}

export class SessionRepository {
 private readonly db: Database.Database;

 constructor(db: Database.Database) {
  this.db = db;
 }

 getSessionSnapshot(sessionId: string): LearningSessionSnapshot | null {
  const sessionRow = this.db
   .prepare(
    'SELECT id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at FROM learning_sessions WHERE id = ?'
   )
   .get(sessionId) as SessionRow | undefined;

  if (!sessionRow) return null;

  let lesson: Lesson | null = null;
  if (sessionRow.active_lesson_id) {
   const lessonRow = this.db
    .prepare(
     'SELECT id, course_id, knowledge_node_id, title, objective, version, status, blocks FROM lessons WHERE id = ?'
    )
    .get(sessionRow.active_lesson_id) as LessonRow | undefined;

   if (lessonRow) {
    lesson = {
     schemaVersion: '1.0',
     id: lessonRow.id,
     courseId: lessonRow.course_id,
     knowledgeNodeId: lessonRow.knowledge_node_id,
     title: lessonRow.title,
     objective: lessonRow.objective ?? undefined,
     version: lessonRow.version,
     status: lessonRow.status as Lesson['status'],
     blocks: JSON.parse(lessonRow.blocks) as LessonBlock[],
    };
   }
  }

  if (!lesson) {
   // Fallback: try loading the first lesson matching course
   const firstLessonRow = this.db
    .prepare(
     'SELECT id, course_id, knowledge_node_id, title, objective, version, status, blocks FROM lessons WHERE course_id = ? LIMIT 1'
    )
    .get(sessionRow.course_id) as LessonRow | undefined;

   if (firstLessonRow) {
    lesson = {
     schemaVersion: '1.0',
     id: firstLessonRow.id,
     courseId: firstLessonRow.course_id,
     knowledgeNodeId: firstLessonRow.knowledge_node_id,
     title: firstLessonRow.title,
     objective: firstLessonRow.objective ?? undefined,
     version: firstLessonRow.version,
     status: firstLessonRow.status as Lesson['status'],
     blocks: JSON.parse(firstLessonRow.blocks) as LessonBlock[],
    };
   } else {
    throw new NotFoundError('Lesson for session', sessionId);
   }
  }

  const pathNodes = this.getPathNodes(sessionId);

  const seqRow = this.db
   .prepare('SELECT COALESCE(MAX(seq), 0) AS last_seq FROM learning_events WHERE session_id = ?')
   .get(sessionId) as { last_seq: number };

  return {
   sessionId: sessionRow.id,
   lesson,
   path: pathNodes,
   pathVersion: sessionRow.path_version,
   lastSeq: seqRow.last_seq,
  };
 }

 getPathNodes(sessionId: string): LearningPathNode[] {
  const rows = this.db
   .prepare(
    'SELECT id, knowledge_node_id, title, type, status, position, note FROM learning_path_nodes WHERE session_id = ? ORDER BY position ASC'
   )
   .all(sessionId) as PathNodeRow[];

  return rows.map((r) => ({
   id: r.id,
   knowledgeNodeId: r.knowledge_node_id,
   title: r.title,
   type: r.type as LearningPathNode['type'],
   status: r.status as LearningPathNode['status'],
   position: r.position,
   note: r.note ?? undefined,
  }));
 }

 applyPathPatches(
  sessionId: string,
  baseVersion: number,
  patches: LearningPathPatch[]
 ): { path: LearningPathNode[]; newVersion: number } {
  const applyTx = this.db.transaction(() => {
   const sessionRow = this.db
    .prepare('SELECT id, path_version FROM learning_sessions WHERE id = ?')
    .get(sessionId) as SessionRow | undefined;

   if (!sessionRow) {
    throw new NotFoundError('LearningSession', sessionId);
   }

   if (sessionRow.path_version !== baseVersion) {
    throw new VersionConflictError(sessionId, baseVersion, sessionRow.path_version);
   }

   const currentNodes = this.getPathNodes(sessionId);
   const updatedNodes = applyLearningPathPatches(currentNodes, patches);
   const newVersion = baseVersion + 1;
   const now = new Date().toISOString();

   // Delete existing path nodes for this session
   this.db.prepare('DELETE FROM learning_path_nodes WHERE session_id = ?').run(sessionId);

   // Insert updated path nodes
   const insertNodeStmt = this.db.prepare(`
        INSERT INTO learning_path_nodes (id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

   for (const node of updatedNodes) {
    insertNodeStmt.run(
     node.id,
     sessionId,
     node.knowledgeNodeId,
     node.title,
     node.type,
     node.status,
     node.position,
     node.note ?? null,
     now,
     now
    );
   }

   // Update path_version on session
   this.db
    .prepare('UPDATE learning_sessions SET path_version = ?, updated_at = ? WHERE id = ?')
    .run(newVersion, now, sessionId);

   return { path: updatedNodes, newVersion };
  });

  return applyTx();
 }

 createSession(params: CreateSessionParams): void {
  const now = new Date().toISOString();
  const createTx = this.db.transaction(() => {
   this.db
    .prepare(
     `INSERT INTO learning_sessions (id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             course_id = excluded.course_id,
             active_lesson_id = excluded.active_lesson_id,
             path_version = excluded.path_version,
             updated_at = excluded.updated_at`
    )
    .run(
     params.id,
     params.userId ?? 'default-user',
     params.courseId,
     params.activeLessonId ?? null,
     params.pathVersion ?? 1,
     now,
     now
    );

   if (params.path && params.path.length > 0) {
    this.db.prepare('DELETE FROM learning_path_nodes WHERE session_id = ?').run(params.id);

    const insertNodeStmt = this.db.prepare(`
          INSERT INTO learning_path_nodes (id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

    for (const [index, node] of params.path.entries()) {
     insertNodeStmt.run(
      node.id,
      params.id,
      node.knowledgeNodeId,
      node.title,
      node.type,
      node.status,
      node.position ?? index,
      node.note ?? null,
      now,
      now
     );
    }
   }
  });

  createTx();
 }

 updateActiveLesson(sessionId: string, lessonId: string): void {
  const now = new Date().toISOString();
  const result = this.db
   .prepare('UPDATE learning_sessions SET active_lesson_id = ?, updated_at = ? WHERE id = ?')
   .run(lessonId, now, sessionId);

  if (result.changes === 0) {
   throw new NotFoundError('LearningSession', sessionId);
  }
 }
}
