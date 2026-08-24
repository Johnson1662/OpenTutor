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
  correctCount?: number;
  incorrectCount?: number;
  stability?: number;
  difficulty?: number;
  lastAssessedAt?: string;
  lastReviewedAt?: string;
}
