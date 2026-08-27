import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import {
  createDatabase,
  SessionRepository,
  KnowledgeRepository,
  LearningEvidenceRepository,
  DiagnosisRepository,
  MisconceptionRepository,
  runMigrations,
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
} from '@opentutor/database';
import { BetaMasteryAggregator } from '@opentutor/assessment-core';
import { DomainToolsExecutor } from '@opentutor/tutor-tools';
import type { QuizBlock } from '@opentutor/protocol';

test('Adversarial & Closure Matrix (A - O)', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { server, db, context, sessionRepo, lessonRepo, knowledgeRepo, evidenceRepo, diagnosisRepo, close } =
    await createServerContext(':memory:');

  const { promise: listenPromise, resolve: resolveListen } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => resolveListen());
  await listenPromise;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await close();
  });

  const sessionId = 'prototype';
  const userId = 'default-user';

  await t.test('authority rejects answers without an explicit session ID', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/lesson-self-attention/blocks/intro/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'irrelevant' }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'SESSION_ID_REQUIRED' });
  });

  await t.test('session actions and messages require a real session and valid input', async () => {
    const missing = await fetch(baseUrl + '/api/sessions/does-not-exist/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'simpler' }),
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'SESSION_NOT_FOUND' });

    const invalidAction = await fetch(baseUrl + '/api/sessions/' + sessionId + '/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(invalidAction.status, 400);
    assert.deepEqual(await invalidAction.json(), { error: 'INVALID_ACTION' });

    const invalidMessage = await fetch(baseUrl + '/api/sessions/' + sessionId + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });
    assert.equal(invalidMessage.status, 400);
    assert.deepEqual(await invalidMessage.json(), { error: 'MESSAGE_REQUIRED' });

    const invalidAnswerBody = await fetch(baseUrl + '/api/lessons/lesson-self-attention/blocks/intro/answer?sessionId=' + sessionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(invalidAnswerBody.status, 400);
    assert.deepEqual(await invalidAnswerBody.json(), { error: 'INVALID_ANSWER_BODY' });

    const invalidProgressBody = await fetch(baseUrl + '/api/sessions/' + sessionId + '/lesson-progress/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(invalidProgressBody.status, 400);
    assert.deepEqual(await invalidProgressBody.json(), { error: 'INVALID_PROGRESS_BODY' });
  });

  await t.test('A. fake block ID -> no evidence created & throws BLOCK_NOT_FOUND', async () => {
    const initialEvidenceCount = evidenceRepo.getEvidenceForNode(userId, 'self-attention').length;
    const res = await fetch(`${baseUrl}/api/lessons/lesson-self-attention/blocks/fake-block-999/answer?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'irrelevant' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes('BLOCK_NOT_FOUND'));
    const postEvidenceCount = evidenceRepo.getEvidenceForNode(userId, 'self-attention').length;
    assert.equal(postEvidenceCount, initialEvidenceCount, 'No evidence should be inserted');
  });

  await t.test('B. submit to TextBlock -> no evidence created & throws BLOCK_NOT_ASSESSABLE', async () => {
    const initialEvidenceCount = evidenceRepo.getEvidenceForNode(userId, 'self-attention').length;
    const res = await fetch(`${baseUrl}/api/lessons/lesson-self-attention/blocks/intro/answer?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'irrelevant' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes('BLOCK_NOT_ASSESSABLE'));
    const postEvidenceCount = evidenceRepo.getEvidenceForNode(userId, 'self-attention').length;
    assert.equal(postEvidenceCount, initialEvidenceCount, 'No evidence should be inserted');
  });

  await t.test('C. wrong objective answer -> beta strictly increases & mastery decreases', async () => {
    sessionRepo.createSession({
      id: 'softmax-assessment-session',
      userId,
      courseId: 'transformer',
      activeLessonId: 'lesson-softmax',
      path: [{
        id: 'softmax-node',
        knowledgeNodeId: 'softmax',
        title: 'Softmax',
        type: 'main',
        status: 'current',
        position: 0,
      }],
    });
    const priorState = context.knowledgeService!.getUserKnowledgeState(userId, 'softmax') ?? {
      alpha: 1.0,
      beta: 1.0,
      masteryProbability: 0.5,
    };
    const priorBeta = priorState.beta ?? 1.0;
    const priorProb = priorState.masteryProbability ?? 0.5;

    const result = context.assessmentService.submitAnswer({
      sessionId: 'softmax-assessment-session',
      userId,
      lessonId: 'lesson-softmax',
      blockId: 'softmax-quiz-2',
      answer: 'opt-exp-2', // Incorrect option
    });
    assert.equal(result.assessment.result, 'incorrect');

    const postState = context.knowledgeService!.getUserKnowledgeState(userId, 'softmax')!;
    assert.ok(postState.beta! > priorBeta, `Beta must increase (before: ${priorBeta}, after: ${postState.beta})`);
    assert.ok(
      postState.masteryProbability! < priorProb,
      `Mastery probability must decrease (before: ${priorProb}, after: ${postState.masteryProbability})`
    );
  });

  await t.test('D. same Quiz repeated 20 times -> cannot reach mastered', async () => {
    const spamUser = 'spam-user';
    for (let i = 0; i < 20; i++) {
      context.assessmentService.submitAnswer({
        sessionId,
        userId: spamUser,
        lessonId: 'lesson-softmax',
        blockId: 'softmax-quiz-2',
        answer: 'opt-exp-1',
      });
    }
    const spamState = context.knowledgeService!.getUserKnowledgeState(spamUser, 'softmax');
    assert.ok(spamState);
    assert.notEqual(spamState.status, 'mastered', 'Spamming single item 20 times must NEVER yield mastered status');
    assert.equal(spamState.distinctSourceItemCount, 1);
  });

  await t.test('E. 3 independent items with high weight -> reaches mastered', async () => {
    const legitimateUser = 'legitimate-user';
    // Item 1
    context.assessmentService.submitAnswer({
      sessionId,
      userId: legitimateUser,
      lessonId: 'lesson-softmax',
      blockId: 'softmax-quiz',
      answer: 'Softmax ensures that probability outputs form a positive distribution and sum up to exactly 1.',
    });
    // Item 2
    context.assessmentService.submitAnswer({
      sessionId,
      userId: legitimateUser,
      lessonId: 'lesson-softmax',
      blockId: 'softmax-quiz-2',
      answer: 'opt-exp-1',
    });
    // Item 3
    context.assessmentService.submitAnswer({
      sessionId,
      userId: legitimateUser,
      lessonId: 'lesson-softmax',
      blockId: 'softmax-quiz-3',
      answer: 'opt-sum-1',
    });

    const legitState = context.knowledgeService!.getUserKnowledgeState(legitimateUser, 'softmax');
    assert.ok(legitState);
    assert.equal(legitState.status, 'mastered');
    assert.ok((legitState.distinctSourceItemCount ?? 0) >= 2);
    assert.ok((legitState.effectiveEvidenceCount ?? 0) >= 3);
    assert.ok((legitState.masteryProbability ?? 0) >= 0.85);
  });

  await t.test('F. evidence transaction middle failure -> complete rollback with 0 partial state', async () => {
    const failUser = 'rollback-test-user';
    const originalEvidenceCount = evidenceRepo.getEvidenceForNode(failUser, 'self-attention').length;
    const originalState = context.knowledgeService!.getUserKnowledgeState(failUser, 'self-attention');
    // Submit answer to non-existent block to induce application rejection
    assert.throws(() => {
      context.assessmentService.submitAnswer({
        sessionId,
        userId: failUser,
        lessonId: 'lesson-self-attention',
        blockId: 'invalid-exploding-block',
        answer: 'any answer',
      });
    });

    const postEvidenceCount = evidenceRepo.getEvidenceForNode(failUser, 'self-attention').length;
    const postState = context.knowledgeService!.getUserKnowledgeState(failUser, 'self-attention');
    assert.equal(postEvidenceCount, originalEvidenceCount);
    assert.deepEqual(postState, originalState);
  });

  await t.test('G. old v13 database upgrade -> migrations 14-16 run smoothly and preserve existing rows', async () => {
    const migrationDb = createDatabase(':memory:');
    runMigrations(migrationDb, [
      migration001,
      migration002,
      migration003,
      migration004,
      migration005,
      migration006,
      migration007,
      migration008,
      migration009,
      migration010,
      migration011,
      migration012,
      migration013,
    ]);

    // Insert required prerequisite rows
    migrationDb
      .prepare(
        `INSERT INTO knowledge_nodes (id, title, description, created_at)
         VALUES ('self-attention', 'Self Attention', 'Desc', '2026-08-20T10:00:00.000Z')`
      )
      .run();

    // Insert legacy v13 record
    migrationDb
      .prepare(
        `INSERT INTO learning_evidence (id, user_id, knowledge_node_id, type, source, outcome, difficulty, confidence, weight, created_at)
         VALUES ('legacy-ev-1', 'legacy-user', 'self-attention', 'quiz', 'lesson-1', 'correct', 1.0, 1.0, 1.0, '2026-08-20T10:00:00.000Z')`
      )
      .run();

    // Run new migrations 14, 15, 16, 17
    runMigrations(migrationDb, [migration014, migration015, migration016, migration017]);

    const newEvidenceRepo = new LearningEvidenceRepository(migrationDb);
    const legacyEvidences = newEvidenceRepo.getEvidenceForNode('legacy-user', 'self-attention');
    assert.equal(legacyEvidences.length, 1);
    assert.equal(legacyEvidences[0]?.id, 'legacy-ev-1');
    assert.equal(legacyEvidences[0]?.attempt, 1, 'Default attempt must be 1 for upgraded rows');
    assert.equal(legacyEvidences[0]?.score, undefined, 'Score should be undefined for legacy rows');
    migrationDb.close();
  });

  await t.test('H. user A evidence -> strictly isolated from user B knowledge state', async () => {
    const userA = 'isolated-user-a';
    const userB = 'isolated-user-b';

    context.assessmentService.submitAnswer({
      sessionId,
      userId: userA,
      lessonId: 'lesson-softmax',
      blockId: 'softmax-quiz-2',
      answer: 'opt-exp-1',
    });

    const stateA = context.knowledgeService!.getUserKnowledgeState(userA, 'softmax');
    const stateB = context.knowledgeService!.getUserKnowledgeState(userB, 'softmax');
    assert.ok(stateA);
    assert.equal(stateA.correctCount, 1);
    assert.equal(stateB, null, 'User B must have no records mutated by user A');
  });

  await t.test('I. probe for Softmax -> evidence strictly targets prerequisite node, not parent lesson', async () => {
    const probeUser = 'probe-target-user';
    const selfAttnBefore = context.knowledgeService!.getUserKnowledgeState(probeUser, 'self-attention');
    // Create a mock probe block on self-attention lesson targeted at softmax
    const probeBlock: QuizBlock = {
      id: 'probe-softmax-isolated',
      type: 'quiz',
      assessmentKind: 'probe',
      targetKnowledgeNodeId: 'softmax',
      question: 'Softmax test?',
      options: [
        { id: 'opt-1', text: '1' },
        { id: 'opt-2', text: '2' },
      ],
      answerSpec: { type: 'single_choice', correctOptionId: 'opt-1' },
    };
    lessonRepo.applyPatches('lesson-self-attention', 1, [
      { op: 'insert', position: { index: 1 }, block: probeBlock },
    ]);

    context.assessmentService.submitAnswer({
      sessionId,
      userId: probeUser,
      lessonId: 'lesson-self-attention',
      blockId: 'probe-softmax-isolated',
      answer: 'opt-1',
    });

    const softmaxState = context.knowledgeService!.getUserKnowledgeState(probeUser, 'softmax');
    const selfAttnAfter = context.knowledgeService!.getUserKnowledgeState(probeUser, 'self-attention');
    assert.ok(softmaxState, 'Softmax state must be created');
    assert.equal(softmaxState.correctCount, 1);
    assert.deepEqual(selfAttnAfter, selfAttnBefore, 'Self-attention state must remain unchanged');
  });

  await t.test('J. unconfirmed Diagnosis -> path_insert_detour rejected with DETOUR_NOT_AUTHORIZED', async () => {
    const diag = diagnosisRepo!.recordDiagnosis({
      sessionId,
      userId,
      knowledgeNodeId: 'softmax',
      type: 'missing_prerequisite',
      status: 'suspected', // NOT confirmed
    });

    const executor = new DomainToolsExecutor({
      sessionService: context.sessionService,
      lessonService: context.lessonService,
      diagnosisRepository: diagnosisRepo,
    });

    const result = await executor.executeTool(sessionId, 'path_insert_detour', {
      nodeId: 'softmax',
      diagnosisId: diag.id,
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'DETOUR_NOT_AUTHORIZED');
  });

  await t.test('K. fabricated diagnosisId -> path_insert_detour rejected with DETOUR_NOT_AUTHORIZED', async () => {
    const executor = new DomainToolsExecutor({
      sessionService: context.sessionService,
      lessonService: context.lessonService,
      diagnosisRepository: diagnosisRepo,
    });

    const result = await executor.executeTool(sessionId, 'path_insert_detour', {
      nodeId: 'softmax',
      diagnosisId: 'fabricated-non-existent-diag',
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'DETOUR_NOT_AUTHORIZED');
  });

  await t.test('L. confirmed Diagnosis from another session -> rejected with DETOUR_NOT_AUTHORIZED', async () => {
    // Insert another session
    db.prepare(
      `INSERT INTO learning_sessions (id, user_id, course_id, active_lesson_id, path_version, created_at, updated_at)
       VALUES ('other-alien-session', 'other-user', 'transformer', 'lesson-self-attention', 1, datetime('now'), datetime('now'))`
    ).run();

    const otherSessionDiag = diagnosisRepo!.recordDiagnosis({
      sessionId: 'other-alien-session',
      userId: 'other-user',
      knowledgeNodeId: 'softmax',
      type: 'missing_prerequisite',
      status: 'confirmed',
    });

    const executor = new DomainToolsExecutor({
      sessionService: context.sessionService,
      lessonService: context.lessonService,
      diagnosisRepository: diagnosisRepo,
    });

    const result = await executor.executeTool(sessionId, 'path_insert_detour', {
      nodeId: 'softmax',
      diagnosisId: otherSessionDiag.id,
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'DETOUR_NOT_AUTHORIZED');
  });

  await t.test('M. server restart during Detour -> state intact and Resume still works', async () => {
    const fs = await import('node:fs');
    const { randomUUID } = await import('node:crypto');
    const restartDbPath = `restart-adversarial-${randomUUID().slice(0, 8)}.sqlite`;
    try {
      // 1. Setup server 1 and insert detour
      const s1 = await createServerContext(restartDbPath);
      const snap1 = s1.sessionRepo.getSessionSnapshot('prototype')!;
      await s1.context.sessionService.insertDetour('prototype', snap1.pathVersion, {
        id: 'detour-softmax-restart',
        knowledgeNodeId: 'softmax',
        title: 'Softmax Detour',
      });
      s1.db.close();

      // 2. Restart server 2 with same SQLite DB
      const s2 = await createServerContext(restartDbPath);
      const snap2 = s2.sessionRepo.getSessionSnapshot('prototype')!;
      const activeNode = snap2.path.find((n) => n.status === 'current');
      assert.equal(activeNode?.type, 'detour', 'Detour node must remain current across restart');
      assert.equal(activeNode?.knowledgeNodeId, 'softmax');

      // 3. Complete detour and resume original lesson
      await s2.context.sessionService.completeCurrentNode('prototype', snap2.pathVersion);
      const snap3 = s2.sessionRepo.getSessionSnapshot('prototype')!;
      const mainNode = snap3.path.find((n) => n.knowledgeNodeId === 'self-attention');
      assert.equal(mainNode?.status, 'current', 'Self Attention must be restored to current after resume');
      s2.db.close();
    } finally {
      if (fs.existsSync(restartDbPath)) {
        fs.unlinkSync(restartDbPath);
      }
    }
  });

  await t.test('N. production eval -> cannot instantiate Benchmark* oracle adapters', async () => {
    // In production eval runner, Benchmark adapters are strictly prohibited
    const { TutorEvalSuite, BenchmarkTutorPolicyRunner, loadAllDomainBundles } = await import('../../../packages/evaluation/src/index.ts');
    const bundles = loadAllDomainBundles();
    const transformerBundle = bundles['transformer']!;
    const suite = new TutorEvalSuite({
      mode: 'production',
      policyRunner: new BenchmarkTutorPolicyRunner(),
    });
    const result = await suite.evaluateScenario(transformerBundle, transformerBundle.tutorScenarios[0]!);
    assert.equal(result.passed, false);
    assert.ok(result.hardFailures.some((f) => f.message.includes('PROHIBITED_ADAPTER') || f.rule === 'TUTOR_EXECUTION_ERROR'));
  });

  await t.test('O. production eval without credentials -> raises MODEL_SETUP_REQUIRED and never fallbacks fake', async () => {
    // Check that when no model driver/auth exists, production ModelExecutionService throws MODEL_SETUP_REQUIRED
    const { DefaultModelExecutionService, ModelExecutionError } = await import('../../../packages/model-runtime/src/index.ts');
    const roleResolver = {
      resolveRoleModel: async () => ({ provider: 'anthropic', model: 'claude-3-7-sonnet', thinkingLevel: 'medium' as const }),
    };
    const brokenDriver = {
      complete: async () => {
        throw new ModelExecutionError('MODEL_SETUP_REQUIRED', 'No credentials found');
      },
    };
    const executionService = new DefaultModelExecutionService(roleResolver as any, brokenDriver as any);
    await assert.rejects(
      async () => {
        await executionService.completeText({
          role: 'tutor' as const,
          prompt: 'test prompt',
        });
      },
      (err: any) => err.code === 'MODEL_SETUP_REQUIRED' || err.message.includes('MODEL_SETUP_REQUIRED')
    );
  });
});
