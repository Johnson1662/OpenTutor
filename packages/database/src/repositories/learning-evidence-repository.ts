import type Database from 'better-sqlite3';
import type { LearningEvidence, LearningEvidenceOutcome, LearningEvidenceType } from '@opentutor/protocol';

interface LearningEvidenceRow {
  id: string;
  user_id: string;
  knowledge_node_id: string;
  type: string;
  source: string;
  source_item_id: string | null;
  attempt: number | null;
  outcome: string;
  difficulty: number;
  confidence: number;
  weight: number;
  assessment_id: string | null;
  session_id: string | null;
  created_at: string;
}

function mapRowToLearningEvidence(row: LearningEvidenceRow): LearningEvidence {
  return {
    id: row.id,
    userId: row.user_id,
    knowledgeNodeId: row.knowledge_node_id,
    type: row.type as LearningEvidenceType,
    source: row.source,
    sourceItemId: row.source_item_id ?? undefined,
    attempt: row.attempt ?? 1,
    outcome: row.outcome as LearningEvidenceOutcome,
    difficulty: row.difficulty,
    confidence: row.confidence,
    weight: row.weight,
    assessmentId: row.assessment_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    createdAt: row.created_at,
  };
}

export class LearningEvidenceRepository {
 private readonly db: Database.Database;

 constructor(db: Database.Database) {
  this.db = db;
 }

  recordEvidence(evidence: LearningEvidence): void {
    const createdAt = evidence.createdAt || new Date().toISOString();
    const attempt = evidence.attempt ?? 1;
    this.db
      .prepare(`
        INSERT INTO learning_evidence (
          id, user_id, knowledge_node_id, type, source, source_item_id, attempt, outcome,
          difficulty, confidence, weight, assessment_id, session_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        evidence.id,
        evidence.userId,
        evidence.knowledgeNodeId,
        evidence.type,
        evidence.source,
        evidence.sourceItemId ?? null,
        attempt,
        evidence.outcome,
        evidence.difficulty,
        evidence.confidence,
        evidence.weight,
        evidence.assessmentId ?? null,
        evidence.sessionId ?? null,
        createdAt
      );
  }

  getEvidenceForNode(userId: string, nodeId: string): LearningEvidence[] {
    const rows = this.db
      .prepare(`
        SELECT id, user_id, knowledge_node_id, type, source, source_item_id, attempt, outcome,
               difficulty, confidence, weight, assessment_id, session_id, created_at
        FROM learning_evidence
        WHERE user_id = ? AND knowledge_node_id = ?
        ORDER BY created_at ASC
      `)
      .all(userId, nodeId) as LearningEvidenceRow[];

    return rows.map(mapRowToLearningEvidence);
  }

  getEvidenceHistory(userId: string, limit?: number): LearningEvidence[] {
    if (limit !== undefined) {
      const rows = this.db
        .prepare(`
          SELECT id, user_id, knowledge_node_id, type, source, source_item_id, attempt, outcome,
                 difficulty, confidence, weight, assessment_id, session_id, created_at
          FROM learning_evidence
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(userId, limit) as LearningEvidenceRow[];
      return rows.map(mapRowToLearningEvidence);
    }

    const rows = this.db
      .prepare(`
        SELECT id, user_id, knowledge_node_id, type, source, source_item_id, attempt, outcome,
               difficulty, confidence, weight, assessment_id, session_id, created_at
        FROM learning_evidence
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .all(userId) as LearningEvidenceRow[];
    return rows.map(mapRowToLearningEvidence);
  }

 countEvidence(userId: string, nodeId: string): number {
  const result = this.db
   .prepare(`
        SELECT COUNT(*) as count
        FROM learning_evidence
        WHERE user_id = ? AND knowledge_node_id = ?
      `)
   .get(userId, nodeId) as { count: number } | undefined;

  return result?.count ?? 0;
 }

  countItemAttempts(userId: string, nodeId: string, sourceItemId: string): number {
    const result = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM learning_evidence
        WHERE user_id = ? AND knowledge_node_id = ? AND source_item_id = ?
      `)
      .get(userId, nodeId, sourceItemId) as { count: number } | undefined;

    return result?.count ?? 0;
  }
}
