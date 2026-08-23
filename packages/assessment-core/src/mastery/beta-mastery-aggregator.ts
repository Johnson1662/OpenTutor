import type {
  KnowledgeStatus,
  LearningEvidence,
  UserKnowledgeState,
} from '@opentutor/protocol';

export interface BetaMasteryAggregatorOptions {
  priorAlpha?: number;
  priorBeta?: number;
  defaultStability?: number;
  defaultDifficulty?: number;
}

export type UserKnowledgeStateV2 = Required<UserKnowledgeState>;

export class BetaMasteryAggregator {
  private readonly priorAlpha: number;
  private readonly priorBeta: number;
  private readonly defaultStability: number;
  private readonly defaultDifficulty: number;

  constructor(options: BetaMasteryAggregatorOptions = {}) {
    this.priorAlpha = options.priorAlpha ?? 1.0;
    this.priorBeta = options.priorBeta ?? 1.0;
    this.defaultStability = options.defaultStability ?? 7.0;
    this.defaultDifficulty = options.defaultDifficulty ?? 1.0;
  }

  computeDifficultyWeight(difficulty: number | 'easy' | 'medium' | 'hard'): number {
    if (typeof difficulty === 'string') {
      switch (difficulty.toLowerCase()) {
        case 'easy':
          return 0.6;
        case 'hard':
          return 1.4;
        case 'medium':
        default:
          return 1.0;
      }
    }
    if (typeof difficulty === 'number') {
      if (difficulty <= 0) return 0.6;
      return difficulty;
    }
    return 1.0;
  }

  computeStatus(p: number, evidenceCount: number): KnowledgeStatus {
    if (evidenceCount < 1) {
      return 'unknown';
    }
    if (p < 0.40) {
      return 'weak';
    }
    if (p >= 0.85 && evidenceCount >= 3) {
      return 'mastered';
    }
    return 'learning';
  }

  updateMastery(
    currentState: UserKnowledgeState | null,
    evidence: LearningEvidence,
    now?: string
  ): UserKnowledgeStateV2 {
    const timestamp = now ?? evidence.createdAt ?? new Date().toISOString();

    let base: UserKnowledgeStateV2;
    if (currentState) {
      if (currentState.lastAssessedAt) {
        base = this.projectMasteryAt(currentState, timestamp);
      } else {
        base = {
          userId: currentState.userId ?? evidence.userId,
          knowledgeNodeId: currentState.knowledgeNodeId,
          status: currentState.status,
          confidence: currentState.confidence,
          masteryProbability: currentState.masteryProbability ?? this.priorAlpha / (this.priorAlpha + this.priorBeta),
          alpha: currentState.alpha ?? this.priorAlpha,
          beta: currentState.beta ?? this.priorBeta,
          evidenceCount: currentState.evidenceCount ?? 0,
          correctCount: currentState.correctCount ?? 0,
          incorrectCount: currentState.incorrectCount ?? 0,
          stability: currentState.stability ?? this.defaultStability,
          difficulty: currentState.difficulty ?? this.defaultDifficulty,
          lastAssessedAt: currentState.lastAssessedAt ?? timestamp,
          lastReviewedAt: currentState.lastReviewedAt ?? timestamp,
        };
      }
    } else {
      base = {
        userId: evidence.userId,
        knowledgeNodeId: evidence.knowledgeNodeId,
        status: 'unknown',
        confidence: this.priorAlpha / (this.priorAlpha + this.priorBeta),
        masteryProbability: this.priorAlpha / (this.priorAlpha + this.priorBeta),
        alpha: this.priorAlpha,
        beta: this.priorBeta,
        evidenceCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        stability: this.defaultStability,
        difficulty: this.defaultDifficulty,
        lastAssessedAt: timestamp,
        lastReviewedAt: timestamp,
      };
    }

    const difficultyWeight = this.computeDifficultyWeight(evidence.difficulty);
    const confidence = typeof evidence.confidence === 'number' ? evidence.confidence : 1.0;
    const weight = difficultyWeight * confidence;

    let alpha = base.alpha ?? this.priorAlpha;
    let beta = base.beta ?? this.priorBeta;
    let correctCount = base.correctCount ?? 0;
    let incorrectCount = base.incorrectCount ?? 0;

    if (evidence.outcome === 'correct') {
      alpha += weight;
      correctCount += 1;
    } else if (evidence.outcome === 'incorrect') {
      beta += weight;
      incorrectCount += 1;
    } else if (evidence.outcome === 'partial') {
      alpha += 0.5 * weight;
      beta += 0.5 * weight;
    }

    const evidenceCount = (base.evidenceCount ?? 0) + 1;
    const p = alpha / (alpha + beta);
    const status = this.computeStatus(p, evidenceCount);

    return {
      userId: base.userId ?? evidence.userId,
      knowledgeNodeId: evidence.knowledgeNodeId,
      status,
      confidence: p,
      masteryProbability: p,
      alpha,
      beta,
      evidenceCount,
      correctCount,
      incorrectCount,
      stability: base.stability ?? this.defaultStability,
      difficulty: base.difficulty ?? this.defaultDifficulty,
      lastAssessedAt: timestamp,
      lastReviewedAt: timestamp,
    };
  }

  projectMasteryAt(state: UserKnowledgeState, atTime: string): UserKnowledgeStateV2 {
    const timestamp = atTime;
    const defaultAlpha = this.priorAlpha;
    const defaultBeta = this.priorBeta;

    if (!state.lastAssessedAt) {
      return {
        userId: state.userId ?? 'default-user',
        knowledgeNodeId: state.knowledgeNodeId,
        status: state.status,
        confidence: state.confidence,
        masteryProbability: state.masteryProbability ?? defaultAlpha / (defaultAlpha + defaultBeta),
        alpha: state.alpha ?? defaultAlpha,
        beta: state.beta ?? defaultBeta,
        evidenceCount: state.evidenceCount ?? 0,
        correctCount: state.correctCount ?? 0,
        incorrectCount: state.incorrectCount ?? 0,
        stability: state.stability ?? this.defaultStability,
        difficulty: state.difficulty ?? this.defaultDifficulty,
        lastAssessedAt: state.lastAssessedAt ?? timestamp,
        lastReviewedAt: state.lastReviewedAt ?? timestamp,
      };
    }

    const lastAssessed = new Date(state.lastAssessedAt).getTime();
    const targetTime = new Date(atTime).getTime();

    if (isNaN(lastAssessed) || isNaN(targetTime)) {
      return {
        userId: state.userId ?? 'default-user',
        knowledgeNodeId: state.knowledgeNodeId,
        status: state.status,
        confidence: state.confidence,
        masteryProbability: state.masteryProbability ?? defaultAlpha / (defaultAlpha + defaultBeta),
        alpha: state.alpha ?? defaultAlpha,
        beta: state.beta ?? defaultBeta,
        evidenceCount: state.evidenceCount ?? 0,
        correctCount: state.correctCount ?? 0,
        incorrectCount: state.incorrectCount ?? 0,
        stability: state.stability ?? this.defaultStability,
        difficulty: state.difficulty ?? this.defaultDifficulty,
        lastAssessedAt: state.lastAssessedAt,
        lastReviewedAt: state.lastReviewedAt ?? state.lastAssessedAt,
      };
    }

    const deltaDays = (targetTime - lastAssessed) / (1000 * 60 * 60 * 24);
    if (deltaDays <= 0) {
      return {
        userId: state.userId ?? 'default-user',
        knowledgeNodeId: state.knowledgeNodeId,
        status: state.status,
        confidence: state.confidence,
        masteryProbability: state.masteryProbability ?? defaultAlpha / (defaultAlpha + defaultBeta),
        alpha: state.alpha ?? defaultAlpha,
        beta: state.beta ?? defaultBeta,
        evidenceCount: state.evidenceCount ?? 0,
        correctCount: state.correctCount ?? 0,
        incorrectCount: state.incorrectCount ?? 0,
        stability: state.stability ?? this.defaultStability,
        difficulty: state.difficulty ?? this.defaultDifficulty,
        lastAssessedAt: state.lastAssessedAt,
        lastReviewedAt: state.lastReviewedAt ?? state.lastAssessedAt,
      };
    }

    const stability = typeof state.stability === 'number' && state.stability > 0 ? state.stability : this.defaultStability;
    const decay = Math.exp(-deltaDays / stability);

    const currentAlpha = state.alpha ?? this.priorAlpha;
    const currentBeta = state.beta ?? this.priorBeta;

    const alpha = 1.0 + (currentAlpha - 1.0) * decay;
    const beta = 1.0 + (currentBeta - 1.0) * decay;
    const p = alpha / (alpha + beta);
    const status = this.computeStatus(p, state.evidenceCount ?? 0);

    return {
      userId: state.userId ?? 'default-user',
      knowledgeNodeId: state.knowledgeNodeId,
      status,
      confidence: p,
      masteryProbability: p,
      alpha,
      beta,
      evidenceCount: state.evidenceCount ?? 0,
      correctCount: state.correctCount ?? 0,
      incorrectCount: state.incorrectCount ?? 0,
      stability,
      difficulty: state.difficulty ?? this.defaultDifficulty,
      lastAssessedAt: state.lastAssessedAt,
      lastReviewedAt: timestamp,
    };
  }
}
