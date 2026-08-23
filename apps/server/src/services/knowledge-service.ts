import type { AssessmentCompletedEventData, AssessmentResult, KnowledgeUpdatedEventData } from '@opentutor/protocol';
import type { KnowledgeRepository } from '@opentutor/database';
import type { EventBus } from '../events/event-bus.ts';

export class KnowledgeService {
  private readonly knowledgeRepo: KnowledgeRepository;
  private readonly eventBus: EventBus;

  constructor(knowledgeRepo: KnowledgeRepository, eventBus: EventBus) {
    this.knowledgeRepo = knowledgeRepo;
    this.eventBus = eventBus;
  }

  recordAssessment(sessionId: string, assessment: AssessmentResult): void {
    this.knowledgeRepo.recordAssessment(assessment);

    const asmtEvent: AssessmentCompletedEventData = {
      assessment,
    };
    this.eventBus.publish(sessionId, 'assessment.completed', asmtEvent);

    const nextStatus = assessment.result === 'correct' ? 'mastered' : assessment.result === 'partial' ? 'learning' : 'weak';
    const knEvent: KnowledgeUpdatedEventData = {
      knowledgeNodeId: assessment.knowledgeNodeId,
      status: nextStatus,
      confidence: assessment.confidence,
    };
    this.eventBus.publish(sessionId, 'knowledge.updated', knEvent);
  }

  searchKnowledge(query: string, limit: number = 5): Array<{ id: string; title: string; summary: string }> {
    return [
      { id: 'self-attention', title: 'Self Attention', summary: 'Core attention weighting mechanism in sequence modeling' },
      { id: 'softmax', title: 'Softmax Function', summary: 'Exponent normalized probability function' },
    ].slice(0, limit);
  }

  readArtifact(knowledgeNodeId: string): Record<string, unknown> | null {
    return {
      id: knowledgeNodeId,
      definition: `Canonical living knowledge compiled artifact for ${knowledgeNodeId}`,
      intuition: 'Weighted information retrieval across sequence embeddings',
    };
  }

  getNeighbors(knowledgeNodeId: string, _direction?: string): Array<{ nodeId: string; relation: string }> {
    return [
      { nodeId: 'embedding', relation: 'prerequisite' },
      { nodeId: 'softmax', relation: 'prerequisite' },
    ];
  }
}
