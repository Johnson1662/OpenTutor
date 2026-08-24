import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProbeService } from '../src/index.ts';
import type { UserKnowledgeState, UserMisconception } from '@opentutor/protocol';

describe('ProbeService', () => {
  const service = new ProbeService();

  describe('decideProbe with prerequisite context', () => {
    it('evaluates prerequisites in dependency order and probes first weak/uncertain prerequisite', () => {
      const states: Record<string, UserKnowledgeState> = {
        'prereq-mastered': {
          knowledgeNodeId: 'prereq-mastered',
          status: 'mastered',
          confidence: 0.95,
          masteryProbability: 0.95,
          effectiveEvidenceCount: 5,
          distinctSourceItemCount: 3,
          evidenceCount: 5,
        },
        'prereq-weak': {
          knowledgeNodeId: 'prereq-weak',
          status: 'weak',
          confidence: 0.2,
          masteryProbability: 0.2,
          evidenceCount: 2,
        },
        'prereq-unknown': {
          knowledgeNodeId: 'prereq-unknown',
          status: 'unknown',
          confidence: 0.5,
          evidenceCount: 0,
        },
      };

      const decision = service.decideProbe({
        activeNodeId: 'target-node',
        prerequisiteNodeIds: ['prereq-mastered', 'prereq-weak', 'prereq-unknown'],
        getKnowledgeState: (id) => states[id] ?? null,
      });

      assert.equal(decision.shouldProbe, true);
      assert.equal(decision.targetKnowledgeNodeId, 'prereq-weak');
      assert.equal(decision.probeType, 'concept');
    });

    it('returns shouldProbe: false when all prerequisites in context are mastered', () => {
      const masteredState: UserKnowledgeState = {
        knowledgeNodeId: 'prereq-p1',
        status: 'mastered',
        confidence: 0.9,
        masteryProbability: 0.9,
        effectiveEvidenceCount: 4,
        distinctSourceItemCount: 2,
        evidenceCount: 4,
      };

      const decision = service.decideProbe({
        activeNodeId: 'target-node',
        prerequisiteNodeIds: ['prereq-p1'],
        getKnowledgeState: () => masteredState,
      });

      assert.equal(decision.shouldProbe, false);
      assert.equal(decision.targetKnowledgeNodeId, 'target-node');
    });

    it('prioritizes suspected misconceptions from getMisconceptions', () => {
      const masteredState: UserKnowledgeState = {
        knowledgeNodeId: 'prereq-p1',
        status: 'mastered',
        confidence: 0.95,
        masteryProbability: 0.95,
        effectiveEvidenceCount: 5,
        distinctSourceItemCount: 3,
        evidenceCount: 5,
      };
      const misconception: UserMisconception = {
        userId: 'user-1',
        misconceptionId: 'misc-trap',
        confidence: 0.8,
        evidenceCount: 1,
        status: 'suspected',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      };

      const decision = service.decideProbe({
        activeNodeId: 'target-node',
        prerequisiteNodeIds: ['prereq-p1'],
        getKnowledgeState: () => masteredState,
        getMisconceptions: (id) => (id === 'prereq-p1' ? [misconception] : []),
      });

      assert.equal(decision.shouldProbe, true);
      assert.equal(decision.targetKnowledgeNodeId, 'prereq-p1');
      assert.equal(decision.probeType, 'misconception');
      assert.deepEqual(decision.candidateMisconceptionIds, ['misc-trap']);
    });
  });

  describe('decideProbe with single prerequisite params (legacy)', () => {
    it('probes recall when prerequisite knowledge state is unknown or missing', () => {
      const decisionNull = service.decideProbe({
        targetKnowledgeNodeId: 'prereq-1',
        prerequisiteState: null,
      });
      assert.equal(decisionNull.shouldProbe, true);
      assert.equal(decisionNull.probeType, 'recall');
      assert.equal(decisionNull.targetKnowledgeNodeId, 'prereq-1');

      const unknownState: UserKnowledgeState = {
        knowledgeNodeId: 'prereq-1',
        status: 'unknown',
        confidence: 0.5,
        evidenceCount: 0,
      };
      const decisionUnknown = service.decideProbe({
        targetKnowledgeNodeId: 'prereq-1',
        prerequisiteState: unknownState,
      });
      assert.equal(decisionUnknown.shouldProbe, true);
      assert.equal(decisionUnknown.probeType, 'recall');
    });

    it('prioritizes probing for suspected misconceptions on prerequisite', () => {
      const masteredState: UserKnowledgeState = {
        knowledgeNodeId: 'prereq-1',
        status: 'mastered',
        confidence: 0.9,
        masteryProbability: 0.9,
        effectiveEvidenceCount: 5,
        distinctSourceItemCount: 3,
        evidenceCount: 5,
      };
      const suspectedMisconception: UserMisconception = {
        userId: 'user-1',
        misconceptionId: 'misc-off-by-one',
        confidence: 0.7,
        evidenceCount: 1,
        status: 'suspected',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      };

      const decision = service.decideProbe({
        targetKnowledgeNodeId: 'prereq-1',
        prerequisiteState: masteredState,
        userMisconceptions: [suspectedMisconception],
      });

      assert.equal(decision.shouldProbe, true);
      assert.equal(decision.probeType, 'misconception');
      assert.deepEqual(decision.candidateMisconceptionIds, ['misc-off-by-one']);
    });

    it('probes concept when prerequisite mastery is uncertain (0.3 <= p <= 0.7)', () => {
      const uncertainState: UserKnowledgeState = {
        knowledgeNodeId: 'prereq-1',
        status: 'learning',
        confidence: 0.55,
        masteryProbability: 0.55,
        effectiveEvidenceCount: 2,
        distinctSourceItemCount: 2,
        evidenceCount: 2,
      };

      const decision = service.decideProbe({
        targetKnowledgeNodeId: 'prereq-1',
        prerequisiteState: uncertainState,
      });

      assert.equal(decision.shouldProbe, true);
      assert.equal(decision.probeType, 'concept');
    });

    it('probes concept when prerequisite mastery is weak (p < 0.40)', () => {
      const weakState: UserKnowledgeState = {
        knowledgeNodeId: 'prereq-1',
        status: 'weak',
        confidence: 0.25,
        masteryProbability: 0.25,
        effectiveEvidenceCount: 2,
        distinctSourceItemCount: 2,
        evidenceCount: 2,
      };

      const decision = service.decideProbe({
        targetKnowledgeNodeId: 'prereq-1',
        prerequisiteState: weakState,
      });

      assert.equal(decision.shouldProbe, true);
      assert.equal(decision.probeType, 'concept');
    });

    it('does NOT probe when prerequisite is mastered', () => {
      const masteredState: UserKnowledgeState = {
        knowledgeNodeId: 'prereq-1',
        status: 'mastered',
        confidence: 0.92,
        masteryProbability: 0.92,
        effectiveEvidenceCount: 4.0,
        distinctSourceItemCount: 3,
        evidenceCount: 4,
      };

      const decision = service.decideProbe({
        targetKnowledgeNodeId: 'prereq-1',
        prerequisiteState: masteredState,
      });

      assert.equal(decision.shouldProbe, false);
      assert.equal(decision.targetKnowledgeNodeId, 'prereq-1');
    });

    it('evaluates multiple prerequisites and identifies first unmastered prerequisite', () => {
      const userStates: Record<string, UserKnowledgeState> = {
        'prereq-1': {
          knowledgeNodeId: 'prereq-1',
          status: 'mastered',
          confidence: 0.9,
          masteryProbability: 0.9,
          effectiveEvidenceCount: 4,
          distinctSourceItemCount: 2,
          evidenceCount: 4,
        },
        'prereq-2': {
          knowledgeNodeId: 'prereq-2',
          status: 'learning',
          confidence: 0.5,
          masteryProbability: 0.5,
          effectiveEvidenceCount: 1,
          distinctSourceItemCount: 1,
          evidenceCount: 1,
        },
      };

      const decision = service.evaluatePrerequisites({
        targetNodeId: 'target-node',
        prerequisiteNodeIds: ['prereq-1', 'prereq-2'],
        userStates,
      });

      assert.equal(decision.shouldProbe, true);
      assert.equal(decision.targetKnowledgeNodeId, 'prereq-2');
    });
  });
});
