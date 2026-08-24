import type {
  LearningEvidence,
  UserMisconception,
} from '@opentutor/protocol';

export class MisconceptionUpdater {
  recordSuspected(
    userId: string,
    misconceptionId: string,
    confidence: number = 0.5,
    now: string = new Date().toISOString()
  ): UserMisconception {
    return {
      userId,
      misconceptionId,
      confidence: Math.min(1, Math.max(0, confidence)),
      evidenceCount: 1,
      status: 'suspected',
      createdAt: now,
      updatedAt: now,
    };
  }

  confirmMisconception(
    current: UserMisconception,
    confidence: number = 0.9,
    now: string = new Date().toISOString()
  ): UserMisconception {
    return {
      ...current,
      confidence: Math.min(1, Math.max(0, confidence)),
      evidenceCount: current.evidenceCount + 1,
      status: 'confirmed',
      updatedAt: now,
      resolvedAt: undefined,
    };
  }

  resolveMisconception(
    current: UserMisconception,
    now: string = new Date().toISOString()
  ): UserMisconception {
    return {
      ...current,
      status: 'resolved',
      updatedAt: now,
      resolvedAt: now,
    };
  }

  updateFromEvidence(
    current: UserMisconception | null,
    evidence: LearningEvidence,
    misconceptionId: string,
    options?: { isMisconceptionProbe?: boolean }
  ): UserMisconception | null {
    const now = evidence.createdAt || new Date().toISOString();
    const isIncorrect = evidence.outcome === 'incorrect' || (evidence.score !== undefined && evidence.score <= 0.2);
    const isCorrect = evidence.outcome === 'correct' || (evidence.score !== undefined && evidence.score >= 0.8);

    if (isIncorrect) {
      if (!current) {
        if (options?.isMisconceptionProbe || evidence.type === 'probe') {
          return {
            userId: evidence.userId,
            misconceptionId,
            confidence: Math.max(0.8, evidence.confidence ?? 0.85),
            evidenceCount: 1,
            status: 'confirmed',
            createdAt: now,
            updatedAt: now,
          };
        }
        return this.recordSuspected(evidence.userId, misconceptionId, evidence.confidence ?? 0.5, now);
      }

      if (current.status === 'suspected') {
        return this.confirmMisconception(current, Math.max(current.confidence, evidence.confidence ?? 0.9), now);
      }

      if (current.status === 'confirmed') {
        return {
          ...current,
          evidenceCount: current.evidenceCount + 1,
          confidence: Math.min(1.0, current.confidence + 0.05),
          updatedAt: now,
        };
      }

      if (current.status === 'resolved') {
        return {
          ...current,
          status: 'suspected',
          evidenceCount: current.evidenceCount + 1,
          updatedAt: now,
          resolvedAt: undefined,
        };
      }
    } else if (isCorrect) {
      if (current && (current.status === 'suspected' || current.status === 'confirmed')) {
        return this.resolveMisconception(current, now);
      }
    }

    return current;
  }
}
