import type Database from 'better-sqlite3';
import type { Lesson, LessonBlock, LessonPatch, PatchPosition } from '@opentutor/protocol';
import { NotFoundError, VersionConflictError } from '../errors.ts';

export function findBlockInsertIndex(ids: string[], position: PatchPosition): number {
 if ('index' in position) {
  return Math.max(0, Math.min(position.index, ids.length));
 }
 if ('before' in position) {
  const index = ids.indexOf(position.before);
  return index < 0 ? ids.length : index;
 }
 const index = ids.indexOf(position.after);
 return index < 0 ? ids.length : index + 1;
}

export function applyLessonBlockPatches(blocks: LessonBlock[], patches: LessonPatch[]): LessonBlock[] {
 let updatedBlocks = [...blocks];

 for (const patch of patches) {
  if (patch.op === 'insert') {
   const index = findBlockInsertIndex(
    updatedBlocks.map((b) => b.id),
    patch.position
   );
   updatedBlocks.splice(index, 0, patch.block);
  } else if (patch.op === 'replace') {
   updatedBlocks = updatedBlocks.map((b) => (b.id === patch.blockId ? patch.block : b));
  } else if (patch.op === 'update') {
   updatedBlocks = updatedBlocks.map((b) =>
    b.id === patch.blockId ? ({ ...b, ...patch.changes } as LessonBlock) : b
   );
  } else if (patch.op === 'remove') {
   updatedBlocks = updatedBlocks.filter((b) => b.id !== patch.blockId);
  } else if (patch.op === 'move') {
   const fromIndex = updatedBlocks.findIndex((b) => b.id === patch.blockId);
   if (fromIndex >= 0) {
    const [movedBlock] = updatedBlocks.splice(fromIndex, 1);
    const toIndex = findBlockInsertIndex(
     updatedBlocks.map((b) => b.id),
     patch.position
    );
    updatedBlocks.splice(toIndex, 0, movedBlock);
   }
  }
 }

 return updatedBlocks;
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
 created_at: string;
 updated_at: string;
}

interface LessonVersionRow {
 id: number;
 lesson_id: string;
 version: number;
 title: string;
 objective: string | null;
 status: string;
 blocks: string;
 patches: string | null;
 created_at: string;
}

export interface LessonVersionRecord {
 version: number;
 title: string;
 objective?: string;
 status: Lesson['status'];
 blocks: LessonBlock[];
 patches?: LessonPatch[];
 createdAt: string;
}

export class LessonRepository {
 private readonly db: Database.Database;

 constructor(db: Database.Database) {
  this.db = db;
 }

 getLesson(lessonId: string): Lesson | null {
  const row = this.db
   .prepare(
    'SELECT id, course_id, knowledge_node_id, title, objective, version, status, blocks FROM lessons WHERE id = ?'
   )
   .get(lessonId) as LessonRow | undefined;

  if (!row) return null;

  return {
   schemaVersion: '1.0',
   id: row.id,
   courseId: row.course_id,
   knowledgeNodeId: row.knowledge_node_id,
   title: row.title,
   objective: row.objective ?? undefined,
   version: row.version,
   status: row.status as Lesson['status'],
   blocks: JSON.parse(row.blocks) as LessonBlock[],
  };
 }

 getLessonBySession(sessionId: string): Lesson | null {
  const sessionRow = this.db
   .prepare('SELECT active_lesson_id FROM learning_sessions WHERE id = ?')
   .get(sessionId) as { active_lesson_id: string | null } | undefined;

  if (!sessionRow || !sessionRow.active_lesson_id) return null;
  return this.getLesson(sessionRow.active_lesson_id);
 }

 saveLesson(lesson: Lesson): void {
  const now = new Date().toISOString();
  const saveTx = this.db.transaction(() => {
   this.db
    .prepare(
     `INSERT INTO lessons (id, course_id, knowledge_node_id, title, objective, version, status, blocks, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             course_id = excluded.course_id,
             knowledge_node_id = excluded.knowledge_node_id,
             title = excluded.title,
             objective = excluded.objective,
             version = excluded.version,
             status = excluded.status,
             blocks = excluded.blocks,
             updated_at = excluded.updated_at`
    )
    .run(
     lesson.id,
     lesson.courseId,
     lesson.knowledgeNodeId,
     lesson.title,
     lesson.objective ?? null,
     lesson.version,
     lesson.status,
     JSON.stringify(lesson.blocks),
     now,
     now
    );

   this.db
    .prepare(
     `INSERT OR IGNORE INTO lesson_versions (lesson_id, version, title, objective, status, blocks, patches, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
     lesson.id,
     lesson.version,
     lesson.title,
     lesson.objective ?? null,
     lesson.status,
     JSON.stringify(lesson.blocks),
     JSON.stringify([]),
     now
    );
  });

  saveTx();
 }

 applyPatches(
  lessonId: string,
  baseVersion: number,
  patches: LessonPatch[]
 ): { lesson: Lesson; newVersion: number } {
  const applyTx = this.db.transaction(() => {
   const row = this.db
    .prepare(
     'SELECT id, course_id, knowledge_node_id, title, objective, version, status, blocks FROM lessons WHERE id = ?'
    )
    .get(lessonId) as LessonRow | undefined;

   if (!row) {
    throw new NotFoundError('Lesson', lessonId);
   }

   if (row.version !== baseVersion) {
    throw new VersionConflictError(lessonId, baseVersion, row.version);
   }

   const currentBlocks = JSON.parse(row.blocks) as LessonBlock[];
   const newBlocks = applyLessonBlockPatches(currentBlocks, patches);
   const newVersion = baseVersion + 1;
   const now = new Date().toISOString();

   const updatedLesson: Lesson = {
    schemaVersion: '1.0',
    id: row.id,
    courseId: row.course_id,
    knowledgeNodeId: row.knowledge_node_id,
    title: row.title,
    objective: row.objective ?? undefined,
    version: newVersion,
    status: row.status as Lesson['status'],
    blocks: newBlocks,
   };

   this.db
    .prepare('UPDATE lessons SET version = ?, blocks = ?, updated_at = ? WHERE id = ?')
    .run(newVersion, JSON.stringify(newBlocks), now, lessonId);

   this.db
    .prepare(
     `INSERT INTO lesson_versions (lesson_id, version, title, objective, status, blocks, patches, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
     lessonId,
     newVersion,
     row.title,
     row.objective,
     row.status,
     JSON.stringify(newBlocks),
     JSON.stringify(patches),
     now
    );

   return { lesson: updatedLesson, newVersion };
  });

  return applyTx();
 }

 updateLesson(
  lessonId: string,
  changes: Partial<Pick<Lesson, 'status' | 'title' | 'objective'>>
 ): Lesson {
  const updateTx = this.db.transaction(() => {
   const current = this.getLesson(lessonId);
   if (!current) {
    throw new NotFoundError('Lesson', lessonId);
   }

   const updatedTitle = changes.title ?? current.title;
   const updatedObjective = changes.objective !== undefined ? changes.objective : current.objective;
   const updatedStatus = changes.status ?? current.status;
   const now = new Date().toISOString();

   this.db
    .prepare('UPDATE lessons SET title = ?, objective = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(updatedTitle, updatedObjective ?? null, updatedStatus, now, lessonId);

   return {
    ...current,
    title: updatedTitle,
    objective: updatedObjective,
    status: updatedStatus,
   };
  });

  return updateTx();
 }

 getLessonVersions(lessonId: string): LessonVersionRecord[] {
  const rows = this.db
   .prepare(
    'SELECT version, title, objective, status, blocks, patches, created_at FROM lesson_versions WHERE lesson_id = ? ORDER BY version ASC'
   )
   .all(lessonId) as LessonVersionRow[];

  return rows.map((r) => ({
   version: r.version,
   title: r.title,
   objective: r.objective ?? undefined,
   status: r.status as Lesson['status'],
   blocks: JSON.parse(r.blocks) as LessonBlock[],
   patches: r.patches ? (JSON.parse(r.patches) as LessonPatch[]) : undefined,
   createdAt: r.created_at,
  }));
 }
}
