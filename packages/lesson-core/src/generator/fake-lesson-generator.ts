import type { Lesson, LessonBlock, QuizBlock } from '@opentutor/protocol';
import type { GenerateLessonInput, LessonGenerator } from './lesson-generator-types.ts';

function asLessonQuiz(block: QuizBlock, nodeId: string): QuizBlock {
  return { ...block, difficulty: 'medium', assessmentKind: 'lesson_quiz', targetKnowledgeNodeId: nodeId };
}

export class FakeLessonGenerator implements LessonGenerator {
  async generate(input: GenerateLessonInput): Promise<Lesson> {
    const art = input.artifact;
    const isSoftmax = input.knowledgeNodeId.includes('softmax');
    const langZh = input.language === 'zh';
    const nodeId = input.knowledgeNodeId;

    // Three independent assessment opportunities distributed through the lesson:
    // early comprehension, middle mechanism/application, final transfer.
    const earlyQuiz: QuizBlock = isSoftmax
      ? {
        id: 'softmax-quiz',
        type: 'quiz',
        question: 'What does softmax ensure regarding the sum of output values?',
        answerSpec: {
          type: 'open',
          rubric: {
            concepts: ['probability', 'sum', '1', 'softmax', 'positive', 'distribution'],
            referenceAnswer: 'Softmax ensures that all output probabilities are non-negative and sum to exactly 1.',
          },
        },
      }
      : {
        id: `${nodeId}-quiz-1`,
        type: 'quiz',
        question: `Which statement best describes the core idea of ${art.title}?`,
        options: [
          { id: 'opt-1', text: 'It transforms inputs while preserving their structure and relations.' },
          { id: 'opt-2', text: 'It applies random operations unrelated to the input.' },
          { id: 'opt-3', text: 'It only works on fixed-size data.' },
        ],
        answerSpec: { type: 'single_choice', correctOptionId: 'opt-1' },
      };

    const middleQuiz: QuizBlock = isSoftmax
      ? {
        id: 'softmax-quiz-2',
        type: 'quiz',
        question: 'Why does softmax use exponentiation?',
        options: [
          { id: 'opt-exp-1', text: 'To ensure all output values are strictly positive before normalization' },
          { id: 'opt-exp-2', text: 'To reduce memory consumption' },
        ],
        answerSpec: { type: 'single_choice', correctOptionId: 'opt-exp-1' },
      }
      : {
        id: `${nodeId}-quiz-2`,
        type: 'quiz',
        question: `Which statement about the mechanism of ${art.title} is correct?`,
        options: [
          { id: 'opt-1', text: 'It recombines information from the input in a structured way.' },
          { id: 'opt-2', text: 'It processes each input in complete isolation.' },
          { id: 'opt-3', text: 'It discards input information after use.' },
        ],
        answerSpec: { type: 'single_choice', correctOptionId: 'opt-1' },
      };

    const finalQuiz: QuizBlock = isSoftmax
      ? {
        id: 'softmax-quiz-3',
        type: 'quiz',
        question: 'What is the sum of all elements in a softmax output vector?',
        options: [
          { id: 'opt-sum-1', text: 'Exactly 1.0' },
          { id: 'opt-sum-0', text: '0.0' },
        ],
        answerSpec: { type: 'single_choice', correctOptionId: 'opt-sum-1' },
      }
      : {
        id: `${nodeId}-quiz`,
        type: 'quiz',
        question: `Which statement about the role of ${art.title} is correct?`,
        options: [
          { id: 'opt-1', text: 'It allows dynamic contextual weighting across the sequence.' },
          { id: 'opt-2', text: 'It reduces all embeddings to zero.' },
        ],
        answerSpec: { type: 'single_choice', correctOptionId: 'opt-1' },
      };

    const blocks: LessonBlock[] = [
      {
        id: `${nodeId}-def`,
        type: 'text',
        variant: 'definition',
        content: art.definition.text,
      },
      asLessonQuiz(earlyQuiz, nodeId),
      {
        id: `${nodeId}-intuition`,
        type: 'text',
        variant: 'paragraph',
        content: art.intuition.text,
      },
      asLessonQuiz(middleQuiz, nodeId),
      {
        id: `${nodeId}-mechanism`,
        type: 'text',
        variant: 'example',
        content: art.mechanism.text,
      },
      {
        id: `${nodeId}-flow`,
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
      asLessonQuiz(finalQuiz, nodeId),
    ];

    return {
      schemaVersion: '1.0',
      id: `lesson-${nodeId}`,
      courseId: input.courseId,
      knowledgeNodeId: nodeId,
      title: langZh ? `${art.title}（中文）` : art.title,
      objective: langZh ? `掌握 ${art.title} 的原理与应用。` : `Master ${art.title} principles and applications.`,
      version: 1,
      blocks,
      status: 'active',
    };
  }
}
