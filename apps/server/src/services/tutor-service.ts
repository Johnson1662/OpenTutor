import type {
  AgentCompletedEventData,
  AgentStartedEventData,
  LearningPathPatch,
  LessonPatch,
  TutorAction,
} from '@opentutor/protocol';
import type { LessonService } from './lesson-service.ts';
import type { SessionService } from './session-service.ts';
import type { EventBus } from '../events/event-bus.ts';
import { randomUUID } from 'node:crypto';

export class TutorService {
  private readonly lessonService: LessonService;
  private readonly sessionService: SessionService;
  private readonly eventBus: EventBus;

  constructor(lessonService: LessonService, sessionService: SessionService, eventBus: EventBus) {
    this.lessonService = lessonService;
    this.sessionService = sessionService;
    this.eventBus = eventBus;
  }

  async runAction(sessionId: string, action: TutorAction): Promise<{ requestId: string; message: string }> {
    const requestId = `req-${randomUUID()}`;
    const startData: AgentStartedEventData = {
      requestId,
      action,
    };
    this.eventBus.publish(sessionId, 'agent.started', startData);

    const snapshot = this.sessionService.getSnapshot(sessionId);
    if (!snapshot) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const { lesson, path, pathVersion } = snapshot;

    let responseMessage = '';

    switch (action) {
      case 'simpler': {
        const patch: LessonPatch = {
          op: 'insert',
          position: { after: 'intro' },
          block: {
            id: `simple-${Date.now()}`,
            type: 'text',
            variant: 'callout',
            content: 'Intuition: Think of self-attention as a soft lookup dictionary where every word asks every other word: "How relevant are you to my meaning?"',
          },
        };
        this.lessonService.applyPatches(sessionId, lesson.id, lesson.version, [patch]);
        responseMessage = 'Simplified the explanation with an intuitive soft lookup analogy.';
        break;
      }
      case 'show_code': {
        const patch: LessonPatch = {
          op: 'insert',
          position: { after: 'definition' },
          block: {
            id: `code-${Date.now()}`,
            type: 'code',
            language: 'python',
            code: `import torch\nimport torch.nn.functional as F\n\ndef scaled_dot_product_attention(Q, K, V, mask=None):\n    d_k = Q.size(-1)\n    scores = torch.matmul(Q, K.transpose(-2, -1)) / (d_k ** 0.5)\n    if mask is not None:\n        scores = scores.masked_fill(mask == 0, -1e9)\n    weights = F.softmax(scores, dim=-1)\n    return torch.matmul(weights, V), weights`,
            explanation: 'Standard PyTorch implementation of Scaled Dot-Product Attention.',
          },
        };
        this.lessonService.applyPatches(sessionId, lesson.id, lesson.version, [patch]);
        responseMessage = 'Injected a working PyTorch code implementation into the lesson canvas.';
        break;
      }
      case 'visualize': {
        const patch: LessonPatch = {
          op: 'insert',
          position: { after: 'definition' },
          block: {
            id: `diagram-${Date.now()}`,
            type: 'diagram',
            diagramType: 'flow',
            nodes: [
              { id: 'q', label: 'Query (Q)' },
              { id: 'k', label: 'Key (K)' },
              { id: 'dot', label: 'Q · K^T / sqrt(d_k)' },
              { id: 'sm', label: 'Softmax' },
              { id: 'v', label: 'Value (V)' },
              { id: 'out', label: 'Attention Output' },
            ],
            edges: [
              { from: 'q', to: 'dot' },
              { from: 'k', to: 'dot' },
              { from: 'dot', to: 'sm' },
              { from: 'sm', to: 'out' },
              { from: 'v', to: 'out' },
            ],
          },
        };
        this.lessonService.applyPatches(sessionId, lesson.id, lesson.version, [patch]);
        responseMessage = 'Added an interactive computation flow diagram to the lesson.';
        break;
      }
      case 'softmax_unknown': {
        const currentActive = path.find((n) => n.status === 'current');
        const afterId = currentActive?.id ?? path[0]?.id;

        const pathPatch: LearningPathPatch = {
          op: 'insert_node',
          after: afterId,
          node: {
            id: `detour-softmax-${Date.now()}`,
            knowledgeNodeId: 'softmax',
            title: 'Detour: Softmax Mechanics',
            type: 'detour',
            position: (currentActive?.position ?? 1) + 1,
            status: 'current',
            note: 'Prerequisite gap detected from learner query',
          },
        };

        this.sessionService.applyPathPatches(sessionId, pathVersion, [pathPatch]);

        const lessonPatch: LessonPatch = {
          op: 'insert',
          position: { index: 0 },
          block: {
            id: `detour-callout-${Date.now()}`,
            type: 'text',
            variant: 'callout',
            content: '📌 Quick Detour: Before proceeding with Attention weights, let us review Softmax normalization.',
          },
        };

        const refreshed = this.lessonService.getLesson(lesson.id);
        if (refreshed) {
          this.lessonService.applyPatches(sessionId, lesson.id, refreshed.version, [lessonPatch]);
        }

        responseMessage = 'Identified prerequisite gap: inserted Softmax detour into your learning path.';
        break;
      }
    }

    const completeData: AgentCompletedEventData = {
      requestId,
      message: responseMessage,
    };
    this.eventBus.publish(sessionId, 'agent.completed', completeData);

    return { requestId, message: responseMessage };
  }
}
