import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
 LearningPathNode,
 LearningPathPatch,
 LearningSessionSnapshot,
 Lesson,
 LessonBlock,
} from '@opentutor/protocol';
import { NotFoundError, VersionConflictError } from '../errors.ts';

export function enforceSingleCurrentInvariant(nodes: LearningPathNode[]): LearningPathNode[] {
 let foundCurrent = false;
 const result: LearningPathNode[] = [];

 for (const node of nodes) {
  if (node.status === 'current') {
   if (foundCurrent) {
    // Demote secondary current nodes to upcoming
    result.push({ ...node, status: 'upcoming' });
   } else {
    foundCurrent = true;
    result.push(node);
   }
  } else {
   result.push(node);
  }
 }

 // If no node is marked current, activate the first upcoming node
 if (!foundCurrent) {
  const upcomingIdx = result.findIndex((n) => n.status === 'upcoming');
  if (upcomingIdx >= 0) {
   result[upcomingIdx] = { ...result[upcomingIdx], status: 'current' };
  }
 }

 return result.map((node, index) => ({
  ...node,
  position: index,
 }));
}

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

 return enforceSingleCurrentInvariant(updatedNodes);
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

export interface LearningSessionFrame {
 id: string;
 sessionId: string;
 detourPathNodeId: string;
 parentPathNodeId: string;
 savedLessonId: string;
 depth: number;
 status: 'active' | 'completed' | 'cancelled';
 createdAt: string;
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

 getSession(sessionId: string): {
  id: string;
  userId: string;
  courseId: string;
  activeLessonId: string | null;
  pathVersion: number;
  createdAt: string;
  updatedAt: string;
 } | null {
  const sessionRow = this.db
   .prepare(
    'SELECT id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at FROM learning_sessions WHERE id = ?'
   )
   .get(sessionId) as SessionRow | undefined;

  if (!sessionRow) return null;

  return {
   id: sessionRow.id,
   userId: sessionRow.user_id,
   courseId: sessionRow.course_id,
   activeLessonId: sessionRow.active_lesson_id,
   pathVersion: sessionRow.path_version,
   createdAt: sessionRow.created_at,
   updatedAt: sessionRow.updated_at,
  };
 }

 pushFrame(frame: {
  id?: string;
  sessionId: string;
  detourPathNodeId: string;
  parentPathNodeId: string;
  savedLessonId: string;
  depth?: number;
 }): LearningSessionFrame {
  const id = frame.id ?? `frame-${randomUUID()}`;
  let depth = frame.depth;
  if (depth === undefined) {
   const active = this.peekActiveFrame(frame.sessionId);
   depth = active ? active.depth + 1 : 1;
  }
  const createdAt = new Date().toISOString();
  const status: LearningSessionFrame['status'] = 'active';

  this.db
   .prepare(
    `INSERT INTO learning_session_frames (id, session_id, detour_path_node_id, parent_path_node_id, saved_lesson_id, depth, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
   )
   .run(
    id,
    frame.sessionId,
    frame.detourPathNodeId,
    frame.parentPathNodeId,
    frame.savedLessonId,
    depth,
    status,
    createdAt
   );

  return {
   id,
   sessionId: frame.sessionId,
   detourPathNodeId: frame.detourPathNodeId,
   parentPathNodeId: frame.parentPathNodeId,
   savedLessonId: frame.savedLessonId,
   depth,
   status,
   createdAt,
  };
 }

 peekActiveFrame(sessionId: string): LearningSessionFrame | null {
  const row = this.db
   .prepare(
    `SELECT id, session_id, detour_path_node_id, parent_path_node_id, saved_lesson_id, depth, status, created_at
     FROM learning_session_frames
     WHERE session_id = ? AND status = 'active'
     ORDER BY depth DESC, created_at DESC
     LIMIT 1`
   )
   .get(sessionId) as
   | {
    id: string;
    session_id: string;
    detour_path_node_id: string;
    parent_path_node_id: string;
    saved_lesson_id: string;
    depth: number;
    status: string;
    created_at: string;
   }
   | undefined;

  if (!row) return null;

  return {
   id: row.id,
   sessionId: row.session_id,
   detourPathNodeId: row.detour_path_node_id,
   parentPathNodeId: row.parent_path_node_id,
   savedLessonId: row.saved_lesson_id,
   depth: row.depth,
   status: row.status as LearningSessionFrame['status'],
   createdAt: row.created_at,
  };
 }

 popActiveFrame(sessionId: string): LearningSessionFrame | null {
  const active = this.peekActiveFrame(sessionId);
  if (!active) return null;

  this.db
   .prepare("UPDATE learning_session_frames SET status = 'completed' WHERE id = ?")
   .run(active.id);

  return { ...active, status: 'completed' };
 }

 getSnapshot(sessionId: string): LearningSessionSnapshot | null {
  return this.getSessionSnapshot(sessionId);
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
   lesson = {
    schemaVersion: '1.0',
    id: `empty-lesson-${sessionId}`,
    courseId: sessionRow.course_id,
    knowledgeNodeId: 'unknown',
    title: 'Empty Lesson',
    version: 1,
    blocks: [],
    status: 'active',
   };
  }

  const nodeRows = this.db
   .prepare(
    'SELECT id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at FROM learning_path_nodes WHERE session_id = ? ORDER BY position ASC'
   )
   .all(sessionId) as PathNodeRow[];

  const path: LearningPathNode[] = nodeRows.map((row) => ({
   id: row.id,
   knowledgeNodeId: row.knowledge_node_id,
   title: row.title,
   type: row.type as LearningPathNode['type'],
   status: row.status as LearningPathNode['status'],
   position: row.position,
   note: row.note ?? undefined,
  }));

  const maxSeqRow = this.db
   .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM learning_events WHERE session_id = ?')
   .get(sessionId) as { max_seq: number } | undefined;

  return {
   sessionId: sessionRow.id,
   courseId: sessionRow.course_id,
   lesson,
   path,
   pathVersion: sessionRow.path_version,
   lastSeq: maxSeqRow?.max_seq ?? 0,
  };
 }

 getPath(sessionId: string): LearningPathNode[] {
  const nodeRows = this.db
   .prepare(
    'SELECT id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at FROM learning_path_nodes WHERE session_id = ? ORDER BY position ASC'
   )
   .all(sessionId) as PathNodeRow[];

  return nodeRows.map((row) => ({
   id: row.id,
   knowledgeNodeId: row.knowledge_node_id,
   title: row.title,
   type: row.type as LearningPathNode['type'],
   status: row.status as LearningPathNode['status'],
   position: row.position,
   note: row.note ?? undefined,
  }));
 }

 getPathVersion(sessionId: string): number {
  const row = this.db
   .prepare('SELECT path_version FROM learning_sessions WHERE id = ?')
   .get(sessionId) as { path_version: number } | undefined;

  if (!row) {
   throw new NotFoundError('Session', sessionId);
  }
  return row.path_version;
 }

 setActiveLesson(sessionId: string, lessonId: string): void {
  const now = new Date().toISOString();
  this.db
   .prepare('UPDATE learning_sessions SET active_lesson_id = ?, updated_at = ? WHERE id = ?')
   .run(lessonId, now, sessionId);
 }

 createSession(params: CreateSessionParams): void {
  const now = new Date().toISOString();
  const createTx = this.db.transaction(() => {
   this.db
    .prepare(
     `INSERT INTO learning_sessions (id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           active_lesson_id = COALESCE(excluded.active_lesson_id, learning_sessions.active_lesson_id),
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

    const insertNode = this.db.prepare(
     `INSERT INTO learning_path_nodes (id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const node of params.path) {
     insertNode.run(
      node.id,
      params.id,
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
   }
  });

  createTx();
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
    throw new NotFoundError('Session', sessionId);
   }

   if (sessionRow.path_version !== baseVersion) {
    throw new VersionConflictError(sessionId, baseVersion, sessionRow.path_version);
   }

   const currentNodes = this.getPath(sessionId);
   const nextNodes = applyLearningPathPatches(currentNodes, patches);
   const newVersion = sessionRow.path_version + 1;
   const now = new Date().toISOString();

   this.db
    .prepare('UPDATE learning_sessions SET path_version = ?, updated_at = ? WHERE id = ?')
    .run(newVersion, now, sessionId);

   this.db.prepare('DELETE FROM learning_path_nodes WHERE session_id = ?').run(sessionId);

   const insertNode = this.db.prepare(
    `INSERT INTO learning_path_nodes (id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
   );

   for (const node of nextNodes) {
    insertNode.run(
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

   return { path: nextNodes, newVersion };
  });

  return applyTx();
 }

 /**
  * Inserts a Detour before the current active node and shifts current focus to the Detour.
  * Runs atomically inside a single DB transaction.
  */
 insertDetour(
  sessionId: string,
  baseVersion: number,
  detourNode: Omit<LearningPathNode, 'type' | 'status' | 'position'>,
  options?: {
   activeLessonId?: string;
   frame?: {
    id?: string;
    parentPathNodeId: string;
    savedLessonId: string;
   };
  }
 ): { path: LearningPathNode[]; newVersion: number; patches: LearningPathPatch[] } {
  const applyTx = this.db.transaction(() => {
   const sessionRow = this.db
    .prepare('SELECT id, path_version, active_lesson_id FROM learning_sessions WHERE id = ?')
    .get(sessionId) as { id: string; path_version: number; active_lesson_id: string | null } | undefined;

   if (!sessionRow) {
    throw new NotFoundError('Session', sessionId);
   }

   if (sessionRow.path_version !== baseVersion) {
    throw new VersionConflictError(sessionId, baseVersion, sessionRow.path_version);
   }

   const currentNodes = this.getPath(sessionId);
   const activeNode = currentNodes.find((n) => n.status === 'current') ?? currentNodes[0];

   const newDetourNode: LearningPathNode = {
    ...detourNode,
    type: 'detour',
    status: 'current',
    position: activeNode ? activeNode.position : 0,
   };

   const patches: LearningPathPatch[] = [];
   if (activeNode) {
    // Demote current node to upcoming
    patches.push({
     op: 'update_node',
     nodeId: activeNode.id,
     changes: { status: 'upcoming' },
    });
    // Insert detour before active node
    patches.push({
     op: 'insert_node',
     before: activeNode.id,
     node: newDetourNode,
    });
   } else {
    patches.push({
     op: 'insert_node',
     node: newDetourNode,
    });
   }

   const nextNodes = applyLearningPathPatches(currentNodes, patches);
   const newVersion = sessionRow.path_version + 1;
   const now = new Date().toISOString();

   if (options?.frame) {
    const activeFrame = this.peekActiveFrame(sessionId);
    const depth = (activeFrame ? activeFrame.depth : 0) + 1;
    this.pushFrame({
     id: options.frame.id,
     sessionId,
     detourPathNodeId: detourNode.id,
     parentPathNodeId: options.frame.parentPathNodeId,
     savedLessonId: options.frame.savedLessonId,
     depth,
    });
   }

   const nextActiveLessonId = options?.activeLessonId ?? sessionRow.active_lesson_id;

   this.db
    .prepare('UPDATE learning_sessions SET path_version = ?, active_lesson_id = ?, updated_at = ? WHERE id = ?')
    .run(newVersion, nextActiveLessonId, now, sessionId);

   this.db.prepare('DELETE FROM learning_path_nodes WHERE session_id = ?').run(sessionId);

   const insertNode = this.db.prepare(
    `INSERT INTO learning_path_nodes (id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
   );

   for (const node of nextNodes) {
    insertNode.run(
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

   return { path: nextNodes, newVersion, patches };
  });

  return applyTx();
 }

 /**
  * Completes the current node and advances the learning path to the next upcoming node.
  * If the active node was a detour (or popDetourFrame is true), pops the active frame and restores previous lesson.
  * Runs atomically inside a single DB transaction.
  */
 completeCurrentNode(
  sessionId: string,
  baseVersion: number,
  options?: {
   popDetourFrame?: boolean;
  }
 ): {
  path: LearningPathNode[];
  newVersion: number;
  patches: LearningPathPatch[];
  resumedFrame?: LearningSessionFrame | null;
  resumedLessonId?: string | null;
 } {
  const applyTx = this.db.transaction(() => {
   const sessionRow = this.db
    .prepare('SELECT id, path_version, active_lesson_id FROM learning_sessions WHERE id = ?')
    .get(sessionId) as { id: string; path_version: number; active_lesson_id: string | null } | undefined;

   if (!sessionRow) {
    throw new NotFoundError('Session', sessionId);
   }

   if (sessionRow.path_version !== baseVersion) {
    throw new VersionConflictError(sessionId, baseVersion, sessionRow.path_version);
   }

   const currentNodes = this.getPath(sessionId);
   const activeIdx = currentNodes.findIndex((n) => n.status === 'current');

   if (activeIdx < 0) {
    return { path: currentNodes, newVersion: baseVersion, patches: [], resumedFrame: null, resumedLessonId: null };
   }

   const activeNode = currentNodes[activeIdx];
   let resumedFrame: LearningSessionFrame | null = null;
   let nextActiveLessonId = sessionRow.active_lesson_id;

   if (options?.popDetourFrame ?? (activeNode.type === 'detour')) {
    resumedFrame = this.popActiveFrame(sessionId);
    if (resumedFrame) {
     nextActiveLessonId = resumedFrame.savedLessonId;
    }
   }

   const nextNode = currentNodes.slice(activeIdx + 1).find((n) => n.status === 'upcoming');

   const patches: LearningPathPatch[] = [
    {
     op: 'update_node',
     nodeId: activeNode.id,
     changes: { status: 'completed' },
    },
   ];

   if (nextNode) {
    patches.push({
     op: 'update_node',
     nodeId: nextNode.id,
     changes: { status: 'current' },
    });
   }

   const nextNodes = applyLearningPathPatches(currentNodes, patches);
   const newVersion = sessionRow.path_version + 1;
   const now = new Date().toISOString();

   this.db
    .prepare('UPDATE learning_sessions SET path_version = ?, active_lesson_id = ?, updated_at = ? WHERE id = ?')
    .run(newVersion, nextActiveLessonId, now, sessionId);

   this.db.prepare('DELETE FROM learning_path_nodes WHERE session_id = ?').run(sessionId);

   const insertNode = this.db.prepare(
    `INSERT INTO learning_path_nodes (id, session_id, knowledge_node_id, title, type, status, position, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
   );

   for (const node of nextNodes) {
    insertNode.run(
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

   return {
    path: nextNodes,
    newVersion,
    patches,
    resumedFrame,
    resumedLessonId: resumedFrame ? resumedFrame.savedLessonId : null,
   };
  });

  return applyTx();
 }
}
