import type { LearningPathNode } from '@opentutor/protocol';
import type { UserKnowledgeState } from '@opentutor/protocol';
import type { CourseGraph } from './course-types.ts';

export class PathPlanner {
  planInitialPath(
    courseGraph: CourseGraph,
    userStates: UserKnowledgeState[] = []
  ): LearningPathNode[] {
    const masteryMap = new Map<string, UserKnowledgeState>();
    for (const state of userStates) {
      masteryMap.set(state.knowledgeNodeId, state);
    }

    const path: LearningPathNode[] = [];
    let hasCurrent = false;
    let position = 1;

    for (const node of courseGraph.nodes) {
      const state = masteryMap.get(node.knowledgeNodeId);
      const isMastered = state?.status === 'mastered' || (state?.confidence ?? 0) >= 0.8;

      let status: LearningPathNode['status'] = 'upcoming';
      if (isMastered) {
        status = 'completed';
      } else if (!hasCurrent) {
        status = 'current';
        hasCurrent = true;
      }

      path.push({
        id: `path-node-${node.knowledgeNodeId}`,
        knowledgeNodeId: node.knowledgeNodeId,
        title: node.title,
        type: 'main',
        status,
        position,
      });
      position++;
    }

    // If all nodes were mastered, set the last node as current for review
    if (!hasCurrent && path.length > 0) {
      path[path.length - 1]!.status = 'current';
    }

    return path;
  }
}
