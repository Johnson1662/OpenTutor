import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';

test('Mastery Single Authority Integration - One-Answer Mastery Impossible & Multi-Evidence Path Advance', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, knowledgeRepo, close } = await createServerContext(':memory:');

  try {
    const sessionId = 'prototype';
    const userId = 'default-user';
    assert.ok(context.knowledgeService, 'knowledgeService must be defined on context');

    // 1. Initial State: node 'self-attention' is current, initial state is unknown
    const initialSnap = sessionRepo.getSessionSnapshot(sessionId)!;
    assert.ok(initialSnap);
    const initialPathNode = initialSnap.path.find((n) => n.status === 'current')!;
    assert.equal(initialPathNode.knowledgeNodeId, 'self-attention');

    // 2. Submit FIRST correct answer (easy/medium quiz)
    const firstResult = context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: initialSnap.lesson.id,
      blockId: 'block-quiz-1',
      answer: 'Scaled Dot-Product Attention',
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

    // 3. Submit SECOND correct answer
    const secondResult = context.assessmentService.submitAnswer({
      sessionId,
      userId,
      lessonId: initialSnap.lesson.id,
      blockId: 'block-quiz-1',
      answer: 'Scaled Dot-Product Attention',
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

    // 4. Submit subsequent correct answers until Bayesian posterior crosses p >= 0.85 threshold
    for (let i = 3; i <= 6; i++) {
      context.assessmentService.submitAnswer({
        sessionId,
        userId,
        lessonId: initialSnap.lesson.id,
        blockId: 'block-quiz-1',
        answer: 'Scaled Dot-Product Attention',
      });
    }

    const stateAfterFinal = context.knowledgeService.getUserKnowledgeState(userId, 'self-attention');
    assert.ok(stateAfterFinal);
    assert.ok((stateAfterFinal.evidenceCount ?? 0) >= 3, 'Must have at least 3 pieces of evidence');
    assert.ok((stateAfterFinal.masteryProbability ?? 0) >= 0.85, 'Must reach 0.85 probability threshold');
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
