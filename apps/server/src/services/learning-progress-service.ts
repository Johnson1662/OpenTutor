import type { UserKnowledgeState } from '@opentutor/protocol';
import type { SessionService } from './session-service.ts';
import type { EventBus } from '../events/event-bus.ts';

export class LearningProgressService {
  private readonly sessionService: SessionService;
  private readonly eventBus: EventBus;

  constructor(sessionService: SessionService, eventBus: EventBus) {
    this.sessionService = sessionService;
    this.eventBus = eventBus;
  }

  onKnowledgeStateUpdated(sessionId: string, state: UserKnowledgeState): void {
    const snapshot = this.sessionService.getSnapshot(sessionId);
    if (!snapshot) return;

    const currentNode = snapshot.path.find((n) => n.status === 'current');
    if (!currentNode) return;

    const isMatchingNode = currentNode.knowledgeNodeId === state.knowledgeNodeId;
    if (!isMatchingNode) return;

    const isDetour = currentNode.type === 'detour';
    const isSatisfied = isDetour
      ? state.status === 'mastered' ||
        ((state.masteryProbability ?? 0) >= 0.85 && (state.evidenceCount ?? 0) >= 2)
      : state.status === 'mastered';

    if (isSatisfied) {
      this.sessionService.completeCurrentNode(sessionId, snapshot.pathVersion);
    }
  }
}
