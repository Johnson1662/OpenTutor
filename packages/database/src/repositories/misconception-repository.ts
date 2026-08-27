import type Database from 'better-sqlite3';

export interface Misconception {
  id: string;
  knowledgeNodeId: string;
  title: string;
  description: string;
  correctionStrategy?: string;
  createdAt: string;
}

export type UserMisconceptionStatus = 'suspected' | 'confirmed' | 'resolved';

export interface UserMisconception {
  userId: string;
  misconceptionId: string;
  confidence: number;
  evidenceCount: number;
  status: UserMisconceptionStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface UserMisconceptionWithDetails extends UserMisconception {
  misconception: Misconception;
}

export interface SetUserMisconceptionParams {
  userId: string;
  misconceptionId: string;
  confidence?: number;
  evidenceCount?: number;
  status?: UserMisconceptionStatus;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string | null;
}

interface UserMisconceptionRow {
  user_id: string;
  misconception_id: string;
  confidence: number;
  evidence_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface UserMisconceptionWithDetailsRow extends UserMisconceptionRow {
  m_id: string;
  m_knowledge_node_id: string;
  m_title: string;
  m_description: string;
  m_correction_strategy: string | null;
  m_created_at: string;
}

function mapRowToUserMisconception(row: UserMisconceptionRow): UserMisconception {
  return {
    userId: row.user_id,
    misconceptionId: row.misconception_id,
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    status: row.status as UserMisconceptionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export class MisconceptionRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  setUserMisconception(params: SetUserMisconceptionParams): UserMisconception {
    const now = new Date().toISOString();
    const createdAt = params.createdAt ?? now;
    const updatedAt = params.updatedAt ?? now;
    const confidence = params.confidence ?? 0.5;
    const evidenceCount = params.evidenceCount ?? 0;
    const status = params.status ?? 'suspected';
    const resolvedAt = params.resolvedAt !== undefined ? params.resolvedAt : status === 'resolved' ? now : null;

    this.db
      .prepare(
        `INSERT INTO user_misconceptions (user_id, misconception_id, confidence, evidence_count, status, created_at, updated_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, misconception_id) DO UPDATE SET
           confidence = excluded.confidence,
           evidence_count = excluded.evidence_count,
           status = excluded.status,
           updated_at = excluded.updated_at,
           resolved_at = excluded.resolved_at`
      )
      .run(
        params.userId,
        params.misconceptionId,
        confidence,
        evidenceCount,
        status,
        createdAt,
        updatedAt,
        resolvedAt
      );

    return {
      userId: params.userId,
      misconceptionId: params.misconceptionId,
      confidence,
      evidenceCount,
      status,
      createdAt,
      updatedAt,
      resolvedAt: resolvedAt ?? undefined,
    };
  }

  getUserMisconception(userId: string, misconceptionId: string): UserMisconception | null {
    const row = this.db
      .prepare(
        `SELECT user_id, misconception_id, confidence, evidence_count, status, created_at, updated_at, resolved_at
         FROM user_misconceptions
         WHERE user_id = ? AND misconception_id = ?`
      )
      .get(userId, misconceptionId) as UserMisconceptionRow | undefined;

    if (!row) return null;
    return mapRowToUserMisconception(row);
  }

  getUserMisconceptionsForNode(userId: string, knowledgeNodeId: string): UserMisconceptionWithDetails[] {
    const rows = this.db
      .prepare(
        `SELECT
           um.user_id, um.misconception_id, um.confidence, um.evidence_count, um.status, um.created_at, um.updated_at, um.resolved_at,
           m.id AS m_id, m.knowledge_node_id AS m_knowledge_node_id, m.title AS m_title, m.description AS m_description,
           m.correction_strategy AS m_correction_strategy, m.created_at AS m_created_at
         FROM user_misconceptions um
         JOIN misconceptions m ON m.id = um.misconception_id
         WHERE um.user_id = ? AND m.knowledge_node_id = ?
         ORDER BY um.updated_at DESC`
      )
      .all(userId, knowledgeNodeId) as UserMisconceptionWithDetailsRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      misconceptionId: row.misconception_id,
      confidence: row.confidence,
      evidenceCount: row.evidence_count,
      status: row.status as UserMisconceptionStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at ?? undefined,
      misconception: {
        id: row.m_id,
        knowledgeNodeId: row.m_knowledge_node_id,
        title: row.m_title,
        description: row.m_description,
        correctionStrategy: row.m_correction_strategy ?? undefined,
        createdAt: row.m_created_at,
      },
    }));
  }
}
