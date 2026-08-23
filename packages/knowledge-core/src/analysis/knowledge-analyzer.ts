import type { SourceChunk } from '../source/markdown-parser.ts';
import type { KnowledgeCandidate, ClaimCandidate, RelationCandidate } from './knowledge-candidate-schema.ts';

export type { KnowledgeCandidate, ClaimCandidate, RelationCandidate };

export interface KnowledgeAnalyzer {
  analyzeChunks(chunks: SourceChunk[]): Promise<KnowledgeCandidate[]>;
}
