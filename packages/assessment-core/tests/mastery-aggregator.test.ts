import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BetaMasteryAggregator, type UserKnowledgeStateV2 } from '../src/index.ts';
import type { LearningEvidence } from '@opentutor/protocol';

function makeEvidence(
  nodeId: string,
  outcome: 'correct' | 'partial' | 'incorrect',
  difficulty: number | 'easy' | 'medium' | 'hard' = 'medium',
  confidence = 1.0,
  createdAt = '2026-08-01T12:00:00.000Z',
  attempt = 1,
  sourceItemId?: string
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
    sourceItemId,
    attempt,
    outcome,
    difficulty: diffNumber,
    confidence,
    weight: diffNumber * confidence,
    createdAt,
  };
}

describe('BetaMasteryAggregator', () => {
  const aggregator = new BetaMasteryAggregator();

  it('Test 1: One-answer mastery is impossible even with high difficulty/weight', () => {
    const evidenceHard = makeEvidence('node-1', 'correct', 'hard', 1.0, undefined, 1, 'item-1');
    const state1 = aggregator.updateMastery(null, evidenceHard);

    assert.equal(state1.evidenceCount, 1);
    assert.equal(state1.effectiveEvidenceCount, 1.0);
    assert.equal(state1.distinctSourceItemCount, 1);
    assert.equal(state1.status, 'learning');
    assert.notEqual(state1.status, 'mastered');

    const evidenceExtreme = makeEvidence('node-2', 'correct', 10.0, 1.0, undefined, 1, 'item-2');
    const state2 = aggregator.updateMastery(null, evidenceExtreme);
    assert.ok(state2.masteryProbability >= 0.85);
    assert.equal(state2.distinctSourceItemCount, 1);
    assert.equal(state2.effectiveEvidenceCount, 1.0);
    assert.equal(state2.status, 'learning');
    assert.notEqual(state2.status, 'mastered');
  });

  it('Test 2: Repeated same item decay cannot reach mastered by repeating 1 item 50 times', () => {
    let state: UserKnowledgeStateV2 | null = null;

    for (let attempt = 1; attempt <= 50; attempt++) {
      state = aggregator.updateMastery(
        state,
        makeEvidence('node-repeat', 'correct', 'hard', 1.0, '2026-08-01T12:00:00.000Z', attempt, 'item-single')
      );
    }

    assert.ok(state !== null);
    assert.equal(state.distinctSourceItemCount, 1);
    // Effective evidence count: attempt 1 (1.0) + attempt 2 (0.4) + attempt 3 (0.15) + attempts 4..50 (0.0) = 1.55
    assert.equal(Math.round(state.effectiveEvidenceCount * 100) / 100, 1.55);
    assert.equal(state.evidenceCount, 50);
    assert.equal(state.status, 'learning');
    assert.notEqual(state.status, 'mastered');
  });

  it('Test 3: Distinct items requirement (must have at least 3 distinct items + 3 effective evidence)', () => {
    let state: UserKnowledgeStateV2 | null = null;

    // Item 1, attempt 1 (hard: weight=1.4, attempt=1 -> mult=1.0) -> effectiveEvidence=1.0, distinct=1
    state = aggregator.updateMastery(state, makeEvidence('node-mastery', 'correct', 'hard', 1.0, undefined, 1, 'item-1'));
    assert.equal(state.distinctSourceItemCount, 1);
    assert.equal(state.effectiveEvidenceCount, 1.0);
    assert.equal(state.status, 'learning');

    // Item 2, attempt 1 (hard: weight=1.4, attempt=1 -> mult=1.0) -> effectiveEvidence=2.0, distinct=2
    state = aggregator.updateMastery(state, makeEvidence('node-mastery', 'correct', 'hard', 1.0, undefined, 1, 'item-2'));
    assert.equal(state.distinctSourceItemCount, 2);
    assert.equal(state.effectiveEvidenceCount, 2.0);
    assert.equal(state.status, 'learning'); // effective evidence 2.0 < 3.0

    // Item 3, attempt 1 (hard: weight=1.4, attempt=1 -> mult=1.0) -> effectiveEvidence=3.0, distinct=3
    // alpha = 1.0 + 1.4*3 = 5.2, beta = 1.0, p = 5.2/6.2 = 0.8387 >= 0.75
    state = aggregator.updateMastery(state, makeEvidence('node-mastery', 'correct', 'hard', 1.0, undefined, 1, 'item-3'));
    assert.equal(state.distinctSourceItemCount, 3);
    assert.equal(state.effectiveEvidenceCount, 3.0);
    assert.equal(state.status, 'mastered'); // p >= 0.75, 3 distinct items

    // Item 4, attempt 1 (hard: weight=1.4) -> alpha = 6.6, beta = 1.0, p = 6.6/7.6 = 0.8684
    state = aggregator.updateMastery(state, makeEvidence('node-mastery', 'correct', 'hard', 1.0, undefined, 1, 'item-4'));
    assert.equal(state.distinctSourceItemCount, 4);
    assert.equal(state.effectiveEvidenceCount, 4.0);
    assert.ok(state.masteryProbability >= 0.75);
    assert.equal(state.status, 'mastered');
  });

  it('Test 3b: Exactly 2 distinct items with 3 effective evidence cannot reach mastered', () => {
    let state: UserKnowledgeStateV2 | null = null;

    // Item 1, attempt 1 (diff=2.0) -> eff=1.0, distinct=1
    state = aggregator.updateMastery(state, makeEvidence('node-2items', 'correct', 2.0, 1.0, undefined, 1, 'item-A'));
    // Item 1, attempt 2 (diff=2.0) -> eff=1.0+0.4=1.4, distinct=1
    state = aggregator.updateMastery(state, makeEvidence('node-2items', 'correct', 2.0, 1.0, undefined, 2, 'item-A'));
    // Item 2, attempt 1 (diff=2.0) -> eff=1.4+1.0=2.4, distinct=2
    state = aggregator.updateMastery(state, makeEvidence('node-2items', 'correct', 2.0, 1.0, undefined, 1, 'item-B'));
    // Item 2, attempt 2 (diff=2.0) -> eff=2.4+0.4=2.8, distinct=2
    state = aggregator.updateMastery(state, makeEvidence('node-2items', 'correct', 2.0, 1.0, undefined, 2, 'item-B'));
    // Item 2, attempt 3 (diff=2.0) -> eff=2.8+0.15=2.95, distinct=2
    state = aggregator.updateMastery(state, makeEvidence('node-2items', 'correct', 2.0, 1.0, undefined, 3, 'item-B'));
    assert.equal(state.distinctSourceItemCount, 2);
    assert.ok(state.effectiveEvidenceCount < 3.0);
    assert.equal(state.status, 'learning');

    // Item 1, attempt 3 (diff=2.0) -> eff=2.95+0.15=3.10 >= 3.0, distinct=2
    state = aggregator.updateMastery(state, makeEvidence('node-2items', 'correct', 2.0, 1.0, undefined, 3, 'item-A'));
    assert.equal(state.distinctSourceItemCount, 2);
    assert.ok(state.effectiveEvidenceCount >= 3.0);
    assert.ok(state.masteryProbability >= 0.75);
    assert.equal(state.status, 'learning'); // 2 distinct < 3 required

    // Item 3, attempt 1 (diff=2.0) -> distinct=3
    state = aggregator.updateMastery(state, makeEvidence('node-2items', 'correct', 2.0, 1.0, undefined, 1, 'item-C'));
    assert.equal(state.distinctSourceItemCount, 3);
    assert.equal(state.status, 'mastered');
  });

  it('Test 4: Incorrect evidence strictly lowers mastery probability and increases beta', () => {
    let state: UserKnowledgeStateV2 | null = null;
    state = aggregator.updateMastery(state, makeEvidence('node-inc', 'correct', 2.0, 1.0, undefined, 1, 'item-1'));
    state = aggregator.updateMastery(state, makeEvidence('node-inc', 'correct', 2.0, 1.0, undefined, 1, 'item-2'));

    assert.equal(state.status, 'learning'); // 2 distinct, effective 2.0 < 3.0
    const prevProb = state.masteryProbability;
    const prevBeta = state.beta;

    state = aggregator.updateMastery(state, makeEvidence('node-inc', 'incorrect', 'medium', 1.0, undefined, 1, 'item-3'));

    assert.ok(state.masteryProbability < prevProb);
    assert.ok(state.beta > prevBeta);
    assert.equal(state.incorrectCount, 1);
    assert.equal(state.status, 'learning'); // 2 correct + 1 incorrect cannot master (p < 0.75)
    assert.notEqual(state.status, 'mastered');
  });

  it('Test 5: Consecutive incorrect answers drive p < 0.40 and status -> weak', () => {
    let state: UserKnowledgeStateV2 | null = null;

    state = aggregator.updateMastery(state, makeEvidence('node-weak', 'incorrect', 'medium', 1.0, undefined, 1, 'item-1'));
    assert.equal(state.status, 'weak'); // alpha=1.0, beta=2.0, p=0.333 < 0.40

    state = aggregator.updateMastery(state, makeEvidence('node-weak', 'incorrect', 'hard', 1.0, undefined, 1, 'item-2'));
    assert.ok(state.masteryProbability < 0.30);
    assert.equal(state.status, 'weak');
    assert.equal(state.incorrectCount, 2);
  });

  it('Test 6: Attempt decay multiplier values (1.0, 0.4, 0.15, 0.0)', () => {
    assert.equal(aggregator.computeAttemptMultiplier(1), 1.0);
    assert.equal(aggregator.computeAttemptMultiplier(2), 0.4);
    assert.equal(aggregator.computeAttemptMultiplier(3), 0.15);
    assert.equal(aggregator.computeAttemptMultiplier(4), 0.0);
    assert.equal(aggregator.computeAttemptMultiplier(5), 0.0);
    assert.equal(aggregator.computeAttemptMultiplier(undefined), 1.0);

    assert.equal(aggregator.attemptMultiplier(1), 1.0);
    assert.equal(aggregator.attemptMultiplier(2), 0.4);
    assert.equal(aggregator.attemptMultiplier(3), 0.15);
    assert.equal(aggregator.attemptMultiplier(4), 0.0);
  });

  it('Test 7: Replay from evidence history matches sequential state exactly', () => {
    const evidences: LearningEvidence[] = [
      makeEvidence('node-replay', 'correct', 'hard', 1.0, '2026-08-01T10:00:00.000Z', 1, 'item-1'),
      makeEvidence('node-replay', 'correct', 'medium', 1.0, '2026-08-01T10:05:00.000Z', 1, 'item-2'),
      makeEvidence('node-replay', 'incorrect', 'easy', 0.9, '2026-08-01T10:10:00.000Z', 1, 'item-3'),
      makeEvidence('node-replay', 'correct', 'hard', 1.0, '2026-08-01T10:15:00.000Z', 2, 'item-3'),
      makeEvidence('node-replay', 'partial', 'hard', 0.8, '2026-08-01T10:20:00.000Z', 1, 'item-4'),
    ];

    let sequentialState: UserKnowledgeStateV2 | null = null;
    for (const ev of evidences) {
      sequentialState = aggregator.updateMastery(sequentialState, ev, ev.createdAt);
    }

    const replayedState = aggregator.recomputeFromEvidenceHistory(evidences);
    const staticReplayedState = BetaMasteryAggregator.recomputeFromEvidenceHistory(evidences);

    assert.ok(sequentialState !== null);
    assert.equal(replayedState.alpha, sequentialState.alpha);
    assert.equal(replayedState.beta, sequentialState.beta);
    assert.equal(replayedState.masteryProbability, sequentialState.masteryProbability);
    assert.equal(replayedState.confidence, sequentialState.confidence);
    assert.equal(replayedState.status, sequentialState.status);
    assert.equal(replayedState.evidenceCount, sequentialState.evidenceCount);
    assert.equal(replayedState.effectiveEvidenceCount, sequentialState.effectiveEvidenceCount);
    assert.equal(replayedState.distinctSourceItemCount, sequentialState.distinctSourceItemCount);
    assert.equal(replayedState.correctCount, sequentialState.correctCount);
    assert.equal(replayedState.incorrectCount, sequentialState.incorrectCount);

    assert.equal(staticReplayedState.alpha, sequentialState.alpha);
    assert.equal(staticReplayedState.beta, sequentialState.beta);
    assert.equal(staticReplayedState.masteryProbability, sequentialState.masteryProbability);
  });

  it('Test 8: Forgetting decay over 30 days shrinks alpha/beta towards prior and reduces mastery probability', () => {
    let state: UserKnowledgeStateV2 | null = null;
    const t0 = '2026-08-01T00:00:00.000Z';
    state = aggregator.updateMastery(state, makeEvidence('node-forget', 'correct', 2.0, 1.0, t0, 1, 'item-1'), t0);
    state = aggregator.updateMastery(state, makeEvidence('node-forget', 'correct', 2.0, 1.0, t0, 1, 'item-2'), t0);
    state = aggregator.updateMastery(state, makeEvidence('node-forget', 'correct', 2.0, 1.0, t0, 1, 'item-3'), t0);

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
