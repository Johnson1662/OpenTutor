import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import type { QuizBlock } from '@opentutor/protocol';
export interface ModelExecutionServiceLike {
  completeStructured<T>(input: {
    role: any;
    prompt: string;
    system?: string;
    schema?: any;
  }): Promise<T>;
}

export const GeneratedProbeOptionSchema = Type.Object({
  id: Type.String(),
  text: Type.String(),
});

export const GeneratedProbeSchema = Type.Object({
  question: Type.String(),
  options: Type.Array(GeneratedProbeOptionSchema, { minItems: 2 }),
  correctOptionId: Type.String(),
});

export type GeneratedProbeData = Static<typeof GeneratedProbeSchema>;
export interface GenerateProbeInput {
  targetKnowledgeNodeId: string;
  candidateMisconceptionIds?: string[];
  probeType?: 'recall' | 'concept' | 'application' | 'misconception';
  difficulty?: number | 'easy' | 'medium' | 'hard';
  nodeTitle?: string;
  nodeDescription?: string;
  context?: string;
  misconceptions?: Array<{ id: string; title?: string; description?: string }>;
}

export interface ProbeGenerator {
  generate(input: GenerateProbeInput): Promise<QuizBlock>;
}

export class ModelProbeGenerator implements ProbeGenerator {
  private readonly executionService?: ModelExecutionServiceLike;

  constructor(executionService?: ModelExecutionServiceLike) {
    this.executionService = executionService;
  }

  async generate(input: GenerateProbeInput): Promise<QuizBlock> {
    if (this.executionService) {
      try {
        return await this.generateWithModel(input);
      } catch {
        // Fall back gracefully to deterministic probe generator on execution error
        return this.generateDeterministic(input);
      }
    }
    return this.generateDeterministic(input);
  }

  async generateProbe(input: GenerateProbeInput): Promise<QuizBlock> {
    return this.generate(input);
  }

  generateDeterministic(input: GenerateProbeInput): QuizBlock {
    const title = input.nodeTitle || input.targetKnowledgeNodeId.replace(/[-_]/g, ' ');
    const probeId = `probe-${input.targetKnowledgeNodeId}-${randomUUID().slice(0, 8)}`;
    const difficulty = input.difficulty ?? 'medium';
    const candidateMisconceptionIds = input.candidateMisconceptionIds && input.candidateMisconceptionIds.length > 0
      ? [...input.candidateMisconceptionIds]
      : undefined;

    let question: string;
    let options: Array<{ id: string; text: string }>;
    const correctOptionId = 'opt-1';

    if (candidateMisconceptionIds && candidateMisconceptionIds.length > 0) {
      const miscId = candidateMisconceptionIds[0];
      const miscDesc = input.misconceptions?.find((m) => m.id === miscId)?.description;
      question = `Which statement accurately describes the core mechanism of ${title} and distinguishes it from common misconceptions?`;
      options = [
        {
          id: 'opt-1',
          text: `It adheres strictly to the canonical definition and mathematical/logical constraints of ${title}.`,
        },
        {
          id: 'opt-2',
          text: miscDesc
            ? `It assumes that ${miscDesc}.`
            : `It presumes that ${miscId} applies unconditionally in all contexts.`,
        },
        {
          id: 'opt-3',
          text: `It treats ${title} as an unconstrained operation without invariant requirements.`,
        },
        {
          id: 'opt-4',
          text: `It conflates ${title} with an unrelated downstream mechanism.`,
        },
      ];
    } else if (input.probeType === 'recall') {
      question = `What is the foundational definition and primary role of ${title}?`;
      options = [
        {
          id: 'opt-1',
          text: `The canonical principle and fundamental role defining ${title}.`,
        },
        {
          id: 'opt-2',
          text: `An inaccurate description omitting critical prerequisite requirements of ${title}.`,
        },
        {
          id: 'opt-3',
          text: `A superficial interpretation confusing ${title} with a separate concept.`,
        },
        {
          id: 'opt-4',
          text: `The exact inverse of the actual operation performed by ${title}.`,
        },
      ];
    } else if (input.probeType === 'application') {
      question = `In which scenario is ${title} correctly and appropriately applied?`;
      options = [
        {
          id: 'opt-1',
          text: `When meeting all structural and functional prerequisites demanded by ${title}.`,
        },
        {
          id: 'opt-2',
          text: `When input invariants are violated and expected guarantees cannot hold.`,
        },
        {
          id: 'opt-3',
          text: `As a generic substitute for completely unrelated computational steps.`,
        },
        {
          id: 'opt-4',
          text: `Only when suppressing errors in downstream dependencies.`,
        },
      ];
    } else {
      question = `Which of the following statements about ${title} is correct?`;
      options = [
        {
          id: 'opt-1',
          text: `It correctly specifies the key conceptual invariants and properties of ${title}.`,
        },
        {
          id: 'opt-2',
          text: `It mischaracterizes how ${title} functions within the dependency hierarchy.`,
        },
        {
          id: 'opt-3',
          text: `It assumes ${title} produces outcomes contrary to its specification.`,
        },
        {
          id: 'opt-4',
          text: `It improperly collapses distinct stages of ${title} into a single step.`,
        },
      ];
    }

    return {
      id: probeId,
      type: 'quiz',
      assessmentKind: 'probe',
      targetKnowledgeNodeId: input.targetKnowledgeNodeId,
      candidateMisconceptionIds,
      question,
      answerType: 'single_choice',
      options,
      answerSpec: {
        type: 'single_choice',
        correctOptionId,
      },
      difficulty,
    };
  }

  private async generateWithModel(input: GenerateProbeInput): Promise<QuizBlock> {
    if (!this.executionService) {
      return this.generateDeterministic(input);
    }

    const title = input.nodeTitle || input.targetKnowledgeNodeId;
    const system = `You are a diagnostic assessment expert for an adaptive intelligent tutoring system.
Generate a targeted diagnostic probe quiz item (single choice) for the prerequisite knowledge node '${input.targetKnowledgeNodeId}' (${title}).
The question must precisely evaluate the learner's understanding and identify any misconceptions.`;

    const prompt = `Generate a single-choice diagnostic probe for:
Knowledge Node: ${input.targetKnowledgeNodeId} (${title})
${input.nodeDescription ? `Description: ${input.nodeDescription}` : ''}
Probe Type: ${input.probeType ?? 'concept'}
${input.candidateMisconceptionIds ? `Candidate Misconceptions: ${input.candidateMisconceptionIds.join(', ')}` : ''}
Difficulty: ${input.difficulty ?? 'medium'}

Return a JSON object with:
- question: clear, precise question
- options: array of { id: string, text: string } (at least 2 options, exactly 1 correct)
- correctOptionId: the ID of the correct option`;

    // Structured completion with TypeBox schema
    const response = await this.executionService.completeStructured<GeneratedProbeData>({
      role: 'lesson_generator',
      system,
      prompt,
      schema: GeneratedProbeSchema,
    });

    if (
      !response ||
      typeof response.question !== 'string' ||
      !Array.isArray(response.options) ||
      response.options.length < 2 ||
      !response.correctOptionId
    ) {
      return this.generateDeterministic(input);
    }

    const probeId = `probe-${input.targetKnowledgeNodeId}-${randomUUID().slice(0, 8)}`;
    const difficulty = input.difficulty ?? 'medium';
    const candidateMisconceptionIds = input.candidateMisconceptionIds && input.candidateMisconceptionIds.length > 0
      ? [...input.candidateMisconceptionIds]
      : undefined;

    return {
      id: probeId,
      type: 'quiz',
      assessmentKind: 'probe',
      targetKnowledgeNodeId: input.targetKnowledgeNodeId,
      candidateMisconceptionIds,
      question: response.question,
      answerType: 'single_choice',
      options: response.options,
      answerSpec: {
        type: 'single_choice',
        correctOptionId: response.correctOptionId,
      },
      difficulty,
    };
  }
}
