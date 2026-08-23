import type { ModelExecutionService } from '@opentutor/model-runtime';
import type { Claim } from '../claims/claim-service.ts';
import {
  KnowledgeArtifactSchema,
  type KnowledgeArtifact,
} from './artifact-schema.ts';

export interface ArtifactSynthesizer {
  synthesize(
    nodeId: string,
    title: string,
    claims: Claim[],
    relatedNodeTitles: string[]
  ): Promise<KnowledgeArtifact>;
}

export class ModelArtifactSynthesizer implements ArtifactSynthesizer {
  private readonly executionService: ModelExecutionService;

  constructor(executionService: ModelExecutionService) {
    this.executionService = executionService;
  }

  async synthesize(
    nodeId: string,
    title: string,
    claims: Claim[],
    relatedNodeTitles: string[]
  ): Promise<KnowledgeArtifact> {
    const activeClaims = claims.filter((c) => c.status === 'supported' || c.status === 'conflicting');
    const claimList = activeClaims
      .map((c) => `[Claim ID: ${c.id}] (Status: ${c.status}) ${c.statement}`)
      .join('\n');

    const system = `You are a world-class pedagogical knowledge artifact synthesizer.
Synthesize a comprehensive, authoritative, structured Knowledge Artifact for the concept '${title}' (Node ID: '${nodeId}').
CRITICAL GROUNDING RULES:
1. Every section (definition, intuition, mechanism, formula, examples, misconceptions) MUST list the exact 'claimIds' that support the facts stated.
2. Only reference Claim IDs that are provided in the input. Never invent fake claim IDs.
3. If there are conflicting claims, explicitly note the disagreement in the relevant section.
4. Output must match the KnowledgeArtifact schema exactly.`;

    const prompt = `Synthesize Knowledge Artifact for '${title}' (Node ID: '${nodeId}') using the following verified claims and related concepts:

Verified Claims:
${claimList || 'No claims available.'}

Related Concepts:
${relatedNodeTitles.join(', ') || 'None'}`;

    return await this.executionService.completeStructured<KnowledgeArtifact>({
      role: 'artifact_synthesizer',
      system,
      prompt,
      schema: KnowledgeArtifactSchema,
    });
  }
}

export class FakeArtifactSynthesizer implements ArtifactSynthesizer {
  async synthesize(
    nodeId: string,
    title: string,
    claims: Claim[],
    relatedNodeTitles: string[]
  ): Promise<KnowledgeArtifact> {
    const claimIds = claims.map((c) => c.id);
    const defClaimIds = claimIds.slice(0, 1);
    const mechClaimIds = claimIds.slice(0, 2);

    const definitionText = claims[0]?.statement ?? `${title} is a core foundational concept.`;
    const intuitionText = `Builds mental model for ${title}.`;
    const mechanismText = claims.map((c) => c.statement).join(' ') || `${title} operates systematically.`;

    const formulaSection = title.toLowerCase().includes('softmax')
      ? {
        text: 'softmax(z_i) = exp(z_i) / sum(exp(z_j))',
        claimIds: claimIds.slice(0, 1),
      }
      : title.toLowerCase().includes('attention')
        ? {
          text: 'Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V',
          claimIds: claimIds.slice(0, 1),
        }
        : undefined;

    return {
      nodeId,
      title,
      definition: {
        text: definitionText,
        claimIds: defClaimIds,
      },
      intuition: {
        text: intuitionText,
        claimIds: defClaimIds,
      },
      mechanism: {
        text: mechanismText,
        claimIds: mechClaimIds,
      },
      prerequisites: relatedNodeTitles.filter((r) => r.toLowerCase().includes('embedding') || r.toLowerCase().includes('softmax')),
      formula: formulaSection,
      examples: [
        {
          text: `Practical implementation and usage of ${title}.`,
          claimIds: defClaimIds,
        },
      ],
      misconceptions: [
        {
          text: `Common confusion regarding ${title}.`,
          claimIds: defClaimIds,
        },
      ],
      related: relatedNodeTitles,
    };
  }
}
