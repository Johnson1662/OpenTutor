import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProbeService,
  ModelProbeGenerator,
  DiagnosisService,
  ReplanPolicy,
  MisconceptionUpdater,
} from '../src/index.ts';
import { BetaMasteryAggregator } from '../../assessment-core/src/index.ts';
import type {
  AssessmentResult,
  LearningEvidence,
  LearningPathNode,
  Misconception,
  UserKnowledgeState,
} from '@opentutor/protocol';

describe('@opentutor/learning-core integrated flow', () => {
  it('executes Wave 2 diagnostic probing, generation, diagnosis, and replanning flow', async () => {
    const probeService = new ProbeService();
    const probeGenerator = new ModelProbeGenerator();
    const diagnosisService = new DiagnosisService();
    const replanPolicy = new ReplanPolicy();
    const misconceptionUpdater = new MisconceptionUpdater();
    const masteryAggregator = new BetaMasteryAggregator();

    // 1. Initial State: Prerequisite 'matrix-multiplication' is weak
    const matrixState: UserKnowledgeState = {
      userId: 'user-1',
      knowledgeNodeId: 'matrix-multiplication',
      status: 'weak',
      confidence: 0.35,
      masteryProbability: 0.35,
      evidenceCount: 1,
      effectiveEvidenceCount: 1.0,
      distinctSourceItemCount: 1,
    };

    const getKnowledgeState = (nodeId: string): UserKnowledgeState | null => {
      if (nodeId === 'matrix-multiplication') return matrixState;
      return null;
    };

    // 2. ProbeService evaluates target node 'self-attention' with prerequisite 'matrix-multiplication'
    const probeDecision = probeService.decideProbe({
      activeNodeId: 'self-attention',
      prerequisiteNodeIds: ['matrix-multiplication'],
      getKnowledgeState,
    });

    assert.equal(probeDecision.shouldProbe, true);
    assert.equal(probeDecision.targetKnowledgeNodeId, 'matrix-multiplication');
    assert.equal(probeDecision.probeType, 'concept');

    // 3. ModelProbeGenerator generates diagnostic QuizBlock
    const probeBlock = await probeGenerator.generate({
      targetKnowledgeNodeId: probeDecision.targetKnowledgeNodeId!,
      probeType: probeDecision.probeType,
      nodeTitle: 'Matrix Multiplication',
    });

    assert.equal(probeBlock.type, 'quiz');
    assert.equal(probeBlock.assessmentKind, 'probe');
    assert.equal(probeBlock.targetKnowledgeNodeId, 'matrix-multiplication');
    assert.equal(probeBlock.answerType, 'single_choice');
    assert.ok(probeBlock.options && probeBlock.options.length >= 2);
    assert.ok(probeBlock.answerSpec && 'correctOptionId' in probeBlock.answerSpec && probeBlock.answerSpec.correctOptionId);
    // 4. Learner answers incorrectly -> AssessmentResult recorded
    const assessmentResult: AssessmentResult = {
      id: 'asmt-probe-1',
      knowledgeNodeId: 'matrix-multiplication',
      lessonId: 'lesson-self-attention',
      blockId: probeBlock.id,
      result: 'incorrect',
      confidence: 0.0,
      feedback: 'Matrix dimension mismatch was not handled properly.',
    };

    // 5. DiagnosisService evaluates probe result -> confirmed missing_prerequisite diagnosis
    const diagnosis = diagnosisService.evaluateProbeResult({
      sessionId: 'session-200',
      userId: 'user-1',
      probeBlock,
      assessmentResult,
    });

    assert.ok(diagnosis !== null);
    assert.equal(diagnosis.sessionId, 'session-200');
    assert.equal(diagnosis.userId, 'user-1');
    assert.equal(diagnosis.knowledgeNodeId, 'matrix-multiplication');
    assert.equal(diagnosis.type, 'missing_prerequisite');
    assert.equal(diagnosis.status, 'confirmed');
    assert.equal(diagnosis.confidence, 0.9);
    assert.deepEqual(diagnosis.sourceEvidenceIds, ['asmt-probe-1']);

    // 6. ReplanPolicy evaluates current path and diagnoses -> authorizes detour
    const currentPath: LearningPathNode[] = [
      {
        id: 'path-1',
        knowledgeNodeId: 'self-attention',
        title: 'Self Attention',
        type: 'main',
        status: 'current',
        position: 0,
      },
    ];

    const replanDecision = replanPolicy.evaluateReplan({
      sessionId: 'session-200',
      diagnoses: [diagnosis],
      currentPath,
    });

    assert.equal(replanDecision.action, 'insert_detour');
    assert.equal(replanDecision.targetNodeId, 'matrix-multiplication');
    assert.equal(replanDecision.diagnosisId, diagnosis.id);
    assert.equal(replanDecision.reason, 'Confirmed prerequisite gap');

    // 7. Prerequisite lesson completed -> diagnosis resolved
    const resolvedDiagnosis = diagnosisService.resolveDiagnosis(diagnosis);
    assert.equal(resolvedDiagnosis.status, 'resolved');

    const updatedPath: LearningPathNode[] = [
      {
        id: 'path-detour-1',
        knowledgeNodeId: 'matrix-multiplication',
        title: 'Matrix Multiplication Remediation',
        type: 'detour',
        status: 'completed',
        position: 0,
      },
      {
        id: 'path-1',
        knowledgeNodeId: 'self-attention',
        title: 'Self Attention',
        type: 'main',
        status: 'current',
        position: 1,
      },
    ];

    const postRemediationDecision = replanPolicy.evaluateReplan({
      sessionId: 'session-200',
      diagnoses: [resolvedDiagnosis],
      currentPath: updatedPath,
    });

    assert.equal(postRemediationDecision.action, 'continue');
  });

  it('executes full probe -> diagnose -> detour -> resolve arc (legacy)', () => {
    const probeService = new ProbeService();
    const diagnosisService = new DiagnosisService();
    const replanPolicy = new ReplanPolicy();
    const misconceptionUpdater = new MisconceptionUpdater();
    const masteryAggregator = new BetaMasteryAggregator();

    // 1. Initial State: Prerequisite P1 is uncertain (p = 0.5, 1 evidence)
    const p1State: UserKnowledgeState = {
      userId: 'user-1',
      knowledgeNodeId: 'prereq-p1',
      status: 'learning',
      confidence: 0.5,
      masteryProbability: 0.5,
      evidenceCount: 1,
      effectiveEvidenceCount: 1.0,
      distinctSourceItemCount: 1,
    };

    // 2. ProbeService evaluates target node with prerequisite P1 -> decides to probe
    const probeDecision = probeService.decideProbe({
      targetKnowledgeNodeId: 'prereq-p1',
      prerequisiteState: p1State,
      candidateMisconceptionIds: ['misc-pointers'],
    });
    assert.equal(probeDecision.shouldProbe, true);
    assert.ok(probeDecision.probeType !== undefined);

    // 3. Probe is served and learner answers INCORRECTLY
    const probeEvidence: LearningEvidence = {
      id: 'ev-probe-fail',
      userId: 'user-1',
      knowledgeNodeId: 'prereq-p1',
      type: 'probe',
      source: 'lesson-1',
      attempt: 1,
      outcome: 'incorrect',
      score: 0.0,
      difficulty: 1.0,
      confidence: 1.0,
      weight: 1.0,
      createdAt: '2026-08-01T12:00:00.000Z',
    };

    // 4. DiagnosisService confirms prerequisite gap / misconception
    const candidateMisc: Misconception = {
      id: 'misc-pointers',
      knowledgeNodeId: 'prereq-p1',
      title: 'Pointer arithmetic confusion',
      description: 'Learner confuses address addition with value addition',
      createdAt: '2026-08-01T00:00:00.000Z',
    };

    const diagnosis = diagnosisService.evaluateEvidence({
      sessionId: 'session-100',
      userId: 'user-1',
      knowledgeNodeId: 'prereq-p1',
      evidence: probeEvidence,
      isPrerequisiteProbe: true,
      candidateMisconceptions: [candidateMisc],
    });
    assert.ok(diagnosis !== null);
    assert.equal(diagnosis.status, 'confirmed');

    // 5. ReplanPolicy evaluates confirmed diagnosis -> authorizes insert_detour
    const replanDecision = replanPolicy.evaluate(diagnosis);
    assert.equal(replanDecision.action, 'insert_detour');
    assert.equal(replanDecision.targetNodeId, 'prereq-p1');
    assert.equal(replanDecision.diagnosisId, diagnosis.id);

    // 6. MisconceptionUpdater updates state to confirmed
    const userMisc = misconceptionUpdater.updateFromEvidence(null, probeEvidence, 'misc-pointers', { isMisconceptionProbe: true });
    assert.ok(userMisc !== null);
    assert.equal(userMisc.status, 'confirmed');

    // 7. Mastery aggregator updates mastery for P1 -> demotes to weak / lower probability
    const updatedState = masteryAggregator.updateMastery(p1State, probeEvidence);
    assert.ok(updatedState.masteryProbability < 0.45);

    // 8. Learner finishes detour lesson and passes the remediation quiz
    const remediationEvidence: LearningEvidence = {
      id: 'ev-remed-pass',
      userId: 'user-1',
      knowledgeNodeId: 'prereq-p1',
      type: 'quiz',
      source: 'detour-lesson',
      sourceItemId: 'detour-item-1',
      attempt: 1,
      outcome: 'correct',
      score: 1.0,
      difficulty: 1.5,
      confidence: 1.0,
      weight: 1.5,
      createdAt: '2026-08-01T12:30:00.000Z',
    };

    // 9. Misconception resolved
    const resolvedMisc = misconceptionUpdater.updateFromEvidence(userMisc, remediationEvidence, 'misc-pointers');
    assert.ok(resolvedMisc !== null);
    assert.equal(resolvedMisc.status, 'resolved');

    // 10. Diagnosis resolved
    const resolvedDiag = diagnosisService.resolveDiagnosis(diagnosis);
    assert.equal(resolvedDiag.status, 'resolved');

    // 11. ReplanPolicy on resolved diagnosis -> continues normally
    const postRemediationReplan = replanPolicy.evaluate(resolvedDiag);
    assert.equal(postRemediationReplan.action, 'continue');
  });
});
