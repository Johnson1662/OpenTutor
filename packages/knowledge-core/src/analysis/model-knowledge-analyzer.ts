import type { ModelExecutionService } from '@opentutor/model-runtime';
import type { SourceChunk } from '../source/markdown-parser.ts';
import { AnalysisBatcher } from './analysis-batcher.ts';
import {
  KnowledgeCandidatesResponseSchema,
  type KnowledgeCandidate,
  type KnowledgeCandidatesResponse,
} from './knowledge-candidate-schema.ts';
import type { KnowledgeAnalyzer } from './knowledge-analyzer.ts';

export class ModelKnowledgeAnalyzer implements KnowledgeAnalyzer {
  private readonly executionService: ModelExecutionService;
  private readonly batcher: AnalysisBatcher;

  constructor(executionService: ModelExecutionService, batcher: AnalysisBatcher = new AnalysisBatcher()) {
    this.executionService = executionService;
    this.batcher = batcher;
  }

  async analyzeChunks(chunks: SourceChunk[]): Promise<KnowledgeCandidate[]> {
    if (chunks.length === 0) return [];

    const batches = this.batcher.createBatches(chunks);
    const allCandidates: KnowledgeCandidate[] = [];

    for (const batch of batches) {
      const validChunkIds = new Set(batch.map((c) => c.id));
      const formattedChunks = batch
        .map(
          (c) =>
            `[Chunk ID: ${c.id}]\nHeading: ${c.heading ?? 'None'}\nContent:\n${c.content}\n`
        )
        .join('\n---\n\n');

      const system = `You are an expert pedagogical knowledge compiler.
Extract canonical knowledge concepts, definitions, factual claims, and conceptual relations from the provided source material chunks.
IMPORTANT RULES:
1. Every claim's 'evidenceChunkIds' MUST contain only Chunk IDs that exist in the provided input (e.g. ${Array.from(validChunkIds).slice(0, 3).join(', ')}). Never invent or hallucinate chunk IDs.
2. Canonical names should be clear and descriptive (e.g., 'Self-Attention', 'Softmax Function').
3. Include common aliases for entity resolution.
4. Categorize relations as 'prerequisite', 'part_of', 'related', 'contrast', or 'extension'.`;

      const prompt = `Extract knowledge candidates from the following source material chunks:\n\n${formattedChunks}`;

      const response = await this.executionService.completeStructured<KnowledgeCandidatesResponse>({
        role: 'knowledge_compiler',
        system,
        prompt,
        schema: KnowledgeCandidatesResponseSchema,
      });

      // Filter and validate evidence chunk references against the batch
      for (const candidate of response.candidates) {
        const validatedClaims = candidate.claims
          .map((claim: { statement: string; evidenceChunkIds: string[] }) => ({
            statement: claim.statement.trim(),
            evidenceChunkIds: claim.evidenceChunkIds.filter((id: string) => validChunkIds.has(id)),
          }))
          .filter((claim: { statement: string; evidenceChunkIds: string[] }) => claim.statement.length > 0 && claim.evidenceChunkIds.length > 0);

        // Only include candidate if it has valid claims with grounded evidence
        if (validatedClaims.length > 0) {
          allCandidates.push({
            canonicalName: candidate.canonicalName.trim(),
            aliases: candidate.aliases.map((a: string) => a.trim()).filter((a: string) => a.length > 0),
            definition: candidate.definition?.trim(),
            claims: validatedClaims,
            relations: candidate.relations,
          });
        }
      }
    }

    return allCandidates;
  }
}
