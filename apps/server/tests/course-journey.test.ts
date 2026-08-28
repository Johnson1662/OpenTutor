import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabase,
  seedDatabase,
  CourseRepository,
  SessionRepository,
  LessonRepository,
  LessonProgressRepository,
  EventRepository,
} from '@opentutor/database';
import { LivingKnowledgeCompiler } from '@opentutor/knowledge-core';
import { CourseCompiler } from '@opentutor/course-core';
import { FakeLessonGenerator, type LessonGenerator } from '@opentutor/lesson-core';
import { createServerContext } from '../src/index.ts';
import { EventBus } from '../src/events/event-bus.ts';
import { CourseService } from '../src/services/course-service.ts';
import type { LearningSessionSnapshot } from '@opentutor/protocol';

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

test('course journey uses real sessions, text sources, and persisted active steps', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const context = await createServerContext(':memory:');
  const { server } = context;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => context.close());

  const createdResponse = await fetch(`${baseUrl}/api/courses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '真实课程路径',
      description: '从文本资料建立一条可继续的学习路径。',
    }),
  });
  assert.equal(createdResponse.status, 201);
  const { course } = await json<{ course: { id: string } }>(createdResponse);

  const unsupportedResponse = await fetch(`${baseUrl}/api/courses/${course.id}/sources`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'slides.pdf', content: 'not a supported source' }),
  });
  assert.equal(unsupportedResponse.status, 400);
  assert.equal((await json<{ error: string }>(unsupportedResponse)).error, 'UNSUPPORTED_SOURCE_FORMAT');

  const sourceResponse = await fetch(`${baseUrl}/api/courses/${course.id}/sources`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'notes.md', content: '# Attention\nAttention connects tokens across a sequence.' }),
  });
  assert.equal(sourceResponse.status, 201);

  const compileResponse = await fetch(`${baseUrl}/api/courses/${course.id}/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ learningGoal: 'Understand attention from first principles.' }),
  });
  assert.equal(compileResponse.status, 200);
  const firstCompile = await json<{ snapshot: LearningSessionSnapshot }>(compileResponse);
  const sessionId = firstCompile.snapshot.sessionId;
  assert.ok(sessionId);
  assert.notEqual(sessionId, 'prototype');
  assert.ok(firstCompile.snapshot.path.length > 0);
  assert.ok(firstCompile.snapshot.lessonProgress?.activeBlockId);

  const journeyResponse = await fetch(`${baseUrl}/api/courses/${course.id}`);
  assert.equal(journeyResponse.status, 200);
  const journey = await json<{ course: { id: string; compileStatus: string } }>(journeyResponse);
  assert.equal(journey.course.id, course.id);
  assert.equal(journey.course.compileStatus, 'ready');

  const sessionResponse = await fetch(`${baseUrl}/api/courses/${course.id}/sessions`, { method: 'POST' });
  assert.equal(sessionResponse.status, 200);
  const sessionFromJourney = await json<{ snapshot: LearningSessionSnapshot }>(sessionResponse);
  assert.equal(sessionFromJourney.snapshot.sessionId, sessionId);

  const beforeAdvance = await json<LearningSessionSnapshot>(await fetch(`${baseUrl}/api/sessions/${sessionId}`));
  const progress = beforeAdvance.lessonProgress!;
  const firstBlockId = progress.activeBlockId;
  assert.ok(firstBlockId);

  const advanceResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/lesson-progress/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      lessonId: beforeAdvance.lesson.id,
      activeBlockId: firstBlockId,
      version: progress.version,
    }),
  });
  assert.equal(advanceResponse.status, 200);

  const afterAdvance = await json<LearningSessionSnapshot>(await fetch(`${baseUrl}/api/sessions/${sessionId}`));
  assert.equal(afterAdvance.lessonProgress?.completedBlockIds[0], firstBlockId);
  assert.equal(afterAdvance.lessonProgress?.version, progress.version + 1);

  const sourceWhileLearning = await fetch(`${baseUrl}/api/courses/${course.id}/sources`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'follow-up.md', content: 'Extra notes.' }),
  });
  assert.equal(sourceWhileLearning.status, 201);
  const afterSource = await json<LearningSessionSnapshot>(await fetch(`${baseUrl}/api/sessions/${sessionId}`));
  assert.equal(afterSource.sessionId, afterAdvance.sessionId);
  assert.equal(afterSource.lesson.id, afterAdvance.lesson.id);
  assert.deepEqual(afterSource.path, afterAdvance.path);
  assert.deepEqual(afterSource.lessonProgress, afterAdvance.lessonProgress);
  assert.equal(afterSource.pathVersion, afterAdvance.pathVersion);

  const recompileResponse = await fetch(`${baseUrl}/api/courses/${course.id}/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ learningGoal: 'Understand attention from first principles.' }),
  });
  assert.equal(recompileResponse.status, 200);
  const recompiled = await json<{ snapshot: LearningSessionSnapshot }>(recompileResponse);
  assert.equal(recompiled.snapshot.sessionId, sessionId);
});

test('failed course sessions are rebuilt on retry', async (t) => {
  const db = createDatabase(':memory:');
  seedDatabase(db);
  t.after(() => db.close());

  const lessonProgressRepo = new LessonProgressRepository(db);
  const sessionRepo = new SessionRepository(db, lessonProgressRepo);
  const fakeLessonGenerator = new FakeLessonGenerator();
  let modelConfigured = false;
  const lessonGenerator: LessonGenerator = {
    generate: async (input) => {
      if (!modelConfigured) throw new Error('MODEL_SETUP_REQUIRED');
      return fakeLessonGenerator.generate(input);
    },
  };
  const courseService = new CourseService(
    new CourseRepository(db),
    sessionRepo,
    new LessonRepository(db),
    new LivingKnowledgeCompiler(db),
    new CourseCompiler(db),
    lessonGenerator,
    new EventBus(new EventRepository(db))
  );
  const course = courseService.createCourse({ id: 'retry-course', title: 'Retry course' });

  await assert.rejects(
    () => courseService.compileCourse(course.id, 'Understand attention from first principles.'),
    /MODEL_SETUP_REQUIRED/
  );
  assert.ok(sessionRepo.findSessionByCourse(course.id, 'default-user'));
  assert.equal(courseService.getExistingSessionForCourse(course.id), null);

  modelConfigured = true;
  const snapshot = await courseService.startSessionForCourse(course.id);
  assert.ok(!snapshot.lesson.id.startsWith('empty-lesson-'));
  assert.ok(snapshot.lesson.blocks.length > 0);
  assert.ok(snapshot.path.length > 0);
});

test('completed course keeps its last real lesson and session as a valid journey', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, courseService, sessionRepo, close } = await createServerContext(':memory:');
  t.after(close);

  const course = courseService.createCourse({ id: 'final-course', title: 'Final course' });
  courseService.addSource(
    course.id,
    'attention.md',
    '# Self Attention\nSelf attention weights token representations across sequence context.\n\n# Multi-Head\nMultiple attention heads run parallel projections.'
  );
  const { snapshot: initial } = await courseService.compileCourse(course.id, 'Understand attention.');

  let snap = initial;
  let steps = 0;
  while (snap.path.some((node) => node.status === 'current')) {
    assert.ok(steps < 20, 'Path must eventually complete');
    await context.sessionService.completeCurrentNode(snap.sessionId, snap.pathVersion);
    snap = sessionRepo.getSessionSnapshot(snap.sessionId)!;
    steps += 1;
  }

  const finalLessonId = snap.lesson.id;
  assert.ok(snap.path.length > 0);
  assert.ok(snap.path.every((node) => node.status === 'completed'), 'Final path must be fully completed');
  assert.equal(snap.path.filter((node) => node.status === 'current').length, 0, 'No current node after final completion');
  assert.equal(snap.lesson.id, finalLessonId, 'Last real lesson must remain active');
  assert.ok(!snap.lesson.id.startsWith('empty-lesson-'));

  const existing = courseService.getExistingSessionForCourse(course.id);
  assert.ok(existing, 'Completed course must still expose its session');
  assert.equal(existing.sessionId, snap.sessionId);
  assert.deepEqual(existing.path, snap.path);

  let compiled = 0;
  const originalCompile = courseService.compileCourse.bind(courseService);
  courseService.compileCourse = async (...args: Parameters<typeof courseService.compileCourse>) => {
    compiled += 1;
    return originalCompile(...args);
  };
  const again = await courseService.startSessionForCourse(course.id);
  assert.equal(compiled, 0, 'Completed course must not recompile');
  assert.equal(again.sessionId, snap.sessionId, 'Completed course must return the existing session');
  assert.equal(again.pathVersion, snap.pathVersion);
  assert.deepEqual(again.path, snap.path);
});
