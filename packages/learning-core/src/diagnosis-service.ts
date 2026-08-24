import { randomUUID } from 'node:crypto';
import type {
  AssessmentResult,
  LearningDiagnosis,
  LearningDiagnosisStatus,
  LearningDiagnosisType,
  LearningEvidence,
  Misconception,
  QuizBlock,
  UserMisconception,
} from '@opentutor/protocol';

export interface EvaluateProbeResultInput {
  sessionId: string;
  userId: string;
  probeBlock: QuizBlock;
  assessmentResult: AssessmentResult;
  existingDiagnosis?: LearningDiagnosis | null;
}

export interface EvaluateDiagnosisParams {
  sessionId: string;
  userId: string;
  knowledgeNodeId: string;
  evidence: LearningEvidence;
  isPrerequisiteProbe?: boolean;
  candidateMisconceptions?: readonly Misconception[];
  userMisconceptions?: readonly UserMisconception[];
}

export class DiagnosisService {
  evaluateProbeResult(input: EvaluateProbeResultInput): LearningDiagnosis | null {
    const { sessionId, userId, probeBlock, assessmentResult, existingDiagnosis } = input;
    const isFailure =
      assessmentResult.result === 'incorrect' ||
      assessmentResult.result === 'partial' ||
      (typeof assessmentResult.confidence === 'number' && assessmentResult.confidence <= 0.2);

    if (isFailure) {
      const knowledgeNodeId = probeBlock.targetKnowledgeNodeId || assessmentResult.knowledgeNodeId;
      const hasMisconceptions = Boolean(
        probeBlock.candidateMisconceptionIds && probeBlock.candidateMisconceptionIds.length > 0
      );
      const diagnosisType = hasMisconceptions ? 'misconception' : 'missing_prerequisite';
      const now = new Date().toISOString();

      return {
        id: `diag-${randomUUID()}`,
        sessionId,
        userId,
        knowledgeNodeId,
        type: diagnosisType,
        confidence: 0.9,
        status: 'confirmed',
        sourceEvidenceIds: [assessmentResult.id],
        createdAt: now,
      };
    }

    if (existingDiagnosis && existingDiagnosis.status === 'suspected') {
      return this.resolveDiagnosis(existingDiagnosis);
    }

    return null;
  }

  evaluateEvidence(params: EvaluateDiagnosisParams): LearningDiagnosis | null {
    const { sessionId, userId, knowledgeNodeId, evidence, isPrerequisiteProbe, candidateMisconceptions } = params;

    const isFailure = evidence.outcome === 'incorrect' || (evidence.score !== undefined && evidence.score <= 0.2);
    const isProbe = isPrerequisiteProbe || evidence.type === 'probe';

    if (isFailure) {
      const now = evidence.createdAt || new Date().toISOString();
      const hasMisconceptions = Boolean(candidateMisconceptions && candidateMisconceptions.length > 0);
      const diagnosisType: LearningDiagnosis['type'] = isProbe
        ? (hasMisconceptions ? 'misconception' : 'missing_prerequisite')
        : (hasMisconceptions ? 'misconception' : 'mastery_gap');
      return {
        id: `diag-${randomUUID()}`,
        sessionId,
        userId,
        knowledgeNodeId,
        type: diagnosisType,
        confidence: typeof evidence.confidence === 'number' ? Math.max(0.7, evidence.confidence) : 0.85,
        status: 'confirmed',
        sourceEvidenceIds: [evidence.id],
        createdAt: now,
      };
    }

    return null;
  }

  createDiagnosis(params: {
    sessionId: string;
    userId: string;
    knowledgeNodeId: string;
    type: LearningDiagnosisType | string;
    confidence?: number;
    status?: LearningDiagnosisStatus;
    sourceEvidenceIds?: string[];
    createdAt?: string;
  }): LearningDiagnosis {
    const now = params.createdAt || new Date().toISOString();
    return {
      id: `diag-${randomUUID()}`,
      sessionId: params.sessionId,
      userId: params.userId,
      knowledgeNodeId: params.knowledgeNodeId,
      type: params.type as LearningDiagnosisType,
      confidence: params.confidence ?? 0.8,
      status: params.status ?? 'confirmed',
      sourceEvidenceIds: params.sourceEvidenceIds ?? [],
      createdAt: now,
    };
  }

  resolveDiagnosis(diagnosis: LearningDiagnosis, resolvedAt?: string): LearningDiagnosis {
    const now = resolvedAt || new Date().toISOString();
    return {
      ...diagnosis,
      status: 'resolved',
      resolvedAt: now,
    };
  }
}
