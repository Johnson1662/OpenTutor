import type { SessionService } from './session-service.ts';
import type { EventBus } from '../events/event-bus.ts';

export class LearningProgressService {
  private readonly sessionService: SessionService;
  private readonly eventBus: EventBus;

  constructor(sessionService: SessionService, eventBus: EventBus) {
    this.sessionService = sessionService;
    this.eventBus = eventBus;
  }

  onKnowledgeStateUpdated(
    sessionId: string,
    knowledgeNodeId: string,
    status: 'unknown' | 'learning' | 'weak' | 'mastered',
    confidence: number
  ): void {
    const snapshot = this.sessionService.getSnapshot(sessionId);
    if (!snapshot) return;

    const currentNode = snapshot.path.find((n) => n.status === 'current');
    if (!currentNode) return;

    // Check if the current node matches or if a detour has satisfied diagnostic check
    const isMatchingNode = currentNode.knowledgeNodeId === knowledgeNodeId;
    const isSatisfied =
      status === 'mastered' ||
      confidence >= 0.8 ||
      (currentNode.type === 'detour' && confidence >= 0.25);

    if (isMatchingNode && isSatisfied) {
      this.sessionService.completeCurrentNode(sessionId, snapshot.pathVersion);
    }
  }
}
