import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type SessionFrameStatus = 'active' | 'completed' | 'cancelled';

export interface LearningSessionFrame {
  id: string;
  sessionId: string;
  detourPathNodeId: string;
  parentPathNodeId: string;
  savedLessonId: string;
  depth: number;
  status: SessionFrameStatus;
  diagnosisId?: string | null;
  createdAt: string;
}

export interface PushFrameParams {
  id?: string;
  sessionId: string;
  detourPathNodeId: string;
  parentPathNodeId: string;
  savedLessonId: string;
  depth?: number;
  diagnosisId?: string | null;
}

interface SessionFrameRow {
  id: string;
  session_id: string;
  detour_path_node_id: string;
  parent_path_node_id: string;
  saved_lesson_id: string;
  depth: number;
  status: string;
  diagnosis_id?: string | null;
  created_at: string;
}

function mapRowToSessionFrame(row: SessionFrameRow): LearningSessionFrame {
  return {
    id: row.id,
    sessionId: row.session_id,
    detourPathNodeId: row.detour_path_node_id,
    parentPathNodeId: row.parent_path_node_id,
    savedLessonId: row.saved_lesson_id,
    depth: row.depth,
    status: row.status as SessionFrameStatus,
    diagnosisId: row.diagnosis_id ?? null,
    createdAt: row.created_at,
  };
}

export class SessionFrameRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  pushFrame(frame: PushFrameParams): LearningSessionFrame {
    const id = frame.id ?? `frame-${randomUUID()}`;
    let depth = frame.depth;
    if (depth === undefined) {
      const active = this.peekActiveFrame(frame.sessionId);
      depth = active ? active.depth + 1 : 1;
    }
    const createdAt = new Date().toISOString();
    const status: SessionFrameStatus = 'active';
    const diagnosisId = frame.diagnosisId ?? null;

    this.db
      .prepare(
        `INSERT INTO learning_session_frames (
           id, session_id, detour_path_node_id, parent_path_node_id, saved_lesson_id, depth, status, diagnosis_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        frame.sessionId,
        frame.detourPathNodeId,
        frame.parentPathNodeId,
        frame.savedLessonId,
        depth,
        status,
        diagnosisId,
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
      diagnosisId,
      createdAt,
    };
  }

  peekActiveFrame(sessionId: string): LearningSessionFrame | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, detour_path_node_id, parent_path_node_id, saved_lesson_id, depth, status, diagnosis_id, created_at
         FROM learning_session_frames
         WHERE session_id = ? AND status = 'active'
         ORDER BY depth DESC, created_at DESC
         LIMIT 1`
      )
      .get(sessionId) as SessionFrameRow | undefined;

    if (!row) return null;
    return mapRowToSessionFrame(row);
  }

  popActiveFrame(sessionId: string): LearningSessionFrame | null {
    const active = this.peekActiveFrame(sessionId);
    if (!active) return null;

    this.db
      .prepare("UPDATE learning_session_frames SET status = 'completed' WHERE id = ?")
      .run(active.id);

    return { ...active, status: 'completed' };
  }

  getFrames(sessionId: string): LearningSessionFrame[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, detour_path_node_id, parent_path_node_id, saved_lesson_id, depth, status, diagnosis_id, created_at
         FROM learning_session_frames
         WHERE session_id = ?
         ORDER BY depth ASC, created_at ASC`
      )
      .all(sessionId) as SessionFrameRow[];

    return rows.map(mapRowToSessionFrame);
  }

  getFrame(id: string): LearningSessionFrame | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, detour_path_node_id, parent_path_node_id, saved_lesson_id, depth, status, diagnosis_id, created_at
         FROM learning_session_frames
         WHERE id = ?`
      )
      .get(id) as SessionFrameRow | undefined;

    if (!row) return null;
    return mapRowToSessionFrame(row);
  }

  updateFrameStatus(id: string, status: SessionFrameStatus): void {
    this.db
      .prepare('UPDATE learning_session_frames SET status = ? WHERE id = ?')
      .run(status, id);
  }
}
