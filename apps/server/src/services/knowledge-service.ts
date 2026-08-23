import { randomUUID } from 'node:crypto';
import type {
  AssessmentCompletedEventData,
  AssessmentResult,
  KnowledgeUpdatedEventData,
  LearningEvidence,
  UserKnowledgeState,
} from '@opentutor/protocol';
import type { KnowledgeRepository, LearningEvidenceRepository } from '@opentutor/database';
import { BetaMasteryAggregator } from '@opentutor/assessment-core';
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

  constructor(
    knowledgeRepo: KnowledgeRepository,
    searchService: SearchService,
    eventBus: EventBus,
    evidenceRepo?: LearningEvidenceRepository,
    aggregator?: BetaMasteryAggregator
  ) {
    this.knowledgeRepo = knowledgeRepo;
    this.evidenceRepo = evidenceRepo;
    this.searchService = searchService;
    this.eventBus = eventBus;
    this.aggregator = aggregator ?? new BetaMasteryAggregator();
  }

  getUserKnowledgeState(userId: string, knowledgeNodeId: string): UserKnowledgeState | null {
    return this.knowledgeRepo.getUserKnowledgeState(userId, knowledgeNodeId);
  }

  recordAssessment(sessionId: string, assessment: AssessmentResult, userId: string = 'default-user'): void {
    const now = new Date().toISOString();
    const diffWeight = this.aggregator.computeDifficultyWeight(1.0);
    const confidence = typeof assessment.confidence === 'number' ? assessment.confidence : 1.0;

    const evidence: LearningEvidence = {
      id: `ev-${randomUUID()}`,
      userId,
      knowledgeNodeId: assessment.knowledgeNodeId,
      type: 'quiz',
      source: assessment.lessonId || 'assessment',
      outcome: assessment.result,
      difficulty: 1.0,
      confidence,
      weight: diffWeight * confidence,
      assessmentId: assessment.id,
      sessionId,
      createdAt: now,
    };

    if (this.evidenceRepo) {
      this.evidenceRepo.recordEvidence(evidence);
    }

    const currentState = this.knowledgeRepo.getUserKnowledgeState(userId, assessment.knowledgeNodeId);
    const updatedState = this.aggregator.updateMastery(currentState, evidence, now);

    this.knowledgeRepo.setUserKnowledgeState(userId, updatedState);
    this.knowledgeRepo.recordAssessment(assessment, userId);

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
