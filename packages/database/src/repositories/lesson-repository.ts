import type Database from 'better-sqlite3';
import type { Lesson, LessonBlock, LessonPatch, PatchPosition } from '@opentutor/protocol';
import {
  BlockNotFoundError,
  DuplicateBlockIdError,
  EmptyPatchError,
  ImmutablePropertyError,
  NotFoundError,
  TargetNotFoundError,
  VersionConflictError,
} from '../errors.ts';

export function findBlockInsertIndex(ids: string[], position: PatchPosition): number {
  if ('index' in position) {
    return Math.max(0, Math.min(position.index, ids.length));
  }
  if ('before' in position) {
    const index = ids.indexOf(position.before);
    if (index < 0) {
      throw new TargetNotFoundError(position.before);
    }
    return index;
  }
  if ('after' in position) {
    const index = ids.indexOf(position.after);
    if (index < 0) {
      throw new TargetNotFoundError(position.after);
    }
    return index + 1;
  }
  return ids.length;
}

export function applyLessonBlockPatches(blocks: LessonBlock[], patches: LessonPatch[]): LessonBlock[] {
  if (!patches || patches.length === 0) {
    throw new EmptyPatchError();
  }

  let updatedBlocks = [...blocks];

  for (const patch of patches) {
    const existingIds = new Set(updatedBlocks.map((b) => b.id));

    switch (patch.op) {
      case 'insert': {
        if (existingIds.has(patch.block.id)) {
          throw new DuplicateBlockIdError(patch.block.id);
        }
        const index = findBlockInsertIndex(
          updatedBlocks.map((b) => b.id),
          patch.position
        );
        updatedBlocks.splice(index, 0, patch.block);
        break;
      }
      case 'replace': {
        if (!existingIds.has(patch.blockId)) {
          throw new BlockNotFoundError(patch.blockId);
        }
        if (patch.block.id !== patch.blockId && existingIds.has(patch.block.id)) {
          throw new DuplicateBlockIdError(patch.block.id);
        }
        updatedBlocks = updatedBlocks.map((b) => (b.id === patch.blockId ? patch.block : b));
        break;
      }
      case 'update': {
        if (!existingIds.has(patch.blockId)) {
          throw new BlockNotFoundError(patch.blockId);
        }
        if ('id' in patch.changes && patch.changes.id !== patch.blockId) {
          throw new ImmutablePropertyError('id');
        }
        if ('type' in patch.changes) {
          const target = updatedBlocks.find((b) => b.id === patch.blockId);
          if (target && patch.changes.type !== target.type) {
            throw new ImmutablePropertyError('type');
          }
        }
        updatedBlocks = updatedBlocks.map((b) =>
          b.id === patch.blockId ? ({ ...b, ...patch.changes } as LessonBlock) : b
        );
        break;
      }
      case 'remove': {
        if (!existingIds.has(patch.blockId)) {
          throw new BlockNotFoundError(patch.blockId);
        }
        updatedBlocks = updatedBlocks.filter((b) => b.id !== patch.blockId);
        break;
      }
      case 'move': {
        if (!existingIds.has(patch.blockId)) {
          throw new BlockNotFoundError(patch.blockId);
        }
        const fromIndex = updatedBlocks.findIndex((b) => b.id === patch.blockId);
        const [movedBlock] = updatedBlocks.splice(fromIndex, 1);
        const toIndex = findBlockInsertIndex(
          updatedBlocks.map((b) => b.id),
          patch.position
        );
        updatedBlocks.splice(toIndex, 0, movedBlock);
        break;
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
  id: number;
  lessonId: string;
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
    });

    saveTx();
  }

  applyPatches(
    lessonId: string,
    baseVersion: number,
    patches: LessonPatch[]
  ): { lesson: Lesson; newVersion: number } {
    const applyTx = this.db.transaction(() => {
      const current = this.getLesson(lessonId);
      if (!current) {
        throw new NotFoundError('Lesson', lessonId);
      }

      if (current.version !== baseVersion) {
        throw new VersionConflictError(lessonId, baseVersion, current.version);
      }

      const nextBlocks = applyLessonBlockPatches(current.blocks, patches);
      const newVersion = current.version + 1;
      const now = new Date().toISOString();

      const updatedLesson: Lesson = {
        ...current,
        version: newVersion,
        blocks: nextBlocks,
      };

      this.db
        .prepare('UPDATE lessons SET version = ?, blocks = ?, updated_at = ? WHERE id = ?')
        .run(newVersion, JSON.stringify(nextBlocks), now, lessonId);

      this.db
        .prepare(
          `INSERT INTO lesson_versions (lesson_id, version, title, objective, status, blocks, patches, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          lessonId,
          newVersion,
          updatedLesson.title,
          updatedLesson.objective ?? null,
          updatedLesson.status,
          JSON.stringify(nextBlocks),
          JSON.stringify(patches),
          now
        );

      return { lesson: updatedLesson, newVersion };
    });

    return applyTx();
  }

  getLessonVersions(lessonId: string): LessonVersionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, lesson_id, version, title, objective, status, blocks, patches, created_at FROM lesson_versions WHERE lesson_id = ? ORDER BY version ASC'
      )
      .all(lessonId) as LessonVersionRow[];

    return rows.map((row) => ({
      id: row.id,
      lessonId: row.lesson_id,
      version: row.version,
      title: row.title,
      objective: row.objective ?? undefined,
      status: row.status as Lesson['status'],
      blocks: JSON.parse(row.blocks) as LessonBlock[],
      patches: row.patches ? (JSON.parse(row.patches) as LessonPatch[]) : undefined,
      createdAt: row.created_at,
    }));
  }
}
