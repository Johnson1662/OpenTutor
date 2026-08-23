import type { SourceChunk } from '../source/markdown-parser.ts';

export interface ClaimCandidate {
  statement: string;
  sourceChunkIds: string[];
}

export interface RelationCandidate {
  targetName: string;
  type: 'prerequisite' | 'related' | 'part_of';
}

export interface KnowledgeCandidate {
  canonicalName: string;
  aliases: string[];
  definition?: string;
  claims: ClaimCandidate[];
  relations: RelationCandidate[];
}

export interface KnowledgeAnalyzer {
  analyzeChunks(chunks: SourceChunk[]): Promise<KnowledgeCandidate[]>;
}
