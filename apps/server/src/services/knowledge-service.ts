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
}
