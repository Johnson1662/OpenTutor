export type KnowledgeStatus = 'unknown' | 'learning' | 'weak' | 'mastered';

export interface UserKnowledgeState {
  knowledgeNodeId: string;
  status: KnowledgeStatus;
  confidence: number;
}
