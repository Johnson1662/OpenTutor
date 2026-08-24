export type LearningPathNodeType = 'main' | 'prerequisite' | 'detour';
export type LearningPathNodeStatus = 'upcoming' | 'current' | 'completed' | 'skipped';

export interface LearningPathNode {
  id: string;
  knowledgeNodeId: string;
  title: string;
  type: LearningPathNodeType;
  status: LearningPathNodeStatus;
  position: number;
  note?: string;
  diagnosisId?: string;
}

export type LearningSessionFrameStatus = 'active' | 'completed' | 'cancelled';

export interface LearningSessionFrame {
  id: string;
  sessionId: string;
  detourPathNodeId: string;
  parentPathNodeId: string;
  savedLessonId?: string;
  depth: number;
  status: LearningSessionFrameStatus;
  diagnosisId?: string;
  createdAt: string;
}

export type LearningPathPatch =
  | { op: 'insert_node'; node: LearningPathNode; before?: string; after?: string }
  | { op: 'update_node'; nodeId: string; changes: Partial<LearningPathNode> }
  | { op: 'remove_node'; nodeId: string };
