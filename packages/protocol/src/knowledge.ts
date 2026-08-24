export type KnowledgeStatus = 'unknown' | 'learning' | 'weak' | 'mastered';

export type LearningEvidenceType = 'quiz' | 'probe' | 'self_report' | 'tutor_observation';

export type LearningEvidenceOutcome = 'correct' | 'partial' | 'incorrect';

export interface LearningEvidence {
  id: string;
  userId: string;
  knowledgeNodeId: string;
  type: LearningEvidenceType;
  source: string;
  sourceItemId?: string;
  attempt?: number;
  outcome: LearningEvidenceOutcome;
  score?: number;
  difficulty: number;
  confidence: number;
  weight: number;
  assessmentId?: string;
  sessionId?: string;
  createdAt: string;
}

export interface UserKnowledgeState {
  userId?: string;
  knowledgeNodeId: string;
  status: KnowledgeStatus;
  confidence: number;
  masteryProbability?: number;
  alpha?: number;
  beta?: number;
  evidenceCount?: number;
  effectiveEvidenceCount?: number;
  distinctSourceItemCount?: number;
  correctCount?: number;
  incorrectCount?: number;
  stability?: number;
  difficulty?: number;
  lastAssessedAt?: string;
  lastReviewedAt?: string;
  sourceItemIds?: string[];
}

export interface Misconception {
  id: string;
  knowledgeNodeId: string;
  title: string;
  description: string;
  correctionStrategy?: string;
  createdAt: string;
}

export type UserMisconceptionStatus = 'suspected' | 'confirmed' | 'resolved';

export interface UserMisconception {
  userId: string;
  misconceptionId: string;
  confidence: number;
  evidenceCount: number;
  status: UserMisconceptionStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export type LearningDiagnosisStatus = 'suspected' | 'confirmed' | 'resolved' | 'dismissed';
export type LearningDiagnosisType = 'missing_prerequisite' | 'misconception' | 'mastery_gap';

export interface LearningDiagnosis {
  id: string;
  sessionId: string;
  userId: string;
  knowledgeNodeId: string;
  type: LearningDiagnosisType;
  confidence: number;
  status: LearningDiagnosisStatus;
  sourceEvidenceIds: string[];
  createdAt: string;
  resolvedAt?: string;
}
