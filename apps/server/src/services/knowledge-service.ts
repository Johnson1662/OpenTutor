import { randomUUID } from 'node:crypto';
import type {
  AssessmentCompletedEventData,
  AssessmentResult,
  DiagnosisUpdatedEventData,
  KnowledgeUpdatedEventData,
  LearningDiagnosis,
  LearningEvidence,
  LearningEvidenceType,
  UserKnowledgeState,
} from '@opentutor/protocol';
import {
  type Database,
  DiagnosisRepository,
  KnowledgeRepository,
  LearningEvidenceRepository,
  MisconceptionRepository,
} from '@opentutor/database';
import { BetaMasteryAggregator, type UserKnowledgeStateV2 } from '@opentutor/assessment-core';
import { DiagnosisService, MisconceptionUpdater } from '@opentutor/learning-core';
import type {
  SearchService,
  KnowledgeSearchResultItem,
  KnowledgeArtifact,
  NeighborResult,
  SourceChunk,
} from '@opentutor/knowledge-core';
import type { EventBus } from '../events/event-bus.ts';

export class KnowledgeService {
  private readonly knowledgeRepo: KnowledgeRepository;
  private readonly evidenceRepo?: LearningEvidenceRepository;
  private readonly misconceptionRepo?: MisconceptionRepository;
  private readonly diagnosisRepo?: DiagnosisRepository;
  private readonly searchService: SearchService;
  private readonly eventBus: EventBus;
  private readonly aggregator: BetaMasteryAggregator;
  private readonly misconceptionUpdater: MisconceptionUpdater;
  private readonly diagnosisService: DiagnosisService;
  private readonly db?: Database;

  constructor(
    knowledgeRepo: KnowledgeRepository,
    searchService: SearchService,
    eventBus: EventBus,
    evidenceRepo?: LearningEvidenceRepository,
    aggregator?: BetaMasteryAggregator,
    db?: Database,
    misconceptionRepo?: MisconceptionRepository,
    diagnosisRepo?: DiagnosisRepository,
    misconceptionUpdater?: MisconceptionUpdater,
    diagnosisService?: DiagnosisService
  ) {
    this.knowledgeRepo = knowledgeRepo;
    this.evidenceRepo = evidenceRepo;
    this.searchService = searchService;
    this.eventBus = eventBus;
    this.aggregator = aggregator ?? new BetaMasteryAggregator();
    const repoWithDb = knowledgeRepo as unknown as { db?: Database };
    const evidenceRepoWithDb = evidenceRepo as unknown as { db?: Database };
    this.db = db ?? repoWithDb?.db ?? evidenceRepoWithDb?.db;
    this.misconceptionRepo = misconceptionRepo ?? (this.db ? new MisconceptionRepository(this.db) : undefined);
    this.diagnosisRepo = diagnosisRepo ?? (this.db ? new DiagnosisRepository(this.db) : undefined);
    this.misconceptionUpdater = misconceptionUpdater ?? new MisconceptionUpdater();
    this.diagnosisService = diagnosisService ?? new DiagnosisService();
  }
  getUserKnowledgeState(userId: string, knowledgeNodeId: string): UserKnowledgeState | null {
    if (this.evidenceRepo) {
      const state = this.knowledgeRepo.getUserKnowledgeState(userId, knowledgeNodeId);
      if (!state) return null;
      const evidences = this.evidenceRepo.getEvidenceForNode(userId, knowledgeNodeId);
      if (evidences.length > 0) {
        return this.aggregator.recomputeFromEvidenceHistory(evidences);
      }
      return state;
    }
    return this.knowledgeRepo.getUserKnowledgeState(userId, knowledgeNodeId);
  }

  recordAssessment(
    sessionId: string,
    assessment: AssessmentResult,
    userId: string = 'default-user',
    options?: {
      difficulty?: number | 'easy' | 'medium' | 'hard';
      confidence?: number;
      score?: number;
      sourceItemId?: string;
      type?: LearningEvidenceType;
      candidateMisconceptionIds?: string[];
      isPrerequisiteProbe?: boolean;
    }
  ): UserKnowledgeStateV2 & { evidence: LearningEvidence; diagnosis: LearningDiagnosis | null } {
    const now = new Date().toISOString();
    const rawDifficulty = options?.difficulty ?? 1.0;
    const diffWeight = this.aggregator.computeDifficultyWeight(rawDifficulty);
    const confidence = options?.confidence ?? (typeof assessment.confidence === 'number' ? assessment.confidence : 1.0);
    const numericDifficulty = typeof rawDifficulty === 'number' ? rawDifficulty : diffWeight;

    const previousAttempts = this.evidenceRepo?.countItemAttempts?.(userId, assessment.knowledgeNodeId, options?.sourceItemId ?? '') ?? 0;
    const attempt = previousAttempts + 1;
    const attemptMult = this.aggregator.attemptMultiplier(attempt);
    const effectiveWeight = diffWeight * confidence * attemptMult;

    const evidenceType: LearningEvidenceType = options?.type ?? 'quiz';

    const evidence: LearningEvidence = {
      id: `ev-${randomUUID()}`,
      userId,
      knowledgeNodeId: assessment.knowledgeNodeId,
      type: evidenceType,
      source: assessment.lessonId || 'assessment',
      sourceItemId: options?.sourceItemId,
      attempt,
      outcome: assessment.result,
      score: options?.score,
      difficulty: numericDifficulty,
      confidence,
      weight: effectiveWeight,
      assessmentId: assessment.id,
      sessionId,
      createdAt: now,
    };

    let updatedState: UserKnowledgeStateV2;
    if (this.evidenceRepo) {
      const previousEvidences = this.evidenceRepo.getEvidenceForNode(userId, assessment.knowledgeNodeId);
      updatedState = this.aggregator.recomputeFromEvidenceHistory([...previousEvidences, evidence]);
    } else {
      const currentState = this.knowledgeRepo.getUserKnowledgeState(userId, assessment.knowledgeNodeId);
      updatedState = this.aggregator.updateMastery(currentState, evidence, now);
    }

    let resultingDiagnosis: LearningDiagnosis | null = null;

    const executeTxBody = () => {
      // 1. insert assessment
      this.knowledgeRepo.recordAssessment(assessment, userId);

      // 2. insert learning_evidence (with attempt count, source_item_id, effective weight)
      if (this.evidenceRepo) {
        this.evidenceRepo.recordEvidence(evidence);
      }

      // 3. update user_knowledge_states (alpha, beta, masteryProbability, effectiveEvidenceCount, distinctSourceItemCount)
      this.knowledgeRepo.setUserKnowledgeState(userId, updatedState);

      // 4. update user_misconceptions (if candidateMisconceptionIds provided)
      if (options?.candidateMisconceptionIds && options.candidateMisconceptionIds.length > 0 && this.misconceptionRepo) {
        for (const miscId of options.candidateMisconceptionIds) {
          const currentMisc = this.misconceptionRepo.getUserMisconception(userId, miscId);
          const updatedMisc = this.misconceptionUpdater.updateFromEvidence(currentMisc, evidence, miscId, {
            isMisconceptionProbe: evidenceType === 'probe',
          });
          if (updatedMisc) {
            this.misconceptionRepo.setUserMisconception(updatedMisc);
          }
        }
      }

      // 5. record/update learning_diagnoses (if probe outcome indicates gap)
      const isProbe = evidenceType === 'probe' || Boolean(options?.isPrerequisiteProbe);
      const isFailure = assessment.result === 'incorrect' || assessment.result === 'partial';
      if (isProbe && isFailure && this.diagnosisRepo) {
        const diag = this.diagnosisService.evaluateEvidence({
          sessionId,
          userId,
          knowledgeNodeId: assessment.knowledgeNodeId,
          evidence,
          isPrerequisiteProbe: isProbe,
          candidateMisconceptions: options?.candidateMisconceptionIds?.map((id) => ({
            id,
            knowledgeNodeId: assessment.knowledgeNodeId,
            title: id,
            description: id,
            createdAt: now,
          })),
        });
        if (diag) {
          resultingDiagnosis = this.diagnosisRepo.recordDiagnosis(diag);
        }
      }
    };

    if (this.db) {
      const runTx = this.db.transaction(() => {
        executeTxBody();
      });
      runTx();
    } else {
      executeTxBody();
    }

    // Publish domain events strictly after transaction commits
    const asmtEvent: AssessmentCompletedEventData = {
      assessment,
    };
    this.eventBus.publish(sessionId, 'assessment.completed', asmtEvent);

    const knEvent: KnowledgeUpdatedEventData = {
      knowledgeNodeId: assessment.knowledgeNodeId,
      status: updatedState.status,
      confidence: updatedState.masteryProbability ?? updatedState.confidence ?? 0.5,
    };
    this.eventBus.publish(sessionId, 'knowledge.updated', knEvent);

    if (resultingDiagnosis) {
      const diagEvent: DiagnosisUpdatedEventData = {
        diagnosis: resultingDiagnosis,
      };
      this.eventBus.publish(sessionId, 'diagnosis.updated', diagEvent);
    }

    return Object.assign(updatedState, {
      evidence,
      diagnosis: resultingDiagnosis,
    });
  }

  searchKnowledge(query: string, limit: number = 5): KnowledgeSearchResultItem[] {
    return this.searchService.knowledgeSearch(query, limit);
  }

  readArtifact(knowledgeNodeId: string): KnowledgeArtifact | null {
    return this.searchService.artifactRead(knowledgeNodeId);
  }

  sourceSearch(query: string, limit: number = 5): Array<{ chunkId: string; documentTitle: string; heading?: string; snippet: string }> {
    return this.searchService.sourceSearch(query, limit);
  }

  sourceRead(chunkId: string): SourceChunk | null {
    return this.searchService.sourceRead(chunkId);
  }

  getNeighbors(knowledgeNodeId: string, direction?: 'prerequisites' | 'successors' | 'all'): NeighborResult[] {
    return this.searchService.graphNeighbors(knowledgeNodeId, direction ?? 'all');
  }
}
