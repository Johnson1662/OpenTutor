import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  seedDatabase,
  runMigrations,
  ALL_MIGRATIONS,
  KnowledgeRepository,
  LearningEvidenceRepository,
} from '../src/index.ts';
import type { LearningEvidence, UserKnowledgeState } from '@opentutor/protocol';

describe('Learning Evidence & User Knowledge State v2', () => {
  let db: Database.Database;
  let knowledgeRepo: KnowledgeRepository;
  let evidenceRepo: LearningEvidenceRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedDatabase(db);
    knowledgeRepo = new KnowledgeRepository(db);
    evidenceRepo = new LearningEvidenceRepository(db);
  });

  describe('Migration 013 Idempotency', () => {
    it('runs migrations idempotently without error', () => {
      const reapplied = runMigrations(db, ALL_MIGRATIONS);
      assert.equal(reapplied, 0);
    });

    it('has all v2 columns in user_knowledge_states table', () => {
      const columns = db
        .prepare("SELECT name FROM pragma_table_info('user_knowledge_states')")
        .all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((c) => c.name));

      assert.ok(columnNames.has('mastery_probability'));
      assert.ok(columnNames.has('alpha'));
      assert.ok(columnNames.has('beta'));
      assert.ok(columnNames.has('evidence_count'));
      assert.ok(columnNames.has('correct_count'));
      assert.ok(columnNames.has('incorrect_count'));
      assert.ok(columnNames.has('stability'));
      assert.ok(columnNames.has('difficulty'));
      assert.ok(columnNames.has('last_assessed_at'));
      assert.ok(columnNames.has('last_reviewed_at'));
    });

    it('has learning_evidence table with required columns and index', () => {
      const columns = db
        .prepare("SELECT name FROM pragma_table_info('learning_evidence')")
        .all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((c) => c.name));

      assert.ok(columnNames.has('id'));
      assert.ok(columnNames.has('user_id'));
      assert.ok(columnNames.has('knowledge_node_id'));
      assert.ok(columnNames.has('type'));
      assert.ok(columnNames.has('source'));
      assert.ok(columnNames.has('source_item_id'));
      assert.ok(columnNames.has('attempt'));
      assert.ok(columnNames.has('outcome'));
      assert.ok(columnNames.has('difficulty'));
      assert.ok(columnNames.has('confidence'));
      assert.ok(columnNames.has('weight'));
      assert.ok(columnNames.has('assessment_id'));
      assert.ok(columnNames.has('session_id'));
      assert.ok(columnNames.has('created_at'));
    });
  });

  describe('LearningEvidenceRepository', () => {
    const evidence1: LearningEvidence = {
      id: 'ev-1',
      userId: 'user-1',
      knowledgeNodeId: 'self-attention',
      type: 'quiz',
      source: 'lesson-quiz-1',
      outcome: 'correct',
      difficulty: 1.0,
      confidence: 0.9,
      weight: 1.0,
      assessmentId: 'asm-1',
      sessionId: 'session-1',
      createdAt: '2026-08-24T10:00:00.000Z',
    };

    const evidence2: LearningEvidence = {
      id: 'ev-2',
      userId: 'user-1',
      knowledgeNodeId: 'self-attention',
      type: 'probe',
      source: 'dialogue-probe',
      outcome: 'partial',
      difficulty: 1.2,
      confidence: 0.7,
      weight: 0.8,
      createdAt: '2026-08-24T11:00:00.000Z',
    };

    const evidence3: LearningEvidence = {
      id: 'ev-3',
      userId: 'user-1',
      knowledgeNodeId: 'multi-head',
      type: 'tutor_observation',
      source: 'tutor-chat',
      outcome: 'incorrect',
      difficulty: 1.4,
      confidence: 0.85,
      weight: 1.0,
      createdAt: '2026-08-24T12:00:00.000Z',
    };

    it('records evidence and counts evidence correctly', () => {
      assert.equal(evidenceRepo.countEvidence('user-1', 'self-attention'), 0);

      evidenceRepo.recordEvidence(evidence1);
      assert.equal(evidenceRepo.countEvidence('user-1', 'self-attention'), 1);

      evidenceRepo.recordEvidence(evidence2);
      assert.equal(evidenceRepo.countEvidence('user-1', 'self-attention'), 2);

      evidenceRepo.recordEvidence(evidence3);
      assert.equal(evidenceRepo.countEvidence('user-1', 'self-attention'), 2);
      assert.equal(evidenceRepo.countEvidence('user-1', 'multi-head'), 1);
    });

    it('retrieves evidence for a specific node in chronological order', () => {
      evidenceRepo.recordEvidence(evidence1);
      evidenceRepo.recordEvidence(evidence2);
      evidenceRepo.recordEvidence(evidence3);

      const nodeEvidence = evidenceRepo.getEvidenceForNode('user-1', 'self-attention');
      assert.equal(nodeEvidence.length, 2);
      assert.equal(nodeEvidence[0].id, 'ev-1');
      assert.equal(nodeEvidence[0].type, 'quiz');
      assert.equal(nodeEvidence[0].outcome, 'correct');
      assert.equal(nodeEvidence[0].assessmentId, 'asm-1');
      assert.equal(nodeEvidence[0].sessionId, 'session-1');

      assert.equal(nodeEvidence[1].id, 'ev-2');
      assert.equal(nodeEvidence[1].type, 'probe');
      assert.equal(nodeEvidence[1].outcome, 'partial');
      assert.equal(nodeEvidence[1].assessmentId, undefined);
    });

    it('retrieves evidence history with and without limit', () => {
      evidenceRepo.recordEvidence(evidence1);
      evidenceRepo.recordEvidence(evidence2);
      evidenceRepo.recordEvidence(evidence3);

      const allHistory = evidenceRepo.getEvidenceHistory('user-1');
      assert.equal(allHistory.length, 3);
      assert.equal(allHistory[0].id, 'ev-3'); // Newest first
      assert.equal(allHistory[1].id, 'ev-2');
      assert.equal(allHistory[2].id, 'ev-1');

      const limitedHistory = evidenceRepo.getEvidenceHistory('user-1', 2);
      assert.equal(limitedHistory.length, 2);
      assert.equal(limitedHistory[0].id, 'ev-3');
      assert.equal(limitedHistory[1].id, 'ev-2');
    });

    it('records sourceItemId and attempt and counts item attempts correctly', () => {
      assert.equal(evidenceRepo.countItemAttempts('user-1', 'self-attention', 'item-q1'), 0);

      evidenceRepo.recordEvidence({
        ...evidence1,
        id: 'ev-item-1',
        sourceItemId: 'item-q1',
        attempt: 1,
      });
      assert.equal(evidenceRepo.countItemAttempts('user-1', 'self-attention', 'item-q1'), 1);

      evidenceRepo.recordEvidence({
        ...evidence1,
        id: 'ev-item-2',
        sourceItemId: 'item-q1',
        attempt: 2,
      });
      assert.equal(evidenceRepo.countItemAttempts('user-1', 'self-attention', 'item-q1'), 2);
      assert.equal(evidenceRepo.countItemAttempts('user-1', 'self-attention', 'item-q2'), 0);

      const retrieved = evidenceRepo.getEvidenceForNode('user-1', 'self-attention');
      const item1 = retrieved.find((e) => e.id === 'ev-item-1');
      assert.equal(item1?.sourceItemId, 'item-q1');
      assert.equal(item1?.attempt, 1);
    });
  });

  describe('User Knowledge State v2 Persistence', () => {
    it('persists and retrieves full UserKnowledgeState v2 with all fields', () => {
      const v2State: UserKnowledgeState = {
        userId: 'user-1',
        knowledgeNodeId: 'self-attention',
        status: 'learning',
        confidence: 0.75,
        masteryProbability: 0.68,
        alpha: 2.5,
        beta: 1.5,
        evidenceCount: 4,
        correctCount: 3,
        incorrectCount: 1,
        stability: 8.5,
        difficulty: 1.1,
        lastAssessedAt: '2026-08-24T10:30:00.000Z',
        lastReviewedAt: '2026-08-24T10:35:00.000Z',
      };

      knowledgeRepo.setUserKnowledgeState('user-1', v2State);

      const fetched = knowledgeRepo.getUserKnowledgeState('user-1', 'self-attention');
      assert.ok(fetched);
      assert.equal(fetched.userId, 'user-1');
      assert.equal(fetched.knowledgeNodeId, 'self-attention');
      assert.equal(fetched.status, 'learning');
      assert.equal(fetched.confidence, 0.75);
      assert.equal(fetched.masteryProbability, 0.68);
      assert.equal(fetched.alpha, 2.5);
      assert.equal(fetched.beta, 1.5);
      assert.equal(fetched.evidenceCount, 4);
      assert.equal(fetched.correctCount, 3);
      assert.equal(fetched.incorrectCount, 1);
      assert.equal(fetched.stability, 8.5);
      assert.equal(fetched.difficulty, 1.1);
      assert.equal(fetched.lastAssessedAt, '2026-08-24T10:30:00.000Z');
      assert.equal(fetched.lastReviewedAt, '2026-08-24T10:35:00.000Z');
    });

    it('provides backward compatible defaults when optional v2 fields are omitted', () => {
      const partialState: UserKnowledgeState = {
        knowledgeNodeId: 'multi-head',
        status: 'weak',
        confidence: 0.2,
        masteryProbability: 0.5,
        alpha: 1.0,
        beta: 1.0,
        evidenceCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        stability: 7.0,
        difficulty: 1.0,
      };

      knowledgeRepo.setUserKnowledgeState('user-1', partialState);

      const fetched = knowledgeRepo.getUserKnowledgeState('user-1', 'multi-head');
      assert.ok(fetched);
      assert.equal(fetched.status, 'weak');
      assert.equal(fetched.confidence, 0.2);
      assert.equal(fetched.masteryProbability, 0.5);
      assert.equal(fetched.alpha, 1.0);
      assert.equal(fetched.beta, 1.0);
      assert.equal(fetched.evidenceCount, 0);
      assert.equal(fetched.correctCount, 0);
      assert.equal(fetched.incorrectCount, 0);
      assert.equal(fetched.stability, 7.0);
      assert.equal(fetched.difficulty, 1.0);
      assert.equal(fetched.lastAssessedAt, undefined);
      assert.equal(fetched.lastReviewedAt, undefined);
    });

    it('retrieves all user knowledge states with v2 fields', () => {
      const state1: UserKnowledgeState = {
        userId: 'user-2',
        knowledgeNodeId: 'self-attention',
        status: 'mastered',
        confidence: 0.95,
        masteryProbability: 0.92,
        alpha: 4.0,
        beta: 1.0,
        evidenceCount: 5,
        correctCount: 5,
        incorrectCount: 0,
        stability: 14.0,
        difficulty: 0.8,
      };

      const state2: UserKnowledgeState = {
        userId: 'user-2',
        knowledgeNodeId: 'multi-head',
        status: 'learning',
        confidence: 0.6,
        masteryProbability: 0.55,
        alpha: 2.0,
        beta: 2.0,
        evidenceCount: 2,
        correctCount: 1,
        incorrectCount: 1,
        stability: 6.0,
        difficulty: 1.2,
      };

      knowledgeRepo.setUserKnowledgeState('user-2', state1);
      knowledgeRepo.setUserKnowledgeState('user-2', state2);

      const states = knowledgeRepo.getAllUserKnowledgeStates('user-2');
      assert.equal(states.length, 2);

      const nodeMap = new Map(states.map((s) => [s.knowledgeNodeId, s]));
      const fetched1 = nodeMap.get('self-attention')!;
      assert.ok(fetched1);
      assert.equal(fetched1.status, 'mastered');
      assert.equal(fetched1.masteryProbability, 0.92);
      assert.equal(fetched1.alpha, 4.0);
      assert.equal(fetched1.evidenceCount, 5);

      const fetched2 = nodeMap.get('multi-head')!;
      assert.ok(fetched2);
      assert.equal(fetched2.status, 'learning');
      assert.equal(fetched2.masteryProbability, 0.55);
      assert.equal(fetched2.alpha, 2.0);
      assert.equal(fetched2.evidenceCount, 2);
    });
  });
});
