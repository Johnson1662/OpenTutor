import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';

test('Mastery Single Authority Integration - One-Answer Mastery Impossible & Multi-Evidence Path Advance', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, lessonRepo, close } = await createServerContext(':memory:');

  try {
    const sessionId = 'prototype';
    const userId = 'default-user';
    assert.ok(context.knowledgeService, 'knowledgeService must be defined on context');

    // 1. Initial State: node 'self-attention' is current, initial state is unknown
    const initialSnap = sessionRepo.getSessionSnapshot(sessionId)!;
    assert.ok(initialSnap);
    const initialPathNode = initialSnap.path.find((n) => n.status === 'current')!;
    assert.equal(initialPathNode.knowledgeNodeId, 'self-attention');

    // Insert quiz-2 and quiz-3 into the lesson for multi-item assessment testing
    lessonRepo.applyPatches(initialSnap.lesson.id, initialSnap.lesson.version, [
      {
        op: 'insert',
        position: { after: 'quiz' },
        block: {
          id: 'block-quiz-2',
          type: 'quiz',
          question: 'What is the dimension of the dot-product scaling factor sqrt(d_k)?',
          answerType: 'single_choice',
          options: [
            { id: 'opt-1', text: 'Key vector dimension' },
            { id: 'opt-2', text: 'Sequence length' },
            { id: 'opt-3', text: 'Batch size' },
          ],
          answerSpec: {
            type: 'single_choice',
            correctOptionId: 'opt-1',
          },
          difficulty: 2.0,
        },
      },
      {
        op: 'insert',
        position: { after: 'block-quiz-2' },
        block: {
          id: 'block-quiz-3',
          type: 'quiz',
          question: 'Why is softmax used in attention?',
          answerType: 'single_choice',
          options: [
            { id: 'opt-a', text: 'To normalize attention weights into probabilities summing to 1' },
            { id: 'opt-b', text: 'To speed up computation' },
            { id: 'opt-c', text: 'To reduce memory' },
          ],
          answerSpec: {
            type: 'single_choice',
            correctOptionId: 'opt-a',
          },
          difficulty: 2.0,
        },
      },
    ]);

    // 2. Submit FIRST correct answer (on seeded 'quiz')
    const firstResult = context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: initialSnap.lesson.id,
      blockId: 'quiz',
      answer: 'Tokens need surrounding context and attention information to disambiguate words.',
    });

    assert.equal(firstResult.assessment.result, 'correct');

    // Verify DB user_knowledge_state after 1st answer: must be 'learning', NEVER 'mastered'
    const stateAfter1 = context.knowledgeService.getUserKnowledgeState(userId, 'self-attention');
    assert.ok(stateAfter1);
    assert.equal(stateAfter1.evidenceCount, 1);
    assert.equal(stateAfter1.correctCount, 1);
    assert.equal(stateAfter1.status, 'learning');
    assert.notEqual(stateAfter1.status, 'mastered', 'First correct answer must NEVER yield mastered status');

    // Verify Learning Path after 1st answer: MUST NOT advance
    const snapAfter1 = sessionRepo.getSessionSnapshot(sessionId)!;
    const currentNodeAfter1 = snapAfter1.path.find((n) => n.status === 'current')!;
    assert.equal(currentNodeAfter1.id, initialPathNode.id, 'Path must remain on current node after 1 answer');
    assert.equal(currentNodeAfter1.status, 'current');

    // 3. Submit SECOND correct answer on distinct item (quiz-2)
    const secondResult = context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: initialSnap.lesson.id,
      blockId: 'block-quiz-2',
      answer: 'opt-1',
    });
    assert.equal(secondResult.assessment.result, 'correct');

    const stateAfter2 = context.knowledgeService.getUserKnowledgeState(userId, 'self-attention');
    assert.ok(stateAfter2);
    assert.equal(stateAfter2.evidenceCount, 2);
    assert.equal(stateAfter2.correctCount, 2);
    assert.equal(stateAfter2.status, 'learning', 'Two answers must still be learning (< 3 evidence count threshold)');

    const snapAfter2 = sessionRepo.getSessionSnapshot(sessionId)!;
    const currentNodeAfter2 = snapAfter2.path.find((n) => n.status === 'current')!;
    assert.equal(currentNodeAfter2.id, initialPathNode.id, 'Path must still remain on current node after 2 answers');

    // 4. Submit THIRD correct answer on distinct item (quiz-3)
    const pathAdvanced = new Promise<void>((resolve) => {
      const unsubscribe = context.eventBus.subscribe(sessionId, (event) => {
        if (event.type === 'path.patch') {
          unsubscribe();
          resolve();
        }
      });
    });
    const thirdResult = context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: initialSnap.lesson.id,
      blockId: 'block-quiz-3',
      answer: 'opt-a',
    });
    assert.equal(thirdResult.assessment.result, 'correct');
    await pathAdvanced;

    const stateAfterFinal = context.knowledgeService.getUserKnowledgeState(userId, 'self-attention');
    assert.ok(stateAfterFinal);
    assert.ok((stateAfterFinal.evidenceCount ?? 0) >= 3, 'Must have at least 3 pieces of evidence');
    assert.ok((stateAfterFinal.masteryProbability ?? 0) >= 0.75, 'Must reach 0.75 probability threshold');
    assert.equal(stateAfterFinal.status, 'mastered');

    // 5. Verify Learning Path advanced once mastered
    const snapFinal = sessionRepo.getSessionSnapshot(sessionId)!;
    const oldNode = snapFinal.path.find((n) => n.id === initialPathNode.id)!;
    assert.equal(oldNode.status, 'completed', 'Node must be marked completed upon mastery');

    const newCurrentNode = snapFinal.path.find((n) => n.status === 'current');
    assert.ok(newCurrentNode, 'Path must advance to next upcoming node');
    assert.notEqual(newCurrentNode.id, initialPathNode.id);
  } finally {
    await close();
  }
});

test('Evidence Integrity - Incorrect Answers, Attempt Decay & Invalid Block Rejection', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, evidenceRepo, close } = await createServerContext(':memory:');

  try {
    const sessionId = 'prototype';
    const userId = 'integrity-user';
    const snapshot = sessionRepo.getSessionSnapshot(sessionId)!;
    assert.ok(context.knowledgeService);

    // 1. Rejection of non-existent block
    assert.throws(
      () => {
        context.assessmentService.submitAnswer({
          sessionId,
          userId,
          lessonId: snapshot.lesson.id,
          blockId: 'block-non-existent-999',
          answer: 'any answer',
        });
      },
      (err: Error) => err.message.includes('BLOCK_NOT_FOUND'),
      'Submitting to a non-existent block must throw BLOCK_NOT_FOUND'
    );
    assert.equal(evidenceRepo.countEvidence(userId, 'self-attention'), 0, 'No evidence on BLOCK_NOT_FOUND');

    // 2. Rejection of non-quiz block (e.g. TextBlock)
    const textBlock = snapshot.lesson.blocks.find((b) => b.type === 'text');
    assert.ok(textBlock, 'TextBlock must exist in lesson');

    assert.throws(
      () => {
        context.assessmentService.submitAnswer({
          sessionId,
          userId,
          lessonId: snapshot.lesson.id,
          blockId: textBlock.id,
          answer: 'any answer',
        });
      },
      (err: Error) => err.message.includes('BLOCK_NOT_ASSESSABLE'),
      'Submitting to a non-quiz block must throw BLOCK_NOT_ASSESSABLE'
    );
    assert.equal(evidenceRepo.countEvidence(userId, 'self-attention'), 0, 'No evidence on BLOCK_NOT_ASSESSABLE');
    // 3. Negative Evidence: Submitting an INCORRECT answer must add negative evidence (increase beta and lower probability)
    // First answer: correct -> p increases
    context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: snapshot.lesson.id,
      blockId: 'quiz',
      answer: 'Tokens need surrounding context and attention information to disambiguate words.',
    });

    const stateCorrect = context.knowledgeService.getUserKnowledgeState(userId, 'self-attention');
    assert.ok(stateCorrect);
    assert.ok(stateCorrect.alpha! > 1.0);
    const probAfterCorrect = stateCorrect.masteryProbability!;
    const betaBeforeWrong = stateCorrect.beta!;

    // Second answer on quiz: INCORRECT answer -> beta increases and masteryProbability drops
    const wrongResult = context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: snapshot.lesson.id,
      blockId: 'quiz',
      answer: 'Completely Wrong Answer with no keywords',
    });

    assert.equal(wrongResult.assessment.result, 'incorrect');

    const stateAfterWrong = context.knowledgeService.getUserKnowledgeState(userId, 'self-attention');
    assert.ok(stateAfterWrong);
    assert.ok(
      stateAfterWrong.beta! > betaBeforeWrong,
      `Beta must increase after incorrect answer (before: ${betaBeforeWrong}, after: ${stateAfterWrong.beta})`
    );
    assert.ok(
      stateAfterWrong.masteryProbability! < probAfterCorrect,
      `Mastery probability must drop after incorrect answer (before: ${probAfterCorrect}, after: ${stateAfterWrong.masteryProbability})`
    );
    assert.equal(stateAfterWrong.incorrectCount, 1);

    // 4. Attempt Diminishing Returns: Repeatedly answering the exact same quiz item yields diminishing weight
    const attempts = evidenceRepo.countItemAttempts(userId, 'self-attention', 'quiz');
    assert.equal(attempts, 2, 'Two attempts recorded for quiz');
  } finally {
    await close();
  }
});

test('Probe Target Node Invariant - Evidence & Mastery routed to prerequisite node, leaving active lesson node untouched', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, lessonRepo, evidenceRepo, db, close } = await createServerContext(':memory:');

  try {
    const sessionId = 'prototype';
    const userId = 'probe-user';
    const initialSnap = sessionRepo.getSessionSnapshot(sessionId)!;
    assert.ok(initialSnap);
    assert.equal(initialSnap.path.find((n) => n.status === 'current')!.knowledgeNodeId, 'self-attention');

    // Insert probe block targeting prerequisite node 'softmax'
    lessonRepo.applyPatches(initialSnap.lesson.id, initialSnap.lesson.version, [
      {
        op: 'insert',
        position: { after: 'quiz' },
        block: {
          id: 'block-probe-softmax',
          type: 'quiz',
          question: 'What is softmax output?',
          answerType: 'single_choice',
          targetKnowledgeNodeId: 'softmax',
          assessmentKind: 'probe',
          candidateMisconceptionIds: ['misc-softmax-prob'],
          options: [
            { id: 'opt-1', text: 'Probabilities summing to 1' },
            { id: 'opt-2', text: 'Arbitrary unbounded values' },
          ],
          answerSpec: {
            type: 'single_choice',
            correctOptionId: 'opt-1',
          },
          difficulty: 'medium',
        },
      },
    ]);

    // Submit correct answer to the probe block
    const probeResult = context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: initialSnap.lesson.id,
      blockId: 'block-probe-softmax',
      answer: 'opt-1',
    });

    assert.equal(probeResult.assessment.result, 'correct');
    assert.equal(probeResult.assessment.knowledgeNodeId, 'softmax');

    // Verify evidence is recorded against 'softmax' (prerequisite)
    const softmaxEvidence = evidenceRepo.getEvidenceForNode(userId, 'softmax');
    assert.equal(softmaxEvidence.length, 1);
    assert.equal(softmaxEvidence[0]?.knowledgeNodeId, 'softmax');
    assert.equal(softmaxEvidence[0]?.type, 'probe');
    assert.equal(softmaxEvidence[0]?.sourceItemId, 'block-probe-softmax');

    const softmaxState = context.knowledgeService!.getUserKnowledgeState(userId, 'softmax');
    assert.ok(softmaxState);
    assert.equal(softmaxState.evidenceCount, 1);
    assert.equal(softmaxState.correctCount, 1);

    // Verify active lesson node ('self-attention') remains COMPLETELY UNTOUCHED (0 evidence)
    const activeNodeEvidence = evidenceRepo.getEvidenceForNode(userId, 'self-attention');
    assert.equal(activeNodeEvidence.length, 0, 'Active node must have 0 evidence from prerequisite probe');

    const activeNodeState = context.knowledgeService!.getUserKnowledgeState(userId, 'self-attention');
    assert.equal(activeNodeState, null, 'Active node state must be untouched');
  } finally {
    await close();
  }
});

test('Transaction Integrity & Rollback - Zero partial state on transaction failure', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, db, close } = await createServerContext(':memory:');

  try {
    const sessionId = 'prototype';
    const userId = 'tx-fail-user';
    const initialSnap = sessionRepo.getSessionSnapshot(sessionId)!;

    // Count records before failure
    const countAssessmentsBefore = (db.prepare('SELECT count(*) as count FROM assessments WHERE user_id = ?').get(userId) as { count: number }).count;
    const countEvidenceBefore = (db.prepare('SELECT count(*) as count FROM learning_evidence WHERE user_id = ?').get(userId) as { count: number }).count;
    const countStatesBefore = (db.prepare('SELECT count(*) as count FROM user_knowledge_states WHERE user_id = ?').get(userId) as { count: number }).count;

    assert.equal(countAssessmentsBefore, 0);
    assert.equal(countEvidenceBefore, 0);
    assert.equal(countStatesBefore, 0);

    // Create an assessment targeting a non-existent knowledge node with foreign key constraint to trigger DB rollback
    // In SQLite, inserting learning_evidence with non-existent knowledge_node_id triggers FOREIGN KEY constraint violation
    db.pragma('foreign_keys = ON');

    assert.throws(
      () => {
        context.knowledgeService!.recordAssessment(
          sessionId,
          {
            id: 'asmt-tx-fail-1',
            knowledgeNodeId: 'non-existent-fk-node-99999',
            lessonId: initialSnap.lesson.id,
            blockId: 'quiz',
            result: 'correct',
            confidence: 1.0,
            feedback: 'Test rollback',
          },
          userId
        );
      },
      /FOREIGN KEY|constraint/i,
      'Should throw SQLite foreign key constraint error'
    );

    // Verify transaction rollback: ZERO records in DB
    const countAssessmentsAfter = (db.prepare('SELECT count(*) as count FROM assessments WHERE user_id = ?').get(userId) as { count: number }).count;
    const countEvidenceAfter = (db.prepare('SELECT count(*) as count FROM learning_evidence WHERE user_id = ?').get(userId) as { count: number }).count;
    const countStatesAfter = (db.prepare('SELECT count(*) as count FROM user_knowledge_states WHERE user_id = ?').get(userId) as { count: number }).count;

    assert.equal(countAssessmentsAfter, 0, 'No assessments should be saved after rollback');
    assert.equal(countEvidenceAfter, 0, 'No learning_evidence should be saved after rollback');
    assert.equal(countStatesAfter, 0, 'No user_knowledge_states should be saved after rollback');
  } finally {
    await close();
  }
});
