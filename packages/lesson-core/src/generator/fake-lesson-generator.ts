import type { Lesson, LessonBlock } from '@opentutor/protocol';
import type { GenerateLessonInput, LessonGenerator } from './lesson-generator-types.ts';

export class FakeLessonGenerator implements LessonGenerator {
  async generate(input: GenerateLessonInput): Promise<Lesson> {
    const art = input.artifact;
    const isSoftmax = input.knowledgeNodeId.includes('softmax');

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
        id: `${input.knowledgeNodeId}-quiz`,
        type: 'quiz',
        question: isSoftmax
          ? 'What is the primary property of the Softmax function output?'
          : `Why is ${art.title} crucial in modern architectures?`,
        options: isSoftmax
          ? [
            { id: 'opt-1', text: 'Outputs form a normalized probability distribution summing to 1.' },
            { id: 'opt-2', text: 'Outputs are unconstrained real numbers.' },
          ]
          : [
            { id: 'opt-1', text: 'It allows dynamic contextual weighting across the sequence.' },
            { id: 'opt-2', text: 'It reduces all embeddings to zero.' },
          ],
        answerSpec: isSoftmax
          ? {
            type: 'single_choice',
            correctOptionId: 'opt-1',
          }
          : {
            type: 'open',
            rubric: {
              concepts: ['context', 'attention', 'weighting', 'sequence'],
              referenceAnswer: 'It allows dynamic contextual weighting across the sequence.',
            },
          },
      },
    ];

    return {
      schemaVersion: '1.0',
      id: `lesson-${input.knowledgeNodeId}`,
      courseId: input.courseId,
      knowledgeNodeId: input.knowledgeNodeId,
      title: art.title,
      objective: `Master ${art.title} principles and applications.`,
      version: 1,
      blocks,
      status: 'active',
    };
  }
}
