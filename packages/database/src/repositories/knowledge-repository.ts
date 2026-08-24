import type Database from 'better-sqlite3';
import type { AssessmentResult, KnowledgeStatus, UserKnowledgeState } from '@opentutor/protocol';

interface UserKnowledgeStateRow {
 user_id: string;
 knowledge_node_id: string;
 status: string;
 confidence: number;
 mastery_probability: number | null;
 alpha: number | null;
 beta: number | null;
 evidence_count: number | null;
 correct_count: number | null;
 incorrect_count: number | null;
 stability: number | null;
 difficulty: number | null;
 last_assessed_at: string | null;
 last_reviewed_at: string | null;
 updated_at: string;
}

interface AssessmentRow {
 id: string;
 user_id: string;
 knowledge_node_id: string;
 lesson_id: string;
 block_id: string | null;
 result: string;
 confidence: number;
 feedback: string;
 created_at: string;
}

function mapRowToUserKnowledgeState(row: UserKnowledgeStateRow): UserKnowledgeState {
 return {
  userId: row.user_id,
  knowledgeNodeId: row.knowledge_node_id,
  status: row.status as KnowledgeStatus,
  confidence: row.confidence ?? 0.0,
  masteryProbability: row.mastery_probability ?? 0.5,
  alpha: row.alpha ?? 1.0,
  beta: row.beta ?? 1.0,
  evidenceCount: row.evidence_count ?? 0,
  correctCount: row.correct_count ?? 0,
  incorrectCount: row.incorrect_count ?? 0,
  stability: row.stability ?? 7.0,
  difficulty: row.difficulty ?? 1.0,
  lastAssessedAt: row.last_assessed_at ?? undefined,
  lastReviewedAt: row.last_reviewed_at ?? undefined,
 };
}

export class KnowledgeRepository {
 private readonly db: Database.Database;

 constructor(db: Database.Database) {
  this.db = db;
 }

 recordAssessment(assessment: AssessmentResult, userId: string = 'default-user'): void {
  const now = new Date().toISOString();

  this.db
   .prepare(`
        INSERT INTO assessments (id, user_id, knowledge_node_id, lesson_id, block_id, result, confidence, feedback, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
   .run(
    assessment.id,
    userId,
    assessment.knowledgeNodeId,
    assessment.lessonId,
    assessment.blockId ?? null,
    assessment.result,
    assessment.confidence,
    assessment.feedback,
    now
   );
 }

 getUserKnowledgeState(userId: string, nodeId: string): UserKnowledgeState | null {
  const row = this.db
   .prepare(`
        SELECT user_id, knowledge_node_id, status, confidence,
               mastery_probability, alpha, beta, evidence_count,
               correct_count, incorrect_count, stability, difficulty,
               last_assessed_at, last_reviewed_at, updated_at
        FROM user_knowledge_states
        WHERE user_id = ? AND knowledge_node_id = ?
      `)
   .get(userId, nodeId) as UserKnowledgeStateRow | undefined;

  if (!row) return null;

  return mapRowToUserKnowledgeState(row);
 }

 getAllUserKnowledgeStates(userId: string = 'default-user'): UserKnowledgeState[] {
  const rows = this.db
   .prepare(`
        SELECT user_id, knowledge_node_id, status, confidence,
               mastery_probability, alpha, beta, evidence_count,
               correct_count, incorrect_count, stability, difficulty,
               last_assessed_at, last_reviewed_at, updated_at
        FROM user_knowledge_states
        WHERE user_id = ?
      `)
   .all(userId) as UserKnowledgeStateRow[];

  return rows.map(mapRowToUserKnowledgeState);
 }

 setUserKnowledgeState(userId: string, state: UserKnowledgeState): void {
  const now = new Date().toISOString();
  const masteryProbability = state.masteryProbability ?? 0.5;
  const alpha = state.alpha ?? 1.0;
  const beta = state.beta ?? 1.0;
  const evidenceCount = state.evidenceCount ?? 0;
  const correctCount = state.correctCount ?? 0;
  const incorrectCount = state.incorrectCount ?? 0;
  const stability = state.stability ?? 7.0;
  const difficulty = state.difficulty ?? 1.0;
  const lastAssessedAt = state.lastAssessedAt ?? null;
  const lastReviewedAt = state.lastReviewedAt ?? null;

  this.db
   .prepare(`
        INSERT INTO user_knowledge_states (
          user_id, knowledge_node_id, status, confidence,
          mastery_probability, alpha, beta, evidence_count,
          correct_count, incorrect_count, stability, difficulty,
          last_assessed_at, last_reviewed_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, knowledge_node_id) DO UPDATE SET
          status = excluded.status,
          confidence = excluded.confidence,
          mastery_probability = excluded.mastery_probability,
          alpha = excluded.alpha,
          beta = excluded.beta,
          evidence_count = excluded.evidence_count,
          correct_count = excluded.correct_count,
          incorrect_count = excluded.incorrect_count,
          stability = excluded.stability,
          difficulty = excluded.difficulty,
          last_assessed_at = excluded.last_assessed_at,
          last_reviewed_at = excluded.last_reviewed_at,
          updated_at = excluded.updated_at
      `)
   .run(
    userId,
    state.knowledgeNodeId,
    state.status,
    state.confidence,
    masteryProbability,
    alpha,
    beta,
    evidenceCount,
    correctCount,
    incorrectCount,
    stability,
    difficulty,
    lastAssessedAt,
    lastReviewedAt,
    now
   );
 }

 getAssessments(userId: string = 'default-user', lessonId?: string): AssessmentResult[] {
  let query = 'SELECT id, knowledge_node_id, lesson_id, block_id, result, confidence, feedback FROM assessments WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (lessonId) {
   query += ' AND lesson_id = ?';
   params.push(lessonId);
  }

  query += ' ORDER BY created_at ASC';

  const rows = this.db.prepare(query).all(...params) as AssessmentRow[];

  return rows.map((r) => ({
   id: r.id,
   knowledgeNodeId: r.knowledge_node_id,
   lessonId: r.lesson_id,
   blockId: r.block_id ?? undefined,
   result: r.result as AssessmentResult['result'],
   confidence: r.confidence,
   feedback: r.feedback,
  }));
 }
}
