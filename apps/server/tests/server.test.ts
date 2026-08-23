import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import type { AcceptedResponse, LearningSessionSnapshot } from '@opentutor/protocol';

test('apps/server - SQLite backed HTTP & SSE Integration Tests', async (t) => {
  const { server, context, close } = createServerContext(':memory:');
  const { promise: listenPromise, resolve: resolveListen } = Promise.withResolvers<void>();
  server.listen(0, () => resolveListen());
  await listenPromise;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await close();
  });

  await t.test('1. GET /api/sessions/prototype returns initial snapshot', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/prototype`);
    assert.equal(res.status, 200);
    const snapshot = (await res.json()) as LearningSessionSnapshot;

    assert.equal(snapshot.sessionId, 'prototype');
    assert.ok(snapshot.lesson);
    assert.equal(snapshot.lesson.knowledgeNodeId, 'self-attention');
    assert.equal(snapshot.lesson.version, 1);
    assert.equal(snapshot.path.length, 5);
  });

  await t.test('2. POST /api/sessions/prototype/actions triggers patch & persists in SQLite', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/prototype/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'simpler' }),
    });

    assert.equal(res.status, 202);
    const body = (await res.json()) as AcceptedResponse;
    assert.equal(body.accepted, true);
    assert.ok(body.requestId);

    // Verify snapshot reflects incremented version and new block
    const snapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
    const snapshot = (await snapRes.json()) as LearningSessionSnapshot;
    assert.equal(snapshot.lesson.version, 2);
    assert.ok(snapshot.lesson.blocks.some((b) => b.id.startsWith('simple-')));
  });

  await t.test('3. POST /api/sessions/prototype/actions (softmax_unknown) inserts detour path', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/prototype/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'softmax_unknown' }),
    });

    assert.equal(res.status, 202);

    const snapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
    const snapshot = (await snapRes.json()) as LearningSessionSnapshot;
    assert.equal(snapshot.pathVersion, 2);
    assert.ok(snapshot.path.some((n) => n.type === 'detour' && n.knowledgeNodeId === 'softmax'));
  });

  await t.test('4. POST /api/lessons/:id/blocks/:id/answer evaluates diagnostic quiz', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/lesson-self-attention/blocks/quiz/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'Because tokens need context from surrounding tokens.' }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { assessment: { result: string; confidence: number } };
    assert.equal(body.assessment.result, 'correct');
    assert.ok(body.assessment.confidence > 0.8);
  });

  await t.test('5. GET /api/sessions/prototype/events streams SSE and replays missed events', async () => {
    context.eventBus.publish('prototype', 'agent.started', { requestId: 'test-replay-req' });

    const controller = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/sessions/prototype/events?lastSeq=0`, {
      signal: controller.signal,
    });
    assert.equal(sseRes.status, 200);
    assert.equal(sseRes.headers.get('content-type'), 'text/event-stream');

    const reader = sseRes.body?.getReader();
    assert.ok(reader);

    const chunk = await reader.read();
    assert.ok(chunk.value);
    const text = new TextDecoder().decode(chunk.value);
    assert.ok(text.includes('event:'));
    assert.ok(text.includes('data:'));

    await reader.cancel();
    controller.abort();
  });
});
