import type { AssessmentCompletedEventData, AssessmentResult, KnowledgeUpdatedEventData, UserKnowledgeState } from '@opentutor/protocol';
import type { KnowledgeRepository } from '@opentutor/database';
import type { SearchService, KnowledgeSearchResultItem, KnowledgeArtifact, NeighborResult, SourceChunk } from '@opentutor/knowledge-core';
import type { EventBus } from '../events/event-bus.ts';

export class KnowledgeService {
  private readonly knowledgeRepo: KnowledgeRepository;
  private readonly searchService: SearchService;
  private readonly eventBus: EventBus;

  constructor(
    knowledgeRepo: KnowledgeRepository,
    searchService: SearchService,
    eventBus: EventBus
  ) {
    this.knowledgeRepo = knowledgeRepo;
    this.searchService = searchService;
    this.eventBus = eventBus;
  }

  getUserKnowledgeState(userId: string, knowledgeNodeId: string): UserKnowledgeState | null {
    return this.knowledgeRepo.getUserKnowledgeState(userId, knowledgeNodeId);
  }

  recordAssessment(sessionId: string, assessment: AssessmentResult): void {
    this.knowledgeRepo.recordAssessment(assessment);

    const asmtEvent: AssessmentCompletedEventData = {
      assessment,
    };
    this.eventBus.publish(sessionId, 'assessment.completed', asmtEvent);

    const nextStatus =
      assessment.confidence >= 0.80
        ? 'mastered'
        : assessment.confidence >= 0.50
          ? 'learning'
          : assessment.confidence >= 0.20
            ? 'weak'
            : 'unknown';

    const knEvent: KnowledgeUpdatedEventData = {
      knowledgeNodeId: assessment.knowledgeNodeId,
      status: nextStatus,
      confidence: assessment.confidence,
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
