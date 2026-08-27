import type Database from 'better-sqlite3';
import type { LessonStepProgress } from '@opentutor/protocol';
import { NotFoundError, VersionConflictError } from '../errors.ts';

interface LessonProgressRow {
  session_id: string;
  lesson_id: string;
  active_block_id: string | null;
  completed_block_ids: string;
  version: number;
  updated_at: string;
}

export class ProgressStateConflictError extends Error {
  readonly sessionId: string;
  readonly lessonId: string;
  readonly expectedBlockId: string | null;
  readonly actualBlockId: string | null;

  constructor(
    sessionId: string,
    lessonId: string,
    expectedBlockId: string | null,
    actualBlockId: string | null
  ) {
    super(
      `Active block conflict for lesson '${lessonId}': expected '${expectedBlockId ?? 'none'}', ` +
        `but current block is '${actualBlockId ?? 'none'}'`
    );
    this.name = 'ProgressStateConflictError';
    this.sessionId = sessionId;
    this.lessonId = lessonId;
    this.expectedBlockId = expectedBlockId;
    this.actualBlockId = actualBlockId;
  }
}

export interface AdvanceLessonProgressResult {
  progress: LessonStepProgress;
  completed: boolean;
}

function uniqueBlockIds(blockIds: string[]): string[] {
  return [...new Set(blockIds)];
}

function parseCompletedBlockIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function toProgress(row: LessonProgressRow): LessonStepProgress {
  return {
    sessionId: row.session_id,
    lessonId: row.lesson_id,
    activeBlockId: row.active_block_id,
    completedBlockIds: parseCompletedBlockIds(row.completed_block_ids),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export class LessonProgressRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(sessionId: string, lessonId: string): LessonStepProgress | null {
    const row = this.db
      .prepare(
        `SELECT session_id, lesson_id, active_block_id, completed_block_ids, version, updated_at
         FROM lesson_step_progress
         WHERE session_id = ? AND lesson_id = ?`
      )
      .get(sessionId, lessonId) as LessonProgressRow | undefined;
    return row ? toProgress(row) : null;
  }

  getOrCreate(sessionId: string, lessonId: string, blockIds: string[]): LessonStepProgress {
    const normalizedIds = uniqueBlockIds(blockIds);
    const existing = this.get(sessionId, lessonId);
    if (existing) return this.reconcileProgress(existing, normalizedIds);

    const now = new Date().toISOString();
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO lesson_step_progress
           (session_id, lesson_id, active_block_id, completed_block_ids, version, updated_at)
           VALUES (?, ?, ?, '[]', 1, ?)`
        )
        .run(sessionId, lessonId, normalizedIds[0] ?? null, now);
    });
    insert();

    const created = this.get(sessionId, lessonId);
    if (!created) {
      throw new NotFoundError('Lesson progress', `${sessionId}:${lessonId}`);
    }
    return this.reconcileProgress(created, normalizedIds);
  }

  restart(
    sessionId: string,
    lessonId: string,
    expectedVersion: number,
    blockIds: string[],
    expectedActiveBlockId?: string | null
  ): AdvanceLessonProgressResult {
    const normalizedIds = uniqueBlockIds(blockIds);
    const restartTx = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT session_id, lesson_id, active_block_id, completed_block_ids, version, updated_at
           FROM lesson_step_progress
           WHERE session_id = ? AND lesson_id = ?`
        )
        .get(sessionId, lessonId) as LessonProgressRow | undefined;
      if (!row) {
        throw new NotFoundError('Lesson progress', `${sessionId}:${lessonId}`);
      }
      if (row.version !== expectedVersion) {
        throw new VersionConflictError(`${sessionId}:${lessonId}`, expectedVersion, row.version);
      }
      if (expectedActiveBlockId !== undefined && row.active_block_id !== expectedActiveBlockId) {
        throw new ProgressStateConflictError(
          sessionId,
          lessonId,
          expectedActiveBlockId,
          row.active_block_id
        );
      }
      const now = new Date().toISOString();
      const version = row.version + 1;
      const activeBlockId = normalizedIds[0] ?? null;
      this.db
        .prepare(
          `UPDATE lesson_step_progress
           SET active_block_id = ?, completed_block_ids = '[]', version = ?, updated_at = ?
           WHERE session_id = ? AND lesson_id = ?`
        )
        .run(activeBlockId, version, now, sessionId, lessonId);
      return {
        progress: {
          sessionId,
          lessonId,
          activeBlockId,
          completedBlockIds: [],
          version,
          updatedAt: now,
        },
        completed: normalizedIds.length === 0,
      };
    });
    return restartTx();
  }

  activate(sessionId: string, lessonId: string, activeBlockId: string): LessonStepProgress {
    const activateTx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT session_id, lesson_id, active_block_id, completed_block_ids, version, updated_at FROM lesson_step_progress WHERE session_id = ? AND lesson_id = ?')
        .get(sessionId, lessonId) as LessonProgressRow | undefined;
      if (!row) {
        throw new NotFoundError('Lesson progress', sessionId + ':' + lessonId);
      }

      const current = toProgress(row);
      if (current.activeBlockId === activeBlockId) return current;

      const now = new Date().toISOString();
      const version = current.version + 1;
      this.db
        .prepare('UPDATE lesson_step_progress SET active_block_id = ?, version = ?, updated_at = ? WHERE session_id = ? AND lesson_id = ?')
        .run(activeBlockId, version, now, sessionId, lessonId);

      return {
        ...current,
        activeBlockId,
        version,
        updatedAt: now,
      };
    });
    return activateTx();
  }

  advance(
    sessionId: string,
    lessonId: string,
    expectedVersion: number,
    activeBlockId: string | null,
    blockIds: string[]
  ): AdvanceLessonProgressResult {
    const normalizedIds = uniqueBlockIds(blockIds);
    const advanceTx = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT session_id, lesson_id, active_block_id, completed_block_ids, version, updated_at
           FROM lesson_step_progress
           WHERE session_id = ? AND lesson_id = ?`
        )
        .get(sessionId, lessonId) as LessonProgressRow | undefined;

      if (!row) {
        throw new NotFoundError('Lesson progress', `${sessionId}:${lessonId}`);
      }
      if (row.version !== expectedVersion) {
        throw new VersionConflictError(`${sessionId}:${lessonId}`, expectedVersion, row.version);
      }

      const current = toProgress(row);
      if (current.activeBlockId !== activeBlockId) {
        throw new ProgressStateConflictError(
          sessionId,
          lessonId,
          activeBlockId,
          current.activeBlockId
        );
      }
      if (current.activeBlockId && !normalizedIds.includes(current.activeBlockId)) {
        throw new ProgressStateConflictError(
          sessionId,
          lessonId,
          current.activeBlockId,
          null
        );
      }

      if (
        !current.activeBlockId &&
        normalizedIds.length > 0 &&
        current.completedBlockIds.length === normalizedIds.length
      ) {
        throw new ProgressStateConflictError(sessionId, lessonId, activeBlockId, null);
      }
      if (!current.activeBlockId && normalizedIds.length > 0 && current.completedBlockIds.length < normalizedIds.length) {
        throw new ProgressStateConflictError(sessionId, lessonId, activeBlockId, normalizedIds[0] ?? null);
      }

      const completed = new Set(current.completedBlockIds);
      if (current.activeBlockId) completed.add(current.activeBlockId);
      const completedBlockIds = normalizedIds.filter((id) => completed.has(id));
      const nextBlockId = normalizedIds.find((id) => !completed.has(id)) ?? null;
      const now = new Date().toISOString();
      const version = current.version + 1;

      this.db
        .prepare(
          `UPDATE lesson_step_progress
           SET active_block_id = ?, completed_block_ids = ?, version = ?, updated_at = ?
           WHERE session_id = ? AND lesson_id = ?`
        )
        .run(
          nextBlockId,
          JSON.stringify(completedBlockIds),
          version,
          now,
          sessionId,
          lessonId
        );

      const progress: LessonStepProgress = {
        sessionId,
        lessonId,
        activeBlockId: nextBlockId,
        completedBlockIds,
        version,
        updatedAt: now,
      };
      return {
        progress,
        completed: normalizedIds.length === completedBlockIds.length && nextBlockId === null,
      };
    });

    return advanceTx();
  }

  reconcile(sessionId: string, lessonId: string, blockIds: string[]): LessonStepProgress {
    const normalizedIds = uniqueBlockIds(blockIds);
    const current = this.get(sessionId, lessonId);
    if (!current) return this.getOrCreate(sessionId, lessonId, normalizedIds);
    return this.reconcileProgress(current, normalizedIds);
  }

  private reconcileProgress(progress: LessonStepProgress, blockIds: string[]): LessonStepProgress {
    const allowed = new Set(blockIds);
    const completedBlockIds = progress.completedBlockIds.filter((id) => allowed.has(id));
    const completed = new Set(completedBlockIds);
    const activeBlockId =
      progress.activeBlockId && allowed.has(progress.activeBlockId) && !completed.has(progress.activeBlockId)
        ? progress.activeBlockId
        : blockIds.find((id) => !completed.has(id)) ?? null;

    if (
      activeBlockId === progress.activeBlockId &&
      completedBlockIds.length === progress.completedBlockIds.length &&
      completedBlockIds.every((id, index) => id === progress.completedBlockIds[index])
    ) {
      return progress;
    }

    const now = new Date().toISOString();
    const version = progress.version + 1;
    this.db
      .prepare(
        `UPDATE lesson_step_progress
         SET active_block_id = ?, completed_block_ids = ?, version = ?, updated_at = ?
         WHERE session_id = ? AND lesson_id = ?`
      )
      .run(
        activeBlockId,
        JSON.stringify(completedBlockIds),
        version,
        now,
        progress.sessionId,
        progress.lessonId
      );

    return {
      ...progress,
      activeBlockId,
      completedBlockIds,
      version,
      updatedAt: now,
    };
  }
}
