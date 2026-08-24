import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosisService } from '../src/index.ts';
import type {
  AssessmentResult,
  LearningDiagnosis,
  LearningEvidence,
  Misconception,
  QuizBlock,
} from '@opentutor/protocol';

describe('DiagnosisService', () => {
  const service = new DiagnosisService();

  function makeEvidence(
    outcome: 'correct' | 'partial' | 'incorrect',
    type: 'quiz' | 'probe' = 'probe',
    score?: number
  ): LearningEvidence {
    return {
      id: 'ev-test-1',
      userId: 'user-1',
      knowledgeNodeId: 'node-prereq',
      type,
      source: 'probe-1',
      attempt: 1,
      outcome,
      score,
      difficulty: 1.0,
      confidence: 0.95,
      weight: 1.0,
      createdAt: '2026-08-01T12:00:00.000Z',
    };
  }

  function makeProbeBlock(options: {
    targetKnowledgeNodeId: string;
    candidateMisconceptionIds?: string[];
  }): QuizBlock {
    return {
      id: `probe-${options.targetKnowledgeNodeId}-123`,
      type: 'quiz',
      assessmentKind: 'probe',
      targetKnowledgeNodeId: options.targetKnowledgeNodeId,
      candidateMisconceptionIds: options.candidateMisconceptionIds,
      question: `Diagnostic question for ${options.targetKnowledgeNodeId}`,
      answerType: 'single_choice',
      options: [
        { id: 'opt-1', text: 'Option 1' },
        { id: 'opt-2', text: 'Option 2' },
      ],
      answerSpec: {
        type: 'single_choice',
        correctOptionId: 'opt-1',
      },
    };
  }

  function makeAssessmentResult(options: {
    result: 'correct' | 'partial' | 'incorrect';
    knowledgeNodeId?: string;
  }): AssessmentResult {
    return {
      id: 'asmt-result-1',
      knowledgeNodeId: options.knowledgeNodeId ?? 'node-prereq',
      lessonId: 'lesson-1',
      result: options.result,
      confidence: options.result === 'correct' ? 1.0 : 0.0,
      feedback: 'Feedback message',
    };
  }

  describe('evaluateProbeResult', () => {
    it('creates a confirmed missing_prerequisite diagnosis when probe without misconceptions fails', () => {
      const probeBlock = makeProbeBlock({ targetKnowledgeNodeId: 'prereq-calculus' });
      const assessmentResult = makeAssessmentResult({
        result: 'incorrect',
        knowledgeNodeId: 'main-derivatives',
      });

      const diagnosis = service.evaluateProbeResult({
        sessionId: 'sess-101',
        userId: 'user-42',
        probeBlock,
        assessmentResult,
      });

      assert.ok(diagnosis !== null);
      assert.equal(diagnosis.sessionId, 'sess-101');
      assert.equal(diagnosis.userId, 'user-42');
      assert.equal(diagnosis.knowledgeNodeId, 'prereq-calculus');
      assert.equal(diagnosis.type, 'missing_prerequisite');
      assert.equal(diagnosis.status, 'confirmed');
      assert.equal(diagnosis.confidence, 0.9);
      assert.deepEqual(diagnosis.sourceEvidenceIds, ['asmt-result-1']);
    });

    it('creates a confirmed misconception diagnosis when probe with candidate misconceptions fails', () => {
      const probeBlock = makeProbeBlock({
        targetKnowledgeNodeId: 'prereq-pointers',
        candidateMisconceptionIds: ['misc-address-addition'],
      });
      const assessmentResult = makeAssessmentResult({
        result: 'partial',
        knowledgeNodeId: 'main-data-structures',
      });

      const diagnosis = service.evaluateProbeResult({
        sessionId: 'sess-101',
        userId: 'user-42',
        probeBlock,
        assessmentResult,
      });

      assert.ok(diagnosis !== null);
      assert.equal(diagnosis.knowledgeNodeId, 'prereq-pointers');
      assert.equal(diagnosis.type, 'misconception');
      assert.equal(diagnosis.status, 'confirmed');
      assert.equal(diagnosis.confidence, 0.9);
      assert.deepEqual(diagnosis.sourceEvidenceIds, ['asmt-result-1']);
    });

    it('returns null when probe succeeds without existing suspected diagnosis', () => {
      const probeBlock = makeProbeBlock({ targetKnowledgeNodeId: 'prereq-calculus' });
      const assessmentResult = makeAssessmentResult({ result: 'correct' });

      const diagnosis = service.evaluateProbeResult({
        sessionId: 'sess-101',
        userId: 'user-42',
        probeBlock,
        assessmentResult,
      });

      assert.equal(diagnosis, null);
    });

    it('resolves existing suspected diagnosis when probe succeeds', () => {
      const probeBlock = makeProbeBlock({ targetKnowledgeNodeId: 'prereq-calculus' });
      const assessmentResult = makeAssessmentResult({ result: 'correct' });
      const existingSuspected: LearningDiagnosis = {
        id: 'diag-existing-1',
        sessionId: 'sess-101',
        userId: 'user-42',
        knowledgeNodeId: 'prereq-calculus',
        type: 'missing_prerequisite',
        confidence: 0.5,
        status: 'suspected',
        sourceEvidenceIds: ['ev-prior'],
        createdAt: '2026-08-01T00:00:00.000Z',
      };

      const diagnosis = service.evaluateProbeResult({
        sessionId: 'sess-101',
        userId: 'user-42',
        probeBlock,
        assessmentResult,
        existingDiagnosis: existingSuspected,
      });

      assert.ok(diagnosis !== null);
      assert.equal(diagnosis.id, 'diag-existing-1');
      assert.equal(diagnosis.status, 'resolved');
      assert.ok(diagnosis.resolvedAt !== undefined);
    });
  });

  describe('evaluateEvidence (legacy)', () => {
    it('generates confirmed diagnosis on failed prerequisite probe', () => {
      const evidence = makeEvidence('incorrect', 'probe');
      const diagnosis = service.evaluateEvidence({
        sessionId: 'session-1',
        userId: 'user-1',
        knowledgeNodeId: 'node-prereq',
        evidence,
        isPrerequisiteProbe: true,
      });

      assert.ok(diagnosis !== null);
      assert.equal(diagnosis.status, 'confirmed');
      assert.equal(diagnosis.type, 'missing_prerequisite');
      assert.equal(diagnosis.knowledgeNodeId, 'node-prereq');
      assert.equal(diagnosis.userId, 'user-1');
      assert.deepEqual(diagnosis.sourceEvidenceIds, ['ev-test-1']);
      assert.ok(diagnosis.confidence >= 0.8);
    });

    it('generates confirmed misconception diagnosis when candidate misconception is provided', () => {
      const evidence = makeEvidence('incorrect', 'quiz', 0);
      const candidateMisconception: Misconception = {
        id: 'misc-async-await',
        knowledgeNodeId: 'node-async',
        title: 'Async Await Misconception',
        description: 'Confuses async execution with synchronous blocking',
        createdAt: '2026-08-01T00:00:00.000Z',
      };

      const diagnosis = service.evaluateEvidence({
        sessionId: 'session-1',
        userId: 'user-1',
        knowledgeNodeId: 'node-async',
        evidence,
        candidateMisconceptions: [candidateMisconception],
      });

      assert.ok(diagnosis !== null);
      assert.equal(diagnosis.status, 'confirmed');
      assert.equal(diagnosis.type, 'misconception');
      assert.deepEqual(diagnosis.sourceEvidenceIds, ['ev-test-1']);
    });

    it('returns null diagnosis when evidence is correct', () => {
      const evidence = makeEvidence('correct', 'probe', 1.0);
      const diagnosis = service.evaluateEvidence({
        sessionId: 'session-1',
        userId: 'user-1',
        knowledgeNodeId: 'node-prereq',
        evidence,
        isPrerequisiteProbe: true,
      });

      assert.equal(diagnosis, null);
    });

    it('resolves an active diagnosis', () => {
      const diagnosis = service.createDiagnosis({
        sessionId: 'session-1',
        userId: 'user-1',
        knowledgeNodeId: 'node-1',
        type: 'misconception',
        status: 'confirmed',
      });

      assert.equal(diagnosis.status, 'confirmed');
      const resolved = service.resolveDiagnosis(diagnosis, '2026-08-02T12:00:00.000Z');
      assert.equal(resolved.status, 'resolved');
      assert.equal(resolved.resolvedAt, '2026-08-02T12:00:00.000Z');
    });
  });
});
