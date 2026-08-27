import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from '@opentutor/database';
import {
  ArtifactCompiler,
  ClaimService,
  EvidenceService,
  RelationResolver,
} from '@opentutor/knowledge-core';
import {
  LessonValidator,
  FakeLessonGenerator,
  LearningSessionCoordinator,
} from '../src/index.ts';

test('packages/lesson-core - Dynamic Lesson Core & Lifecycle Coordinator', async (t) => {
  const db = createDatabase(':memory:');
  seedDatabase(db);

  const claims = new ClaimService(db);
  const evidence = new EvidenceService(db);
  const relations = new RelationResolver(db);
  const artifactCompiler = new ArtifactCompiler(db, claims, evidence, relations);

  await t.test('1. LessonValidator enforces valid blocks and mandatory answerSpec', () => {
    const validator = new LessonValidator();

    // Valid lesson
    const validLesson: any = {
      schemaVersion: '1.0',
      id: 'lesson-1',
      courseId: 'course-1',
      knowledgeNodeId: 'self-attention',
      title: 'Self-Attention',
      version: 1,
      status: 'active',
      blocks: [
        { id: 'b1', type: 'text', variant: 'paragraph', content: 'Intro text' },
        {
          id: 'b2',
          type: 'quiz',
          question: 'What is attention?',
          options: [
            { id: 'o1', text: 'Option 1' },
            { id: 'o2', text: 'Option 2' },
          ],
          answerSpec: { type: 'single_choice', correctOptionId: 'o1' },
        },
      ],
    };
    const res1 = validator.validate(validLesson);
    assert.equal(res1.valid, true);

    // Invalid lesson missing answerSpec on quiz
    const invalidLesson: any = {
      ...validLesson,
      blocks: [
        { id: 'b1', type: 'text', variant: 'paragraph', content: 'Intro' },
        { id: 'b2', type: 'quiz', question: 'No spec quiz' },
      ],
    };
    const res2 = validator.validate(invalidLesson);
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some((e) => e.includes('mandatory \'answerSpec\'')));

    // Duplicate block id
    const dupLesson: any = {
      ...validLesson,
      blocks: [
        { id: 'b1', type: 'text', variant: 'paragraph', content: 'Block 1' },
        { id: 'b1', type: 'text', variant: 'paragraph', content: 'Block 2' },
      ],
    };
    const res3 = validator.validate(dupLesson);
    assert.equal(res3.valid, false);
    assert.ok(res3.errors.some((e) => e.includes('Duplicate block id')));
  });

  await t.test('2. FakeLessonGenerator creates complete typed lesson with answerSpec', async () => {
    const generator = new FakeLessonGenerator();
    const compiled = await artifactCompiler.compile('self-attention', 'Self Attention');

    const lesson = await generator.generate({
      courseId: 'transformer',
      knowledgeNodeId: 'self-attention',
      artifact: compiled.content,
    });

    assert.equal(lesson.knowledgeNodeId, 'self-attention');
    assert.ok(lesson.blocks.length >= 3);
    const quizBlock = lesson.blocks.find((b) => b.type === 'quiz') as any;
    assert.ok(quizBlock);
    assert.ok(quizBlock.answerSpec);
  });

  await t.test('3. LearningSessionCoordinator coordinates active lesson, detour and resume restoration', async () => {
    const coordinator = new LearningSessionCoordinator(db, artifactCompiler);

    // 1. Ensure lesson for main node
    const mainLesson = await coordinator.ensureLessonForNode(
      'session-coord-1',
      'transformer',
      'self-attention',
      'Self Attention'
    );
    assert.equal(mainLesson.knowledgeNodeId, 'self-attention');

    // 2. Handle detour to softmax
    const detourResult = await coordinator.handleDetour(
      'session-coord-1',
      'transformer',
      'softmax',
      'Softmax Function',
      'path-node-self-attention',
      mainLesson.id
    );
    assert.equal(detourResult.detourLesson.knowledgeNodeId, 'softmax');
    assert.equal(detourResult.detourPathNode.type, 'detour');
    assert.equal(detourResult.detourPathNode.status, 'current');

    // 3. Handle resume after detour completion
    const resumeResult = await coordinator.handleResume('session-coord-1', 'transformer');
    assert.ok(resumeResult.resumedLesson);
    assert.equal(resumeResult.resumedLesson?.id, mainLesson.id);
    assert.equal(resumeResult.resumedNodeId, 'path-node-self-attention');
  });

  await t.test('5. LearningSessionCoordinator persists nested detour frames across instances (simulating server restart)', async () => {
    // Instance 1
    const coordinator1 = new LearningSessionCoordinator(db, artifactCompiler);

    const lessonMain = await coordinator1.ensureLessonForNode(
      'session-coord-restart',
      'transformer',
      'self-attention',
      'Self Attention'
    );

    // Detour 1 (Softmax)
    const detour1 = await coordinator1.handleDetour(
      'session-coord-restart',
      'transformer',
      'softmax',
      'Softmax Function',
      'path-node-self-attention',
      lessonMain.id
    );

    // Detour 2 (Nested: Multi-Head while in Softmax)
    const detour2 = await coordinator1.handleDetour(
      'session-coord-restart',
      'transformer',
      'multi-head',
      'Multi-Head Attention',
      detour1.detourPathNode.id,
      detour1.detourLesson.id
    );

    // Simulate server restart: create brand new coordinator instance with empty in-memory state
    const coordinator2 = new LearningSessionCoordinator(db, artifactCompiler);

    // Resume from Detour 2 should restore Detour 1 (Softmax)
    const resume1 = await coordinator2.handleResume('session-coord-restart', 'transformer');
    assert.ok(resume1.resumedLesson);
    assert.equal(resume1.resumedLesson?.id, detour1.detourLesson.id);
    assert.equal(resume1.resumedNodeId, detour1.detourPathNode.id);

    // Resume from Detour 1 should restore Main lesson (Self Attention)
    const resume2 = await coordinator2.handleResume('session-coord-restart', 'transformer');
    assert.ok(resume2.resumedLesson);
    assert.equal(resume2.resumedLesson?.id, lessonMain.id);
    assert.equal(resume2.resumedNodeId, 'path-node-self-attention');

    // No more detours
    const resume3 = await coordinator2.handleResume('session-coord-restart', 'transformer');
    assert.equal(resume3.resumedLesson, null);
    assert.equal(resume3.resumedNodeId, null);
  });
});
