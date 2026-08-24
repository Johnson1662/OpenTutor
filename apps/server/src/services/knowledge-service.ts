import { randomUUID } from 'node:crypto';
import type {
  AssessmentCompletedEventData,
  AssessmentResult,
  KnowledgeUpdatedEventData,
  LearningEvidence,
  UserKnowledgeState,
} from '@opentutor/protocol';
import type { Database, KnowledgeRepository, LearningEvidenceRepository } from '@opentutor/database';
import { BetaMasteryAggregator, type UserKnowledgeStateV2 } from '@opentutor/assessment-core';
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
  private readonly searchService: SearchService;
  private readonly eventBus: EventBus;
  private readonly aggregator: BetaMasteryAggregator;
  private readonly db?: Database;

  constructor(
    knowledgeRepo: KnowledgeRepository,
    searchService: SearchService,
    eventBus: EventBus,
    evidenceRepo?: LearningEvidenceRepository,
    aggregator?: BetaMasteryAggregator,
    db?: Database
  ) {
    this.knowledgeRepo = knowledgeRepo;
    this.evidenceRepo = evidenceRepo;
    this.searchService = searchService;
    this.eventBus = eventBus;
    this.aggregator = aggregator ?? new BetaMasteryAggregator();
    const repoWithDb = knowledgeRepo as unknown as { db?: Database };
    const evidenceRepoWithDb = evidenceRepo as unknown as { db?: Database };
    this.db = db ?? repoWithDb?.db ?? evidenceRepoWithDb?.db;
  }

  getUserKnowledgeState(userId: string, knowledgeNodeId: string): UserKnowledgeState | null {
    return this.knowledgeRepo.getUserKnowledgeState(userId, knowledgeNodeId);
  }

  recordAssessment(
    sessionId: string,
    assessment: AssessmentResult,
    userId: string = 'default-user',
    options?: {
      difficulty?: number | 'easy' | 'medium' | 'hard';
      confidence?: number;
      sourceItemId?: string;
    }
  ): UserKnowledgeStateV2 {
    const now = new Date().toISOString();
    const rawDifficulty = options?.difficulty ?? 1.0;
    const diffWeight = this.aggregator.computeDifficultyWeight(rawDifficulty);
    const confidence = options?.confidence ?? (typeof assessment.confidence === 'number' ? assessment.confidence : 1.0);
    const weight = diffWeight * confidence;
    const numericDifficulty = typeof rawDifficulty === 'number' ? rawDifficulty : diffWeight;

    const previousAttempts = this.evidenceRepo?.countItemAttempts?.(userId, assessment.knowledgeNodeId, options?.sourceItemId ?? '') ?? 0;
    const attempt = previousAttempts + 1;

    const evidence: LearningEvidence = {
      id: `ev-${randomUUID()}`,
      userId,
      knowledgeNodeId: assessment.knowledgeNodeId,
      type: 'quiz',
      source: assessment.lessonId || 'assessment',
      sourceItemId: options?.sourceItemId,
      attempt,
      outcome: assessment.result,
      difficulty: numericDifficulty,
      confidence,
      weight,
      assessmentId: assessment.id,
      sessionId,
      createdAt: now,
    };

    const currentState = this.knowledgeRepo.getUserKnowledgeState(userId, assessment.knowledgeNodeId);
    const updatedState = this.aggregator.updateMastery(currentState, evidence, now);

    if (this.db) {
      const recordTx = this.db.transaction(() => {
        if (this.evidenceRepo) {
          this.evidenceRepo.recordEvidence(evidence);
        }
        this.knowledgeRepo.setUserKnowledgeState(userId, updatedState);
        this.knowledgeRepo.recordAssessment(assessment, userId);
      });
      recordTx();
    } else {
      if (this.evidenceRepo) {
        this.evidenceRepo.recordEvidence(evidence);
      }
      this.knowledgeRepo.setUserKnowledgeState(userId, updatedState);
      this.knowledgeRepo.recordAssessment(assessment, userId);
    }

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

    return updatedState;
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
