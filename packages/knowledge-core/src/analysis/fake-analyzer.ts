import type { SourceChunk } from '../source/markdown-parser.ts';
import type { KnowledgeAnalyzer, KnowledgeCandidate } from './knowledge-analyzer.ts';

export class FakeKnowledgeAnalyzer implements KnowledgeAnalyzer {
  async analyzeChunks(chunks: SourceChunk[]): Promise<KnowledgeCandidate[]> {
    const candidates: KnowledgeCandidate[] = [];

    for (const chunk of chunks) {
      const heading = chunk.heading ?? 'General Concept';
      const sentences = chunk.content
        .split(/[.!?\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 5);

      const claims = sentences.map((sentence) => ({
        statement: sentence,
        evidenceChunkIds: [chunk.id],
      }));

      const relations: KnowledgeCandidate['relations'] = [];
      const lower = chunk.content.toLowerCase();
      if (lower.includes('softmax') && !heading.toLowerCase().includes('softmax')) {
        relations.push({ targetName: 'Softmax Function', relation: 'prerequisite' });
      }
      if (lower.includes('embedding') && !heading.toLowerCase().includes('embedding')) {
        relations.push({ targetName: 'Embedding', relation: 'prerequisite' });
      }

      candidates.push({
        canonicalName: heading,
        aliases: [heading.toLowerCase(), heading.replace(/\s+/g, '-').toLowerCase()],
        definition: sentences[0],
        claims,
        relations,
      });
    }

    return candidates;
  }
}
