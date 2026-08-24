import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReplanPolicy } from '../src/index.ts';
import type { LearningDiagnosis, LearningPathNode } from '@opentutor/protocol';

describe('ReplanPolicy', () => {
  const policy = new ReplanPolicy({ confidenceThreshold: 0.6 });

  function makeDiagnosis(
    status: 'suspected' | 'confirmed' | 'resolved',
    confidence = 0.85,
    knowledgeNodeId = 'node-prereq-gap'
  ): LearningDiagnosis {
    return {
      id: 'diag-1',
      sessionId: 'session-1',
      userId: 'user-1',
      knowledgeNodeId,
      type: 'missing_prerequisite',
      confidence,
      status,
      sourceEvidenceIds: ['ev-1'],
      createdAt: '2026-08-01T00:00:00.000Z',
    };
  }

  describe('evaluateReplan (Wave 2 path context)', () => {
    it('returns insert_detour when confirmed diagnosis exists and node is NOT completed', () => {
      const diagnosis = makeDiagnosis('confirmed', 0.9, 'node-calculus');
      const currentPath: LearningPathNode[] = [
        {
          id: 'path-1',
          knowledgeNodeId: 'node-intro',
          title: 'Intro',
          type: 'main',
          status: 'completed',
          position: 0,
        },
        {
          id: 'path-2',
          knowledgeNodeId: 'node-calculus',
          title: 'Calculus',
          type: 'prerequisite',
          status: 'upcoming',
          position: 1,
        },
      ];

      const decision = policy.evaluateReplan({
        sessionId: 'session-1',
        diagnoses: [diagnosis],
        currentPath,
      });

      assert.equal(decision.action, 'insert_detour');
      assert.equal(decision.targetNodeId, 'node-calculus');
      assert.equal(decision.diagnosisId, 'diag-1');
      assert.equal(decision.reason, 'Confirmed prerequisite gap');
    });

    it('returns continue when confirmed diagnosis exists but node is already completed', () => {
      const diagnosis = makeDiagnosis('confirmed', 0.9, 'node-calculus');
      const currentPath: LearningPathNode[] = [
        {
          id: 'path-1',
          knowledgeNodeId: 'node-calculus',
          title: 'Calculus',
          type: 'detour',
          status: 'completed',
          position: 0,
        },
        {
          id: 'path-2',
          knowledgeNodeId: 'node-derivatives',
          title: 'Derivatives',
          type: 'main',
          status: 'current',
          position: 1,
        },
      ];

      const decision = policy.evaluateReplan({
        sessionId: 'session-1',
        diagnoses: [diagnosis],
        currentPath,
      });

      assert.equal(decision.action, 'continue');
    });

    it('returns continue when all diagnoses are resolved or none confirmed', () => {
      const resolvedDiag = makeDiagnosis('resolved', 0.9, 'node-calculus');
      const suspectedDiag: LearningDiagnosis = {
        ...makeDiagnosis('suspected', 0.5, 'node-algebra'),
        id: 'diag-2',
      };

      const currentPath: LearningPathNode[] = [
        {
          id: 'path-1',
          knowledgeNodeId: 'node-derivatives',
          title: 'Derivatives',
          type: 'main',
          status: 'current',
          position: 0,
        },
      ];

      const decision = policy.evaluateReplan({
        sessionId: 'session-1',
        diagnoses: [resolvedDiag, suspectedDiag],
        currentPath,
      });

      assert.equal(decision.action, 'continue');
    });
  });

  describe('evaluate (legacy single diagnosis)', () => {
    it('authorizes insert_detour ONLY for confirmed diagnosis with sufficient confidence', () => {
      const confirmedDiagnosis = makeDiagnosis('confirmed', 0.9);
      const decision = policy.evaluate(confirmedDiagnosis);

      assert.equal(decision.action, 'insert_detour');
      assert.equal(decision.targetNodeId, 'node-prereq-gap');
      assert.equal(decision.diagnosisId, 'diag-1');
    });

    it('does NOT authorize insert_detour for suspected diagnosis', () => {
      const suspectedDiagnosis = makeDiagnosis('suspected', 0.9);
      const decision = policy.evaluate(suspectedDiagnosis);

      assert.equal(decision.action, 'continue');
      assert.notEqual(decision.action, 'insert_detour');
    });

    it('does NOT authorize insert_detour for resolved diagnosis', () => {
      const resolvedDiagnosis = makeDiagnosis('resolved', 0.9);
      const decision = policy.evaluate(resolvedDiagnosis);

      assert.equal(decision.action, 'continue');
      assert.notEqual(decision.action, 'insert_detour');
    });

    it('continues normally when no diagnosis is provided', () => {
      const decisionNull = policy.evaluate(null);
      assert.equal(decisionNull.action, 'continue');

      const decisionUndefined = policy.evaluate(undefined);
      assert.equal(decisionUndefined.action, 'continue');
    });

    it('recommends review if confirmed diagnosis has confidence below threshold', () => {
      const lowConfidenceDiagnosis = makeDiagnosis('confirmed', 0.4);
      const decision = policy.evaluate(lowConfidenceDiagnosis);

      assert.equal(decision.action, 'review');
      assert.notEqual(decision.action, 'insert_detour');
    });
  });
});
