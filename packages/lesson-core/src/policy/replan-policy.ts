import type { LearningPathNode, LearningPathPatch, UserKnowledgeState } from '@opentutor/protocol';

export interface ReplanDecision {
  action: 'none' | 'insert_detour' | 'resume_main' | 'skip_ahead';
  patches: LearningPathPatch[];
  reason?: string;
}

export class ReplanPolicy {
  evaluateAssessment(
    currentPath: LearningPathNode[],
    assessmentKnowledgeNodeId: string,
    resultStatus: UserKnowledgeState['status'],
    confidence: number
  ): ReplanDecision {
    const currentNode = currentPath.find((n) => n.status === 'current');
    if (!currentNode) {
      return { action: 'none', patches: [] };
    }

    // 1. If currently on a detour and learner succeeded (not weak and confidence >= 0.25)
    if (currentNode.type === 'detour' && currentNode.knowledgeNodeId === assessmentKnowledgeNodeId) {
      const isSuccess = resultStatus === 'mastered' || confidence >= 0.25;
      if (isSuccess) {
        return {
          action: 'resume_main',
          patches: [
            {
              op: 'update_node',
              nodeId: currentNode.id,
              changes: { status: 'completed' },
            },
          ],
          reason: 'Detour mastery requirement satisfied. Resuming main learning path.',
        };
      }
    }

    // 2. If learner showed a severe gap on current core node and needs a detour
    if (currentNode.type === 'main' && resultStatus === 'weak' && confidence < 0.2) {
      // Diagnostic check triggered
      return {
        action: 'none',
        patches: [],
        reason: 'Concept weakness detected. Tutor can suggest a targeted diagnostic detour.',
      };
    }

    return {
      action: 'none',
      patches: [],
    };
  }
}
