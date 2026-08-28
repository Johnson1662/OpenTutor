import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelLessonGenerator } from '../src/generator/model-lesson-generator.ts';
import type { ModelExecutionService } from '@opentutor/model-runtime';
import type { GenerateLessonInput } from '../src/generator/lesson-generator-types.ts';
import type { KnowledgeArtifact } from '@opentutor/knowledge-core';

const quiz = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: 'quiz',
  question: `Question ${id}`,
  options: [
    { id: 'a', text: 'Correct' },
    { id: 'b', text: 'Wrong' },
  ],
  answerSpec: { type: 'single_choice', correctOptionId: 'a' },
  difficulty: 'medium',
  assessmentKind: 'lesson_quiz',
  targetKnowledgeNodeId: 'node-1',
  ...overrides,
});

const text = (id: string) => ({ id, type: 'text', variant: 'paragraph', content: `Body ${id}` });

const input: GenerateLessonInput = {
  courseId: 'course-1',
  knowledgeNodeId: 'node-1',
  artifact: {
    title: 'Topic',
    definition: { text: 'Definition' },
    intuition: { text: 'Intuition' },
    mechanism: { text: 'Mechanism' },
    examples: [],
    aliases: [],
  } as unknown as KnowledgeArtifact,
};

function generatorReturning(blocks: unknown[]): ModelLessonGenerator {
  const execution = {
    completeStructured: async () => ({ title: 'Topic', objective: 'Understand', blocks }),
  } as unknown as ModelExecutionService;
  return new ModelLessonGenerator(execution);
}

test('ModelLessonGenerator enforces generated lesson assessment shape', async (t) => {
  await t.test('valid three-quiz output passes', async () => {
    const lesson = await generatorReturning([
      text('t1'),
      quiz('q1'),
      text('t2'),
      quiz('q2'),
      text('t3'),
      quiz('q3'),
    ]).generate(input);
    assert.equal(lesson.knowledgeNodeId, 'node-1');
    assert.equal(lesson.blocks.filter((b) => b.type === 'quiz').length, 3);
  });

  await t.test('two quizzes fails', async () => {
    await assert.rejects(
      generatorReturning([text('t1'), quiz('q1'), text('t2'), quiz('q2'), text('t3')]).generate(input),
      /exactly 3 QuizBlocks, got 2/
    );
  });

  await t.test('consecutive quizzes fails', async () => {
    await assert.rejects(
      generatorReturning([text('t1'), quiz('q1'), quiz('q2'), text('t2'), text('t3'), quiz('q3')]).generate(input),
      /must not be consecutive/
    );
  });

  await t.test('final block not quiz fails', async () => {
    await assert.rejects(
      generatorReturning([text('t1'), quiz('q1'), text('t2'), quiz('q2'), quiz('q3'), text('t4')]).generate(input),
      /final block must be a quiz/
    );
  });

  await t.test('wrong targetKnowledgeNodeId fails', async () => {
    await assert.rejects(
      generatorReturning([
        text('t1'),
        quiz('q1', { targetKnowledgeNodeId: 'other-node' }),
        text('t2'),
        quiz('q2'),
        text('t3'),
        quiz('q3'),
      ]).generate(input),
      /targetKnowledgeNodeId must be 'node-1'/
    );
  });
});
