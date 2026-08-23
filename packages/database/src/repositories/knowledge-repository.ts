import type Database from 'better-sqlite3';
import type { AssessmentResult, KnowledgeStatus, UserKnowledgeState } from '@opentutor/protocol';

interface UserKnowledgeStateRow {
  user_id: string;
  knowledge_node_id: string;
  status: string;
  confidence: number;
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

export class KnowledgeRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  recordAssessment(assessment: AssessmentResult, userId: string = 'default-user'): void {
    const now = new Date().toISOString();

    const statusMap: Record<AssessmentResult['result'], KnowledgeStatus> = {
      correct: 'mastered',
      partial: 'learning',
      incorrect: 'weak',
    };

    const status = statusMap[assessment.result] ?? 'learning';

    const recordTx = this.db.transaction(() => {
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

      this.db
        .prepare(`
          INSERT INTO user_knowledge_states (user_id, knowledge_node_id, status, confidence, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, knowledge_node_id) DO UPDATE SET
            status = excluded.status,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
        `)
        .run(userId, assessment.knowledgeNodeId, status, assessment.confidence, now);
    });

    recordTx();
  }

  getUserKnowledgeState(userId: string, nodeId: string): UserKnowledgeState | null {
    const row = this.db
      .prepare(
        'SELECT knowledge_node_id, status, confidence FROM user_knowledge_states WHERE user_id = ? AND knowledge_node_id = ?'
      )
      .get(userId, nodeId) as UserKnowledgeStateRow | undefined;

    if (!row) return null;

    return {
      knowledgeNodeId: row.knowledge_node_id,
      status: row.status as KnowledgeStatus,
      confidence: row.confidence,
    };
  }

  getAllUserKnowledgeStates(userId: string = 'default-user'): UserKnowledgeState[] {
    const rows = this.db
      .prepare('SELECT knowledge_node_id, status, confidence FROM user_knowledge_states WHERE user_id = ?')
      .all(userId) as UserKnowledgeStateRow[];

    return rows.map((r) => ({
      knowledgeNodeId: r.knowledge_node_id,
      status: r.status as KnowledgeStatus,
      confidence: r.confidence,
    }));
  }

  setUserKnowledgeState(userId: string, state: UserKnowledgeState): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO user_knowledge_states (user_id, knowledge_node_id, status, confidence, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, knowledge_node_id) DO UPDATE SET
          status = excluded.status,
          confidence = excluded.confidence,
          updated_at = excluded.updated_at
      `)
      .run(userId, state.knowledgeNodeId, state.status, state.confidence, now);
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
