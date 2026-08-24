import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import type {
  LearningDiagnosis,
  LearningDiagnosisStatus,
  LearningDiagnosisType,
} from '@opentutor/protocol';

export type {
  LearningDiagnosis,
  LearningDiagnosisStatus,
  LearningDiagnosisType,
};

export interface RecordDiagnosisParams {
  id?: string;
  sessionId: string;
  userId: string;
  knowledgeNodeId: string;
  type: LearningDiagnosisType;
  confidence?: number;
  status?: LearningDiagnosisStatus;
  sourceEvidenceIds?: string[];
  createdAt?: string;
  resolvedAt?: string | null;
}

interface DiagnosisRow {
  id: string;
  session_id: string;
  user_id: string;
  knowledge_node_id: string;
  type: string;
  confidence: number;
  status: string;
  source_evidence_ids: string;
  created_at: string;
  resolved_at: string | null;
}

function parseSourceEvidenceIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function mapRowToDiagnosis(row: DiagnosisRow): LearningDiagnosis {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    knowledgeNodeId: row.knowledge_node_id,
    type: row.type as LearningDiagnosisType,
    confidence: row.confidence,
    status: row.status as LearningDiagnosisStatus,
    sourceEvidenceIds: parseSourceEvidenceIds(row.source_evidence_ids),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export class DiagnosisRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  recordDiagnosis(params: RecordDiagnosisParams): LearningDiagnosis {
    const id = params.id ?? `diag-${randomUUID()}`;
    const createdAt = params.createdAt ?? new Date().toISOString();
    const confidence = params.confidence ?? 0.5;
    const status = params.status ?? 'suspected';
    const sourceEvidenceIds = params.sourceEvidenceIds ?? [];
    const sourceEvidenceJson = JSON.stringify(sourceEvidenceIds);
    const resolvedAt = params.resolvedAt !== undefined ? params.resolvedAt : status === 'resolved' ? createdAt : null;

    this.db
      .prepare(
        `INSERT INTO learning_diagnoses (
           id, session_id, user_id, knowledge_node_id, type, confidence, status, source_evidence_ids, created_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.sessionId,
        params.userId,
        params.knowledgeNodeId,
        params.type,
        confidence,
        status,
        sourceEvidenceJson,
        createdAt,
        resolvedAt
      );

    return {
      id,
      sessionId: params.sessionId,
      userId: params.userId,
      knowledgeNodeId: params.knowledgeNodeId,
      type: params.type,
      confidence,
      status,
      sourceEvidenceIds,
      createdAt,
      resolvedAt: resolvedAt ?? undefined,
    };
  }

  createDiagnosis(params: RecordDiagnosisParams): LearningDiagnosis {
    return this.recordDiagnosis(params);
  }

  listDiagnosesBySession(sessionId: string): LearningDiagnosis[] {
    return this.getDiagnosesForSession(sessionId);
  }

  listDiagnosesByUser(userId: string, status?: LearningDiagnosisStatus): LearningDiagnosis[] {
    return this.getDiagnosesForUser(userId, status);
  }
  getDiagnosis(id: string): LearningDiagnosis | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, user_id, knowledge_node_id, type, confidence, status, source_evidence_ids, created_at, resolved_at
         FROM learning_diagnoses
         WHERE id = ?`
      )
      .get(id) as DiagnosisRow | undefined;

    if (!row) return null;
    return mapRowToDiagnosis(row);
  }

  getDiagnosesForSession(sessionId: string): LearningDiagnosis[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, user_id, knowledge_node_id, type, confidence, status, source_evidence_ids, created_at, resolved_at
         FROM learning_diagnoses
         WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId) as DiagnosisRow[];

    return rows.map(mapRowToDiagnosis);
  }

  getDiagnosesForUser(userId: string, status?: LearningDiagnosisStatus): LearningDiagnosis[] {
    if (status !== undefined) {
      const rows = this.db
        .prepare(
          `SELECT id, session_id, user_id, knowledge_node_id, type, confidence, status, source_evidence_ids, created_at, resolved_at
           FROM learning_diagnoses
           WHERE user_id = ? AND status = ?
           ORDER BY created_at DESC`
        )
        .all(userId, status) as DiagnosisRow[];
      return rows.map(mapRowToDiagnosis);
    }

    const rows = this.db
      .prepare(
        `SELECT id, session_id, user_id, knowledge_node_id, type, confidence, status, source_evidence_ids, created_at, resolved_at
         FROM learning_diagnoses
         WHERE user_id = ?
         ORDER BY created_at DESC`
      )
      .all(userId) as DiagnosisRow[];

    return rows.map(mapRowToDiagnosis);
  }

  getDiagnosesForNode(userId: string, knowledgeNodeId: string): LearningDiagnosis[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, user_id, knowledge_node_id, type, confidence, status, source_evidence_ids, created_at, resolved_at
         FROM learning_diagnoses
         WHERE user_id = ? AND knowledge_node_id = ?
         ORDER BY created_at DESC`
      )
      .all(userId, knowledgeNodeId) as DiagnosisRow[];

    return rows.map(mapRowToDiagnosis);
  }

  updateDiagnosisStatus(id: string, status: LearningDiagnosisStatus, resolvedAt?: string | null): void {
    const now = new Date().toISOString();
    const resolved = resolvedAt !== undefined ? resolvedAt : status === 'resolved' ? now : null;

    this.db
      .prepare('UPDATE learning_diagnoses SET status = ?, resolved_at = ? WHERE id = ?')
      .run(status, resolved, id);
  }

  resolveDiagnosis(id: string, resolvedAt?: string): void {
    const resolved = resolvedAt ?? new Date().toISOString();
    this.updateDiagnosisStatus(id, 'resolved', resolved);
  }
}
