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

test('completing all lesson steps activates the next real lesson', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { server, context, close } = await createServerContext(':memory:');
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await close();
  });

  let snapshot = (await (await fetch(`${baseUrl}/api/sessions/prototype`)).json()) as LearningSessionSnapshot;
  const initialBlockCount = snapshot.lesson.blocks.length;
  const activatedLessonIds: string[] = [];
  const unsubscribe = context.eventBus.subscribe('prototype', (event) => {
    if (event.type === 'lesson.activated') {
      activatedLessonIds.push((event.data as { lesson: { id: string } }).lesson.id);
    }
  });

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
    const body = (await response.json()) as { snapshot: LearningSessionSnapshot };
    snapshot = body.snapshot;
  }

  unsubscribe();
  assert.notEqual(snapshot.lessonProgress?.activeBlockId, null);
  const current = snapshot.path.find((node) => node.status === 'current');
  assert.ok(current);
  assert.equal(snapshot.lesson.knowledgeNodeId, current.knowledgeNodeId);
  assert.notEqual(snapshot.lesson.id, 'lesson-self-attention');
  assert.ok(activatedLessonIds.includes(snapshot.lesson.id));
});

test('lesson patches preserve the active step and reject removing it', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { context, sessionRepo, close } = await createServerContext(':memory:');
  t.after(close);

  const snapshot = sessionRepo.getSessionSnapshot('prototype')!;
  const inserted: LessonPatch = {
    op: 'insert',
    position: { after: 'intro' },
    block: { id: 'patch-example', type: 'text', variant: 'example', content: 'A focused example.' },
  };
  const result = context.lessonService.applyPatches('prototype', snapshot.lesson.id, snapshot.lesson.version, [inserted]);
  const afterPatch = sessionRepo.getSessionSnapshot('prototype')!;
  assert.equal(afterPatch.lessonProgress?.activeBlockId, 'intro');
  assert.ok(afterPatch.lesson.blocks.some((block) => block.id === 'patch-example'));

  assert.throws(
    () => context.lessonService.applyPatches('prototype', snapshot.lesson.id, result.newVersion, [{ op: 'remove', blockId: 'intro' }]),
    ActiveBlockRemovalError
  );
});
