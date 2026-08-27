import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  runMigrations,
  ALL_MIGRATIONS,
  LearningEvidenceRepository,
  MisconceptionRepository,
  DiagnosisRepository,
  SessionFrameRepository,
} from '../src/index.ts';
import type { LearningEvidence } from '@opentutor/protocol';

describe('Database Migration Upgrade (013 -> 014 -> 015 -> 016 -> 017 -> 018 -> 019)', () => {
  it('upgrades database from 013 to 019 preserving existing data and enabling lesson progress', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // 1. Run migrations up to 013 only
    const v13Migrations = ALL_MIGRATIONS.slice(0, 13);
    const countV13 = runMigrations(db, v13Migrations);
    assert.equal(countV13, 13);

    // Verify v13 schema for learning_evidence does NOT have source_item_id or attempt
    const v13Cols = db
      .prepare("SELECT name FROM pragma_table_info('learning_evidence')")
      .all() as Array<{ name: string }>;
    const v13ColNames = new Set(v13Cols.map((c) => c.name));
    assert.equal(v13ColNames.has('source_item_id'), false);
    assert.equal(v13ColNames.has('attempt'), false);

    // Insert prerequisite knowledge node
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO knowledge_nodes (id, title, description, created_at)
      VALUES (?, ?, ?, ?)
    `).run('attention-head', 'Attention Head', 'Core attention head mechanism', now);

    // Insert course and session for foreign key references
    db.prepare(`
      INSERT INTO courses (id, title, description, created_at)
      VALUES (?, ?, ?, ?)
    `).run('nlp-101', 'NLP 101', 'Intro to NLP', now);

    db.prepare(`
      INSERT INTO learning_sessions (id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('session-1', 'user-legacy', 'nlp-101', null, 1, now, now);

    // 2. Insert rows into learning_evidence using v13 schema (without source_item_id, attempt)
    db.prepare(`
      INSERT INTO learning_evidence (
        id, user_id, knowledge_node_id, type, source, outcome, difficulty, confidence, weight, assessment_id, session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-ev-1',
      'user-legacy',
      'attention-head',
      'quiz',
      'test-v13',
      'correct',
      1.0,
      0.9,
      1.0,
      'assess-1',
      'session-1',
      now
    );

    // 3. Run migrations 014 through 019
    const countRemaining = runMigrations(db, ALL_MIGRATIONS);
    assert.equal(countRemaining, 6);
    const progressTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lesson_step_progress'")
      .get() as { name: string } | undefined;
    assert.equal(progressTable?.name, 'lesson_step_progress');
    const progressPrimaryKey = db
      .prepare("SELECT name, pk FROM pragma_table_info('lesson_step_progress') WHERE pk > 0 ORDER BY pk")
      .all() as Array<{ name: string; pk: number }>;
    assert.deepEqual(progressPrimaryKey.map((column) => column.name), ['session_id', 'lesson_id']);
    // 4. Verify learning_evidence schema after migration 014
    const v14Cols = db
      .prepare("SELECT name FROM pragma_table_info('learning_evidence')")
      .all() as Array<{ name: string }>;
    const v14ColNames = new Set(v14Cols.map((c) => c.name));
    assert.equal(v14ColNames.has('source_item_id'), true);
    assert.equal(v14ColNames.has('attempt'), true);

    // Verify legacy evidence was preserved with null source_item_id and default attempt 1
    const evidenceRepo = new LearningEvidenceRepository(db);
    const legacyEvidence = evidenceRepo.getEvidenceForNode('user-legacy', 'attention-head');
    assert.equal(legacyEvidence.length, 1);
    assert.equal(legacyEvidence[0].id, 'legacy-ev-1');
    assert.equal(legacyEvidence[0].sourceItemId, undefined);
    assert.equal(legacyEvidence[0].attempt, 1);

    // Record new evidence with source_item_id and attempt
    const newEvidence: LearningEvidence = {
      id: 'v14-ev-1',
      userId: 'user-legacy',
      knowledgeNodeId: 'attention-head',
      type: 'quiz',
      source: 'quiz-item-1',
      sourceItemId: 'item-q1',
      attempt: 2,
      outcome: 'correct',
      difficulty: 1.2,
      confidence: 0.95,
      weight: 1.0,
      assessmentId: 'assess-2',
      sessionId: 'session-1',
      createdAt: new Date().toISOString(),
    };
    evidenceRepo.recordEvidence(newEvidence);

    assert.equal(evidenceRepo.countEvidence('user-legacy', 'attention-head'), 2);
    assert.equal(evidenceRepo.countItemAttempts('user-legacy', 'attention-head', 'item-q1'), 1);
    assert.equal(evidenceRepo.countDistinctItems('user-legacy', 'attention-head'), 1);

    // 5. Verify MisconceptionRepository (migration 015)
    const miscRepo = new MisconceptionRepository(db);
    const misconception = miscRepo.createMisconception({
      knowledgeNodeId: 'attention-head',
      title: 'Confusing Query and Key roles',
      description: 'Learner confuses query projections with key projections',
      correctionStrategy: 'Contrast Query and Key vector transformations with a visual probe',
    });
    assert.ok(misconception.id);
    assert.equal(misconception.knowledgeNodeId, 'attention-head');

    const fetchedMisc = miscRepo.getMisconception(misconception.id);
    assert.ok(fetchedMisc);
    assert.equal(fetchedMisc.title, 'Confusing Query and Key roles');

    const userMisc = miscRepo.setUserMisconception({
      userId: 'user-legacy',
      misconceptionId: misconception.id,
      confidence: 0.7,
      status: 'suspected',
    });
    assert.equal(userMisc.status, 'suspected');
    assert.equal(userMisc.confidence, 0.7);

    const userMiscDetails = miscRepo.getUserMisconceptionsForNode('user-legacy', 'attention-head');
    assert.equal(userMiscDetails.length, 1);
    assert.equal(userMiscDetails[0].misconception.title, 'Confusing Query and Key roles');

    miscRepo.incrementEvidenceCount('user-legacy', misconception.id, 0.85);
    const updatedUserMisc = miscRepo.getUserMisconception('user-legacy', misconception.id);
    assert.ok(updatedUserMisc);
    assert.equal(updatedUserMisc.evidenceCount, 1);
    assert.equal(updatedUserMisc.status, 'confirmed');

    miscRepo.resolveUserMisconception('user-legacy', misconception.id);
    const resolvedUserMisc = miscRepo.getUserMisconception('user-legacy', misconception.id);
    assert.ok(resolvedUserMisc);
    assert.equal(resolvedUserMisc.status, 'resolved');
    assert.ok(resolvedUserMisc.resolvedAt);

    // 6. Verify DiagnosisRepository (migration 015)
    const diagRepo = new DiagnosisRepository(db);
    const diagnosis = diagRepo.recordDiagnosis({
      sessionId: 'session-1',
      userId: 'user-legacy',
      knowledgeNodeId: 'attention-head',
      type: 'misconception',
      confidence: 0.8,
      status: 'suspected',
      sourceEvidenceIds: ['legacy-ev-1', 'v14-ev-1'],
    });
    assert.ok(diagnosis.id);
    assert.equal(diagnosis.sourceEvidenceIds.length, 2);

    const sessionDiags = diagRepo.getDiagnosesForSession('session-1');
    assert.equal(sessionDiags.length, 1);
    assert.equal(sessionDiags[0].id, diagnosis.id);

    diagRepo.resolveDiagnosis(diagnosis.id);
    const resolvedDiag = diagRepo.getDiagnosis(diagnosis.id);
    assert.ok(resolvedDiag);
    assert.equal(resolvedDiag.status, 'resolved');
    assert.ok(resolvedDiag.resolvedAt);

    // 7. Verify SessionFrameRepository and detour diagnosis link (migration 016)
    const frameRepo = new SessionFrameRepository(db);
    const frame = frameRepo.pushFrame({
      sessionId: 'session-1',
      detourPathNodeId: 'detour-node-1',
      parentPathNodeId: 'main-node-1',
      savedLessonId: 'lesson-1',
      depth: 1,
      diagnosisId: diagnosis.id,
    });
    assert.ok(frame.id);
    assert.equal(frame.diagnosisId, diagnosis.id);
    assert.equal(frame.status, 'active');

    const activeFrame = frameRepo.peekActiveFrame('session-1');
    assert.ok(activeFrame);
    assert.equal(activeFrame.id, frame.id);
    assert.equal(activeFrame.diagnosisId, diagnosis.id);

    const poppedFrame = frameRepo.popActiveFrame('session-1');
    assert.ok(poppedFrame);
    assert.equal(poppedFrame.status, 'completed');

    // 8. Verify migration 017: learning_evidence score column
    evidenceRepo.recordEvidence({
      id: 'v17-ev-score-1',
      userId: 'user-1',
      knowledgeNodeId: 'attention-head',
      type: 'quiz',
      source: 'lesson-1',
      sourceItemId: 'quiz-item-score-1',
      attempt: 1,
      outcome: 'partial',
      score: 0.75,
      difficulty: 1.5,
      confidence: 0.9,
      weight: 1.35,
      sessionId: 'session-1',
      createdAt: '2026-08-24T12:00:00.000Z',
    });

    const scoreEv = evidenceRepo.getEvidenceForNode('user-1', 'attention-head').find((e) => e.id === 'v17-ev-score-1');
    assert.ok(scoreEv);
    assert.equal(scoreEv.score, 0.75);

    // 9. Idempotency test: running all migrations again does nothing
    const rerunCount = runMigrations(db, ALL_MIGRATIONS);
    assert.equal(rerunCount, 0);

    db.close();
  });
  it('applies migration 017 to an already-applied v16 database without rewriting legacy rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      const countV16 = runMigrations(db, ALL_MIGRATIONS.slice(0, 16));
      assert.equal(countV16, 16);
      const appliedV16 = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
        .all() as Array<{ version: number }>;
      assert.equal(appliedV16.at(-1)?.version, 16);

      const columnsBefore = db
        .prepare("SELECT name FROM pragma_table_info('learning_evidence')")
        .all() as Array<{ name: string }>;
      assert.equal(columnsBefore.some((column) => column.name === 'score'), false);

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO knowledge_nodes (id, title, description, created_at)
         VALUES (?, ?, ?, ?)`
      ).run('v16-node', 'V16 Node', 'Legacy node', now);
      db.prepare(
        `INSERT INTO courses (id, title, description, created_at)
         VALUES (?, ?, ?, ?)`
      ).run('v16-course', 'V16 Course', 'Legacy course', now);
      db.prepare(
        `INSERT INTO learning_sessions (id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('v16-session', 'v16-user', 'v16-course', null, 1, now, now);
      db.prepare(
        `INSERT INTO learning_evidence (
           id, user_id, knowledge_node_id, type, source, source_item_id, attempt,
           outcome, difficulty, confidence, weight, assessment_id, session_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'v16-legacy-evidence',
        'v16-user',
        'v16-node',
        'quiz',
        'legacy-source',
        'legacy-item',
        1,
        'correct',
        1.0,
        1.0,
        1.0,
        'v16-assessment',
        'v16-session',
        now
      );

      const executed = runMigrations(db, ALL_MIGRATIONS);
      assert.equal(executed, 3);
      const appliedV17 = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
        .all() as Array<{ version: number }>;
      assert.deepEqual(appliedV17.map((row) => row.version), [...Array.from({ length: 19 }, (_, index) => index + 1)]);
      const columnsAfter = db
        .prepare("SELECT name FROM pragma_table_info('learning_evidence')")
        .all() as Array<{ name: string }>;
      assert.equal(columnsAfter.some((column) => column.name === 'score'), true);

      // Verify migration 018 dedupes course_nodes and enforces uniqueness
      const uniqueIndex = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_course_nodes_course_knowledge'")
        .get() as { name: string } | undefined;
      assert.equal(uniqueIndex?.name, 'idx_course_nodes_course_knowledge');

      const evidenceRepo = new LearningEvidenceRepository(db);
      const legacy = evidenceRepo.getEvidenceForNode('v16-user', 'v16-node');
      assert.equal(legacy.length, 1);
      assert.equal(legacy[0]?.id, 'v16-legacy-evidence');
      assert.equal(legacy[0]?.score, undefined);
      evidenceRepo.recordEvidence({
        id: 'v17-new-evidence',
        userId: 'v16-user',
        knowledgeNodeId: 'v16-node',
        type: 'quiz',
        source: 'new-source',
        sourceItemId: 'new-item',
        attempt: 1,
        outcome: 'partial',
        score: 0.75,
        difficulty: 1.0,
        confidence: 1.0,
        weight: 1.0,
        sessionId: 'v16-session',
        createdAt: now,
      });
      const scored = evidenceRepo.getEvidenceForNode('v16-user', 'v16-node').find((row) => row.id === 'v17-new-evidence');
      assert.equal(scored?.score, 0.75);
      assert.equal(runMigrations(db, ALL_MIGRATIONS), 0);
    } finally {
      db.close();
    }
  });
});
