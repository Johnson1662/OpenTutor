import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import { ActiveBlockRemovalError } from '@opentutor/database';
import type { LessonPatch } from '@opentutor/protocol';
import type { LearningSessionSnapshot } from '@opentutor/protocol';

test('lesson progress API keeps the server authoritative', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { server, context, close } = await createServerContext(':memory:');
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await close();
  });

  async function postProgress(body: unknown, sessionId = 'prototype') {
    return fetch(`${baseUrl}/api/sessions/${sessionId}/lesson-progress/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function jsonBody(response: Response): Promise<any> {
    return response.json();
  }

  const initialResponse = await fetch(`${baseUrl}/api/sessions/prototype`);
  assert.equal(initialResponse.status, 200);
  const initial = (await initialResponse.json()) as LearningSessionSnapshot;
  assert.equal(initial.lessonProgress?.activeBlockId, 'intro');
  assert.deepEqual(initial.lessonProgress?.completedBlockIds, []);
  assert.equal(initial.lessonProgress?.version, 1);

  const firstAdvance = await postProgress({
    lessonId: initial.lesson.id,
    activeBlockId: 'intro',
    version: initial.lessonProgress!.version,
  });
  assert.equal(firstAdvance.status, 200);
  const firstBody = (await firstAdvance.json()) as {
    progress: NonNullable<LearningSessionSnapshot['lessonProgress']>;
    snapshot: LearningSessionSnapshot;
  };
  assert.equal(firstBody.progress.activeBlockId, 'definition');
  assert.deepEqual(firstBody.progress.completedBlockIds, ['intro']);
  assert.equal(firstBody.snapshot.lessonProgress?.activeBlockId, 'definition');
  assert.equal(firstBody.snapshot.lessonProgress?.version, 2);
  assert.ok(context.eventBus.getEventsSince('prototype', 0).some((event) => event.type === 'lesson.progress'));

  const stale = await postProgress({
    lessonId: initial.lesson.id,
    activeBlockId: 'intro',
    version: 1,
  });
  assert.equal(stale.status, 409);
  assert.equal((await jsonBody(stale)).error, 'VersionConflictError');

  const wrongBlock = await postProgress({
    lessonId: initial.lesson.id,
    activeBlockId: 'intro',
    version: firstBody.progress.version,
  });
  assert.equal(wrongBlock.status, 409);
  assert.equal((await jsonBody(wrongBlock)).error, 'ProgressStateConflictError');

  const missingBlock = await postProgress({
    lessonId: initial.lesson.id,
    activeBlockId: 'missing-block',
    version: firstBody.progress.version,
  });
  assert.equal(missingBlock.status, 400);
  assert.equal((await jsonBody(missingBlock)).error, 'BlockNotFoundError');

  const restart = await postProgress({
    lessonId: initial.lesson.id,
    activeBlockId: 'definition',
    version: firstBody.progress.version,
    restart: true,
  });
  assert.equal(restart.status, 200);
  const restartBody = (await restart.json()) as {
    progress: NonNullable<LearningSessionSnapshot['lessonProgress']>;
  };
  assert.equal(restartBody.progress.activeBlockId, 'intro');
  assert.deepEqual(restartBody.progress.completedBlockIds, []);
  assert.equal(restartBody.progress.version, 3);

  const malformed = await postProgress(null);
  assert.equal(malformed.status, 400);
  assert.equal((await jsonBody(malformed)).error, 'INVALID_PROGRESS_BODY');

  const wrongLesson = await postProgress({
    lessonId: 'lesson-softmax',
    activeBlockId: 'softmax-intro',
    version: restartBody.progress.version,
  });
  assert.equal(wrongLesson.status, 409);
  assert.equal((await jsonBody(wrongLesson)).error, 'Error');

  const unknownSession = await postProgress({
    lessonId: initial.lesson.id,
    activeBlockId: 'intro',
    version: 1,
  }, 'missing-session');
  assert.equal(unknownSession.status, 404);
});

test('mastery keeps the current lesson when next lesson generation fails', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, close } = await createServerContext(':memory:');
  t.after(close);

  const coordinator = (context.sessionService as any).coordinator;
  coordinator.lessonGenerator.generate = async () => {
    throw new Error('NEXT_LESSON_FAILED');
  };
  const nextLessonFailure = new Promise<void>((resolve) => {
    const unsubscribe = context.eventBus.subscribe('prototype', (event) => {
      if (event.type === 'error' && (event.data as { error?: string }).error === 'NEXT_LESSON_FAILED') {
        unsubscribe();
        resolve();
      }
    });
  });

  const before = sessionRepo.getSessionSnapshot('prototype')!;
  for (const sourceItemId of ['fail-a', 'fail-b', 'fail-c']) {
    const state = context.knowledgeService!.recordAssessment(
      'prototype',
      {
        id: 'failure-assessment-' + sourceItemId,
        knowledgeNodeId: 'self-attention',
        lessonId: before.lesson.id,
        blockId: 'quiz',
        result: 'correct',
        confidence: 1,
        feedback: 'correct',
      },
      'default-user',
      { difficulty: 2, confidence: 1, score: 1, sourceItemId, type: 'quiz' }
    );
    context.learningProgressService!.onKnowledgeStateUpdated('prototype', state);
    if (sourceItemId === 'fail-c') assert.equal(state.status, 'mastered');
  }

  await nextLessonFailure;
  const after = sessionRepo.getSessionSnapshot('prototype')!;
  assert.equal(after.pathVersion, before.pathVersion);
  assert.equal(after.path.find((node) => node.status === 'current')?.id, before.path.find((node) => node.status === 'current')?.id);
  assert.equal(after.lesson.id, before.lesson.id);
  assert.equal(after.lesson.knowledgeNodeId, before.lesson.knowledgeNodeId);
});

test('lesson completion waits for mastered knowledge before advancing path', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { server, context, close, sessionRepo } = await createServerContext(':memory:');
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await close();
  });

  let snapshot = (await (await fetch(`${baseUrl}/api/sessions/prototype`)).json()) as LearningSessionSnapshot;
  const initialPathVersion = snapshot.pathVersion;
  const initialBlockCount = snapshot.lesson.blocks.length;

  for (let step = 0; step < initialBlockCount; step += 1) {
    const progress = snapshot.lessonProgress;
    assert.ok(progress);
    const response = await fetch(`${baseUrl}/api/sessions/prototype/lesson-progress/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lessonId: snapshot.lesson.id,
        activeBlockId: progress.activeBlockId,
        version: progress.version,
      }),
    });
    assert.equal(response.status, 200);
    snapshot = (await response.json() as { snapshot: LearningSessionSnapshot }).snapshot;
  }

  assert.equal(snapshot.lessonProgress?.activeBlockId, null);
  assert.equal(snapshot.lesson.status, 'active');
  assert.equal(snapshot.lesson.id, 'lesson-self-attention');
  assert.equal(snapshot.path.find((node) => node.status === 'current')?.knowledgeNodeId, 'self-attention');

  const pathAdvanced = new Promise<void>((resolve) => {
    const unsubscribe = context.eventBus.subscribe('prototype', (event) => {
      if (event.type === 'path.patch') {
        unsubscribe();
        resolve();
      }
    });
  });

  for (const sourceItemId of ['mastery-a', 'mastery-b', 'mastery-c']) {
    const state = context.knowledgeService!.recordAssessment(
      'prototype',
      {
        id: 'assessment-' + sourceItemId,
        knowledgeNodeId: 'self-attention',
        lessonId: snapshot.lesson.id,
        blockId: 'quiz',
        result: 'correct',
        confidence: 1,
        feedback: 'correct',
      },
      'default-user',
      { difficulty: 2, confidence: 1, score: 1, sourceItemId, type: 'quiz' }
    );
    context.learningProgressService!.onKnowledgeStateUpdated('prototype', state);
    if (sourceItemId === 'mastery-c') assert.equal(state.status, 'mastered');
  }

  await pathAdvanced;
  const masteredSnapshot = sessionRepo.getSessionSnapshot('prototype')!;
  assert.equal(masteredSnapshot.pathVersion, initialPathVersion + 1);
  assert.equal(masteredSnapshot.path.filter((node) => node.status === 'current').length, 1);
  assert.equal(masteredSnapshot.path.find((node) => node.knowledgeNodeId === 'self-attention')?.status, 'completed');
  assert.equal(masteredSnapshot.path.find((node) => node.status === 'current')?.knowledgeNodeId, 'multi-head');
});

test('lesson patches activate a new block after exhaustion without resetting progress', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, close } = await createServerContext(':memory:');
  t.after(close);

  let snapshot = sessionRepo.getSessionSnapshot('prototype')!;
  while (snapshot.lessonProgress?.activeBlockId) {
    const currentProgress = snapshot.lessonProgress;
    const result = await context.learningProgressService!.advance(
      'prototype',
      snapshot.lesson.id,
      currentProgress.version,
      currentProgress.activeBlockId
    );
    snapshot = result.snapshot!;
  }

  const completedBlockIds = snapshot.lessonProgress?.completedBlockIds ?? [];
  assert.equal(snapshot.lessonProgress?.activeBlockId, null);
  const inserted: LessonPatch = {
    op: 'insert',
    position: { after: 'intro' },
    block: { id: 'patch-example', type: 'text', variant: 'example', content: 'A focused example.' },
  };
  const result = context.lessonService.applyPatches('prototype', snapshot.lesson.id, snapshot.lesson.version, [inserted]);
  const afterPatch = sessionRepo.getSessionSnapshot('prototype')!;
  assert.equal(afterPatch.lessonProgress?.activeBlockId, 'patch-example');
  assert.deepEqual(afterPatch.lessonProgress?.completedBlockIds, completedBlockIds);
  assert.ok(afterPatch.lesson.blocks.some((block) => block.id === 'patch-example'));

  assert.throws(
    () => context.lessonService.applyPatches('prototype', snapshot.lesson.id, result.newVersion, [{ op: 'remove', blockId: 'patch-example' }]),
    ActiveBlockRemovalError
  );
});

test('lesson patch insert surfaces the new block as the active step', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, close } = await createServerContext(':memory:');
  t.after(close);

  const before = sessionRepo.getSessionSnapshot('prototype')!;
  assert.equal(before.lessonProgress?.activeBlockId, 'intro');
  context.lessonService.applyPatches('prototype', before.lesson.id, before.lesson.version, [
    { op: 'insert', position: { after: 'intro' }, block: { id: 'live-patch', type: 'text', variant: 'example', content: 'Immediate visibility.' } },
  ]);
  const after = sessionRepo.getSessionSnapshot('prototype')!;
  assert.equal(after.lessonProgress?.activeBlockId, 'live-patch', 'Inserted block must become active immediately');
});
