import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MisconceptionUpdater } from '../src/index.ts';
import type { LearningEvidence } from '@opentutor/protocol';

describe('MisconceptionUpdater', () => {
  const updater = new MisconceptionUpdater();

  function makeEvidence(
    outcome: 'correct' | 'partial' | 'incorrect',
    type: 'quiz' | 'probe' = 'quiz'
  ): LearningEvidence {
    return {
      id: 'ev-misc-1',
      userId: 'user-1',
      knowledgeNodeId: 'node-1',
      type,
      source: 'quiz-1',
      attempt: 1,
      outcome,
      difficulty: 1.0,
      confidence: 1.0,
      weight: 1.0,
      createdAt: '2026-08-01T12:00:00.000Z',
    };
  }

  it('records a new suspected misconception', () => {
    const recorded = updater.recordSuspected('user-1', 'misc-scope', 0.6);
    assert.equal(recorded.userId, 'user-1');
    assert.equal(recorded.misconceptionId, 'misc-scope');
    assert.equal(recorded.status, 'suspected');
    assert.equal(recorded.confidence, 0.6);
    assert.equal(recorded.evidenceCount, 1);
  });

  it('confirms a suspected misconception', () => {
    const initial = updater.recordSuspected('user-1', 'misc-scope', 0.6);
    const confirmed = updater.confirmMisconception(initial, 0.95);

    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.confidence, 0.95);
    assert.equal(confirmed.evidenceCount, 2);
  });

  it('resolves a confirmed misconception', () => {
    const initial = updater.recordSuspected('user-1', 'misc-scope', 0.6);
    const confirmed = updater.confirmMisconception(initial, 0.95);
    const resolved = updater.resolveMisconception(confirmed);

    assert.equal(resolved.status, 'resolved');
    assert.ok(resolved.resolvedAt !== undefined);
  });

  it('updates misconception status through evidence flow (suspected -> confirmed -> resolved -> relapse)', () => {
    // 1. Initial error on quiz -> suspected
    const ev1 = makeEvidence('incorrect', 'quiz');
    const state1 = updater.updateFromEvidence(null, ev1, 'misc-reference');
    assert.ok(state1 !== null);
    assert.equal(state1.status, 'suspected');

    // 2. Second error on quiz -> confirmed
    const ev2 = makeEvidence('incorrect', 'quiz');
    const state2 = updater.updateFromEvidence(state1, ev2, 'misc-reference');
    assert.ok(state2 !== null);
    assert.equal(state2.status, 'confirmed');

    // 3. Correct answer -> resolved
    const ev3 = makeEvidence('correct', 'quiz');
    const state3 = updater.updateFromEvidence(state2, ev3, 'misc-reference');
    assert.ok(state3 !== null);
    assert.equal(state3.status, 'resolved');

    // 4. Relapse (new error) -> suspected
    const ev4 = makeEvidence('incorrect', 'quiz');
    const state4 = updater.updateFromEvidence(state3, ev4, 'misc-reference');
    assert.ok(state4 !== null);
    assert.equal(state4.status, 'suspected');
  });

  it('directly confirms misconception when targeted probe fails', () => {
    const probeEvidence = makeEvidence('incorrect', 'probe');
    const state = updater.updateFromEvidence(null, probeEvidence, 'misc-probe', { isMisconceptionProbe: true });

    assert.ok(state !== null);
    assert.equal(state.status, 'confirmed');
    assert.ok(state.confidence >= 0.8);
  });
});
