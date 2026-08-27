import { Type, type Static } from 'typebox';
import type { ModelExecutionService } from '@opentutor/model-runtime';
import type { Lesson } from '@opentutor/protocol';
import type { GenerateLessonInput, LessonGenerator } from './lesson-generator-types.ts';
import { LessonValidator } from '../validation/lesson-validator.ts';

const TextBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('text'),
  variant: Type.Union([
    Type.Literal('paragraph'),
    Type.Literal('definition'),
    Type.Literal('example'),
    Type.Literal('callout'),
    Type.Literal('summary'),
  ]),
  content: Type.String(),
});

const CodeBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('code'),
  language: Type.String(),
  code: Type.String(),
  explanation: Type.Optional(Type.String()),
});

const DiagramBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('diagram'),
  diagramType: Type.Union([
    Type.Literal('flow'),
    Type.Literal('relationship'),
    Type.Literal('sequence'),
  ]),
  nodes: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
  edges: Type.Array(Type.Object({ from: Type.String(), to: Type.String(), label: Type.Optional(Type.String()) })),
});

const QuizOptionSchema = Type.Object({
  id: Type.String(),
  text: Type.String(),
});

const QuizBlockSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal('quiz'),
  question: Type.String(),
  options: Type.Optional(Type.Array(QuizOptionSchema)),
  answerSpec: Type.Union([
    Type.Object({
      type: Type.Literal('single_choice'),
      correctOptionId: Type.String(),
    }),
    Type.Object({
      type: Type.Literal('multiple_choice'),
      correctOptionIds: Type.Array(Type.String()),
    }),
    Type.Object({
      type: Type.Literal('open'),
      rubric: Type.Object({
        concepts: Type.Array(Type.String()),
        referenceAnswer: Type.Optional(Type.String()),
      }),
    }),
  ]),
});

const LessonBlockSchema = Type.Union([
  TextBlockSchema,
  CodeBlockSchema,
  DiagramBlockSchema,
  QuizBlockSchema,
]);

export const GeneratedLessonSchema = Type.Object({
  title: Type.String(),
  objective: Type.String(),
  blocks: Type.Array(LessonBlockSchema, { minItems: 5, maxItems: 8 }),
});

export type GeneratedLessonData = Static<typeof GeneratedLessonSchema>;

export class ModelLessonGenerator implements LessonGenerator {
  private readonly executionService: ModelExecutionService;
  private readonly validator: LessonValidator;

  constructor(
    executionService: ModelExecutionService,
    validator: LessonValidator = new LessonValidator()
  ) {
    this.executionService = executionService;
    this.validator = validator;
  }

  async generate(input: GenerateLessonInput): Promise<Lesson> {
    const art = input.artifact;
    const system = `You are a world-class pedagogical tutor and lesson generator.
Generate a structured, engaging, interactive Lesson for '${art.title}' (Node: '${input.knowledgeNodeId}').
CRITICAL PEDAGOGICAL INVARIANTS:
1. Ground the lesson strictly in the verified Knowledge Artifact.
2. Generate exactly 5–8 short blocks. Keep each block focused on one small idea.
3. Use a cohesive Canvas-first sequence of TextBlocks, CodeBlocks, DiagramBlocks, and a culminating inline QuizBlock.
4. Every QuizBlock MUST include a full 'answerSpec' ('single_choice', 'multiple_choice', or 'open' with rubric concepts).
5. For open questions, the rubric MUST make a concise self-report probe possible before diagnosing mastery.
6. Do NOT output arbitrary HTML or JavaScript.`;

    const prompt = `Generate a Lesson for '${art.title}' using the following Knowledge Artifact:

Definition: ${art.definition.text}
Intuition: ${art.intuition.text}
Mechanism: ${art.mechanism.text}
${art.formula ? `Formula: ${art.formula.text}` : ''}
Examples: ${(art.examples || []).map((e) => e.text).join(' ')}

Target Audience Level: ${input.userState?.status ?? 'beginner'}
Teaching Strategy: ${input.strategy ?? 'intro'}
Course ID: ${input.courseId}`;

    const response = await this.executionService.completeStructured<GeneratedLessonData>({
      role: 'lesson_generator',
      system,
      prompt,
      schema: GeneratedLessonSchema,
    });

    const lesson: Lesson = {
      schemaVersion: '1.0',
      id: `lesson-${input.knowledgeNodeId}`,
      courseId: input.courseId,
      knowledgeNodeId: input.knowledgeNodeId,
      title: response.title || art.title,
      objective: response.objective || `Understand and apply ${art.title}`,
      version: 1,
      blocks: response.blocks as any,
      status: 'active',
    };

    const validation = this.validator.validate(lesson);
    if (!validation.valid) {
      throw new Error(`Generated lesson failed validation: ${validation.errors.join('; ')}`);
    }

    return lesson;
  }
}
