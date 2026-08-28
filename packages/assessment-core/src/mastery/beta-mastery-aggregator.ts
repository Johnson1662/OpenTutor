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

export interface UserKnowledgeStateV2 extends UserKnowledgeState {
  userId: string;
  knowledgeNodeId: string;
  status: KnowledgeStatus;
  confidence: number;
  masteryProbability: number;
  alpha: number;
  beta: number;
  evidenceCount: number;
  effectiveEvidenceCount: number;
  distinctSourceItemCount: number;
  correctCount: number;
  incorrectCount: number;
  stability: number;
  difficulty: number;
  lastAssessedAt: string;
  lastReviewedAt: string;
  sourceItemIds?: string[];
}

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

  computeAttemptMultiplier(attempt?: number): number {
    return this.attemptMultiplier(attempt);
  }

  attemptMultiplier(attempt?: number): number {
    const att = typeof attempt === 'number' && Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
    if (att <= 1) return 1.0;
    if (att === 2) return 0.4;
    if (att === 3) return 0.15;
    return 0.0;
  }

  computeStatus(
    p: number,
    effectiveEvidenceCount: number,
    distinctSourceItemCount: number = 0,
    evidenceCount: number = effectiveEvidenceCount
  ): KnowledgeStatus {
    if (evidenceCount < 1 && effectiveEvidenceCount <= 0) {
      return 'unknown';
    }
    if (p < 0.40) {
      return 'weak';
    }
    if (p >= 0.75 && effectiveEvidenceCount >= 3.0 && distinctSourceItemCount >= 3) {
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
          effectiveEvidenceCount: currentState.effectiveEvidenceCount ?? 0,
          distinctSourceItemCount: currentState.distinctSourceItemCount ?? 0,
          correctCount: currentState.correctCount ?? 0,
          incorrectCount: currentState.incorrectCount ?? 0,
          stability: currentState.stability ?? this.defaultStability,
          difficulty: currentState.difficulty ?? this.defaultDifficulty,
          lastAssessedAt: currentState.lastAssessedAt ?? timestamp,
          lastReviewedAt: currentState.lastReviewedAt ?? timestamp,
          sourceItemIds: currentState.sourceItemIds ?? [],
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
        effectiveEvidenceCount: 0,
        distinctSourceItemCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        stability: this.defaultStability,
        difficulty: this.defaultDifficulty,
        lastAssessedAt: timestamp,
        lastReviewedAt: timestamp,
        sourceItemIds: [],
      };
    }

    const difficultyWeight = this.computeDifficultyWeight(evidence.difficulty);
    const evidenceConfidence = typeof evidence.confidence === 'number' ? evidence.confidence : 1.0;
    const attemptMult = this.attemptMultiplier(evidence.attempt);
    const effectiveWeight = difficultyWeight * evidenceConfidence * attemptMult;

    let alpha = base.alpha ?? this.priorAlpha;
    let beta = base.beta ?? this.priorBeta;
    let correctCount = base.correctCount ?? 0;
    let incorrectCount = base.incorrectCount ?? 0;

    const score = typeof evidence.score === 'number'
      ? evidence.score
      : evidence.outcome === 'correct'
        ? 1.0
        : evidence.outcome === 'partial'
          ? 0.5
          : 0.0;

    if (score <= 0) {
      beta += effectiveWeight;
      incorrectCount += 1;
    } else {
      alpha += score * effectiveWeight;
      beta += (1.0 - score) * effectiveWeight;
      correctCount += 1;
    }

    const evidenceCount = (base.evidenceCount ?? 0) + 1;
    const effectiveEvidenceCount = (base.effectiveEvidenceCount ?? 0) + (attemptMult * evidenceConfidence);

    const currentSourceItemIds = new Set(base.sourceItemIds ?? []);
    if (evidence.sourceItemId && typeof evidence.sourceItemId === 'string') {
      currentSourceItemIds.add(evidence.sourceItemId);
    }
    const sourceItemIds = Array.from(currentSourceItemIds);
    const distinctSourceItemCount = sourceItemIds.length > 0 ? sourceItemIds.length : (base.distinctSourceItemCount ?? 0);

    const p = alpha / (alpha + beta);
    const status = this.computeStatus(p, effectiveEvidenceCount, distinctSourceItemCount, evidenceCount);

    return {
      userId: base.userId ?? evidence.userId,
      knowledgeNodeId: evidence.knowledgeNodeId,
      status,
      confidence: p,
      masteryProbability: p,
      alpha,
      beta,
      evidenceCount,
      effectiveEvidenceCount,
      distinctSourceItemCount,
      correctCount,
      incorrectCount,
      stability: base.stability ?? this.defaultStability,
      difficulty: base.difficulty ?? this.defaultDifficulty,
      lastAssessedAt: timestamp,
      lastReviewedAt: timestamp,
      sourceItemIds,
    };
  }

  projectMasteryAt(state: UserKnowledgeState, atTime: string): UserKnowledgeStateV2 {
    const timestamp = atTime;
    const defaultAlpha = this.priorAlpha;
    const defaultBeta = this.priorBeta;
    const effectiveEvidenceCount = state.effectiveEvidenceCount ?? 0;
    const distinctSourceItemCount = state.distinctSourceItemCount ?? (state.sourceItemIds ? state.sourceItemIds.length : 0);
    const sourceItemIds = state.sourceItemIds ?? [];

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
        effectiveEvidenceCount,
        distinctSourceItemCount,
        correctCount: state.correctCount ?? 0,
        incorrectCount: state.incorrectCount ?? 0,
        stability: state.stability ?? this.defaultStability,
        difficulty: state.difficulty ?? this.defaultDifficulty,
        lastAssessedAt: state.lastAssessedAt ?? timestamp,
        lastReviewedAt: state.lastReviewedAt ?? timestamp,
        sourceItemIds,
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
        effectiveEvidenceCount,
        distinctSourceItemCount,
        correctCount: state.correctCount ?? 0,
        incorrectCount: state.incorrectCount ?? 0,
        stability: state.stability ?? this.defaultStability,
        difficulty: state.difficulty ?? this.defaultDifficulty,
        lastAssessedAt: state.lastAssessedAt,
        lastReviewedAt: state.lastReviewedAt ?? state.lastAssessedAt,
        sourceItemIds,
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
        effectiveEvidenceCount,
        distinctSourceItemCount,
        correctCount: state.correctCount ?? 0,
        incorrectCount: state.incorrectCount ?? 0,
        stability: state.stability ?? this.defaultStability,
        difficulty: state.difficulty ?? this.defaultDifficulty,
        lastAssessedAt: state.lastAssessedAt,
        lastReviewedAt: state.lastReviewedAt ?? state.lastAssessedAt,
        sourceItemIds,
      };
    }

    const stability = typeof state.stability === 'number' && state.stability > 0 ? state.stability : this.defaultStability;
    const decay = Math.exp(-deltaDays / stability);

    const currentAlpha = state.alpha ?? this.priorAlpha;
    const currentBeta = state.beta ?? this.priorBeta;

    const alpha = 1.0 + (currentAlpha - 1.0) * decay;
    const beta = 1.0 + (currentBeta - 1.0) * decay;
    const p = alpha / (alpha + beta);
    const status = this.computeStatus(p, effectiveEvidenceCount, distinctSourceItemCount, state.evidenceCount ?? 0);

    return {
      userId: state.userId ?? 'default-user',
      knowledgeNodeId: state.knowledgeNodeId,
      status,
      confidence: p,
      masteryProbability: p,
      alpha,
      beta,
      evidenceCount: state.evidenceCount ?? 0,
      effectiveEvidenceCount,
      distinctSourceItemCount,
      correctCount: state.correctCount ?? 0,
      incorrectCount: state.incorrectCount ?? 0,
      stability,
      difficulty: state.difficulty ?? this.defaultDifficulty,
      lastAssessedAt: state.lastAssessedAt,
      lastReviewedAt: timestamp,
      sourceItemIds,
    };
  }

  static recomputeFromEvidenceHistory(
    evidences: LearningEvidence[],
    options?: BetaMasteryAggregatorOptions
  ): UserKnowledgeStateV2 {
    const aggregator = new BetaMasteryAggregator(options);
    return aggregator.recomputeFromEvidenceHistory(evidences);
  }

  recomputeFromEvidenceHistory(evidences: LearningEvidence[]): UserKnowledgeStateV2 {
    if (!evidences || evidences.length === 0) {
      const initialP = this.priorAlpha / (this.priorAlpha + this.priorBeta);
      return {
        userId: 'default-user',
        knowledgeNodeId: '',
        status: 'unknown',
        confidence: initialP,
        masteryProbability: initialP,
        alpha: this.priorAlpha,
        beta: this.priorBeta,
        evidenceCount: 0,
        effectiveEvidenceCount: 0,
        distinctSourceItemCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        stability: this.defaultStability,
        difficulty: this.defaultDifficulty,
        lastAssessedAt: new Date().toISOString(),
        lastReviewedAt: new Date().toISOString(),
        sourceItemIds: [],
      };
    }

    let state: UserKnowledgeStateV2 | null = null;
    for (const evidence of evidences) {
      state = this.updateMastery(state, evidence, evidence.createdAt);
    }
    return state!;
  }
}
