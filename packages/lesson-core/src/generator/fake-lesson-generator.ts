import type { Lesson, LessonBlock } from '@opentutor/protocol';
import type { GenerateLessonInput, LessonGenerator } from './lesson-generator-types.ts';

export class FakeLessonGenerator implements LessonGenerator {
  async generate(input: GenerateLessonInput): Promise<Lesson> {
    const art = input.artifact;
    const isSoftmax = input.knowledgeNodeId.includes('softmax');
    const langZh = input.language === 'zh';

    const blocks: LessonBlock[] = [
      {
        id: `${input.knowledgeNodeId}-def`,
        type: 'text',
        variant: 'definition',
        content: art.definition.text,
      },
      {
        id: `${input.knowledgeNodeId}-intuition`,
        type: 'text',
        variant: 'paragraph',
        content: art.intuition.text,
      },
      {
        id: `${input.knowledgeNodeId}-mechanism`,
        type: 'text',
        variant: 'example',
        content: art.mechanism.text,
      },
      {
        id: `${input.knowledgeNodeId}-flow`,
        type: 'diagram',
        diagramType: 'flow',
        nodes: [
          { id: 'n1', label: 'Inputs' },
          { id: 'n2', label: art.title },
          { id: 'n3', label: 'Outputs' },
        ],
        edges: [
          { from: 'n1', to: 'n2', label: 'process' },
          { from: 'n2', to: 'n3', label: 'result' },
        ],
      },
      {
        id: isSoftmax ? 'softmax-quiz' : `${input.knowledgeNodeId}-quiz`,
        type: 'quiz',
        difficulty: isSoftmax ? 3.5 : undefined,
        question: isSoftmax
          ? 'What does softmax ensure regarding the sum of output values?'
          : `Why is ${art.title} crucial in modern architectures?`,
        options: isSoftmax
          ? undefined
          : [
            { id: 'opt-1', text: 'It allows dynamic contextual weighting across the sequence.' },
            { id: 'opt-2', text: 'It reduces all embeddings to zero.' },
          ],
        answerSpec: isSoftmax
          ? {
            type: 'open',
            rubric: {
              concepts: ['probability', 'sum', '1', 'softmax', 'positive', 'distribution'],
              referenceAnswer: 'Softmax ensures that all output probabilities are non-negative and sum to exactly 1.',
            },
          }
          : {
            type: 'open',
            rubric: {
              concepts: ['context', 'attention', 'weighting', 'sequence'],
              referenceAnswer: 'It allows dynamic contextual weighting across the sequence.',
            },
          },
      },
      ...(isSoftmax
        ? [
          {
            id: 'softmax-quiz-2',
            type: 'quiz' as const,
            difficulty: 3.5,
            question: 'Why does softmax use exponentiation?',
            options: [
              { id: 'opt-exp-1', text: 'To ensure all output values are strictly positive before normalization' },
              { id: 'opt-exp-2', text: 'To reduce memory consumption' },
            ],
            answerSpec: { type: 'single_choice' as const, correctOptionId: 'opt-exp-1' },
          },
          {
            id: 'softmax-quiz-3',
            type: 'quiz' as const,
            difficulty: 3.5,
            question: 'What is the sum of all elements in a softmax output vector?',
            options: [
              { id: 'opt-sum-1', text: 'Exactly 1.0' },
              { id: 'opt-sum-0', text: '0.0' },
            ],
            answerSpec: { type: 'single_choice' as const, correctOptionId: 'opt-sum-1' },
          },
        ]
        : []),
    ];

    return {
      schemaVersion: '1.0',
      id: `lesson-${input.knowledgeNodeId}`,
      courseId: input.courseId,
      knowledgeNodeId: input.knowledgeNodeId,
      title: langZh ? `${art.title}（中文）` : art.title,
      objective: langZh ? `掌握 ${art.title} 的原理与应用。` : `Master ${art.title} principles and applications.`,
      version: 1,
      blocks,
      status: 'active',
    };
  }
}
