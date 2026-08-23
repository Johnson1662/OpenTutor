import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BetaMasteryAggregator, type UserKnowledgeStateV2 } from '../src/index.ts';
import type { LearningEvidence } from '@opentutor/protocol';

function makeEvidence(
  nodeId: string,
  outcome: 'correct' | 'partial' | 'incorrect',
  difficulty: number | 'easy' | 'medium' | 'hard' = 'medium',
  confidence = 1.0,
  createdAt = '2026-08-01T12:00:00.000Z'
): LearningEvidence {
  const diffNumber =
    typeof difficulty === 'number'
      ? difficulty
      : difficulty === 'easy'
        ? 0.6
        : difficulty === 'hard'
          ? 1.4
          : 1.0;
  return {
    id: `ev-${Math.random().toString(36).slice(2)}`,
    userId: 'user-1',
    knowledgeNodeId: nodeId,
    type: 'quiz',
    source: 'quiz-1',
    outcome,
    difficulty: diffNumber,
    confidence,
    weight: diffNumber * confidence,
    createdAt,
  };
}

describe('BetaMasteryAggregator', () => {
  const aggregator = new BetaMasteryAggregator();

  it('Test 1: Single correct answer on easy/medium moves unknown -> learning, NOT mastered', () => {
    const evidenceEasy = makeEvidence('node-1', 'correct', 'easy');
    const state1 = aggregator.updateMastery(null, evidenceEasy);

    assert.equal(state1.evidenceCount, 1);
    assert.equal(state1.correctCount, 1);
    assert.equal(state1.incorrectCount, 0);
    assert.equal(state1.status, 'learning');
    assert.notEqual(state1.status, 'mastered');

    const evidenceMedium = makeEvidence('node-2', 'correct', 'medium');
    const state2 = aggregator.updateMastery(null, evidenceMedium);

    assert.equal(state2.evidenceCount, 1);
    assert.equal(state2.status, 'learning');
    assert.notEqual(state2.status, 'mastered');
  });

  it('Test 2: Accumulating correct answers (easy, medium, hard) elevates p >= 0.85 and status -> mastered', () => {
    let state: UserKnowledgeStateV2 | null = null;

    // Answer 1 (easy)
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 'easy'));
    assert.equal(state.evidenceCount, 1);
    assert.equal(state.status, 'learning');

    // Answer 2 (medium)
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 'medium'));
    assert.equal(state.evidenceCount, 2);
    assert.equal(state.status, 'learning');

    // Answer 3 (hard)
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 'hard'));
    assert.equal(state.evidenceCount, 3);
    assert.equal(state.status, 'learning'); // alpha=4.0, beta=1.0, p=0.80

    // Answer 4 (hard) -> alpha=5.4, beta=1.0, p=0.84375
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 'hard'));
    assert.equal(state.evidenceCount, 4);

    // Answer 5 (hard) -> alpha=6.8, beta=1.0, p=0.8718 >= 0.85
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 'hard'));
    assert.equal(state.evidenceCount, 5);
    assert.ok(state.masteryProbability >= 0.85);
    assert.equal(state.status, 'mastered');
  });

  it('Test 2b: 3 high-weight / hard correct answers elevate p >= 0.85 and status -> mastered', () => {
    let state: UserKnowledgeStateV2 | null = null;

    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0));
    assert.equal(state.status, 'learning'); // count 1 < 3

    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0));
    assert.equal(state.status, 'learning'); // count 2 < 3

    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0));
    assert.equal(state.evidenceCount, 3);
    assert.ok(state.masteryProbability >= 0.85);
    assert.equal(state.status, 'mastered');
  });

  it('Test 3: Incorrect answer after mastery immediately reduces p and demotes status back to learning', () => {
    let state: UserKnowledgeStateV2 | null = null;
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0));
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0));
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0));
    assert.equal(state.status, 'mastered');

    const prevProb = state.masteryProbability;
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'incorrect', 'medium'));

    assert.ok(state.masteryProbability < prevProb);
    assert.equal(state.status, 'learning');
    assert.notEqual(state.status, 'mastered');
  });

  it('Test 4: Consecutive incorrect answers drive p < 0.40 and status -> weak', () => {
    let state: UserKnowledgeStateV2 | null = null;

    state = aggregator.updateMastery(state, makeEvidence('node-1', 'incorrect', 'medium'));
    assert.equal(state.status, 'weak'); // alpha=1.0, beta=2.0, p=0.333 < 0.40

    state = aggregator.updateMastery(state, makeEvidence('node-1', 'incorrect', 'hard'));
    assert.ok(state.masteryProbability < 0.30);
    assert.equal(state.status, 'weak');
    assert.equal(state.incorrectCount, 2);
  });

  it('Test 5: Forgetting decay over 30 days shrinks alpha/beta towards prior and reduces mastery probability', () => {
    let state: UserKnowledgeStateV2 | null = null;
    const t0 = '2026-08-01T00:00:00.000Z';
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0, 1.0, t0), t0);
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0, 1.0, t0), t0);
    state = aggregator.updateMastery(state, makeEvidence('node-1', 'correct', 2.0, 1.0, t0), t0);

    assert.equal(state.status, 'mastered');
    assert.ok(state.masteryProbability >= 0.85);

    const t30 = '2026-08-31T00:00:00.000Z';
    const decayed = aggregator.projectMasteryAt(state, t30);

    assert.ok(decayed.alpha < state.alpha);
    assert.ok(decayed.alpha > 1.0);
    assert.ok(decayed.masteryProbability < state.masteryProbability);
    assert.equal(decayed.status, 'learning');
  });
});
