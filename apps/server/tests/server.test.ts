import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import type { AcceptedResponse, LearningSessionSnapshot } from '@opentutor/protocol';

test('apps/server - SQLite backed HTTP & SSE Integration Tests', async (t) => {
  const { server, context, close } = await createServerContext(':memory:');
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
    const { promise: completedPromise, resolve: resolveCompleted } = Promise.withResolvers<void>();
    const unsubscribe = context.eventBus.subscribe('prototype', (evt) => {
      if (evt.type === 'agent.completed') {
        resolveCompleted();
      }
    });

    const res = await fetch(`${baseUrl}/api/sessions/prototype/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'simpler' }),
    });

    assert.equal(res.status, 202);
    const body = (await res.json()) as AcceptedResponse;
    assert.equal(body.accepted, true);
    assert.ok(body.requestId);

    await completedPromise;
    unsubscribe();

    // Verify snapshot reflects incremented version and new block
    const snapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
    const snapshot = (await snapRes.json()) as LearningSessionSnapshot;
    assert.equal(snapshot.lesson.version, 2);
    assert.ok(snapshot.lesson.blocks.some((b) => b.id.startsWith('simple-')));
  });

  await t.test('3. POST /api/sessions/prototype/actions (softmax_unknown) inserts detour path', async () => {
    const { promise: completedPromise, resolve: resolveCompleted } = Promise.withResolvers<void>();
    const unsubscribe = context.eventBus.subscribe('prototype', (evt) => {
      if (evt.type === 'agent.completed') {
        resolveCompleted();
      }
    });

    const res = await fetch(`${baseUrl}/api/sessions/prototype/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'softmax_unknown' }),
    });

    assert.equal(res.status, 202);

    await completedPromise;
    unsubscribe();

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

  await t.test('6. POST /api/sessions/prototype/messages runs TutorAgent and patches lesson', async () => {
    const { promise: completedPromise, resolve: resolveCompleted } = Promise.withResolvers<void>();
    const unsubscribe = context.eventBus.subscribe('prototype', (evt) => {
      if (evt.type === 'agent.completed') {
        resolveCompleted();
      }
    });

    const res = await fetch(`${baseUrl}/api/sessions/prototype/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Can you show me python code for self attention?' }),
    });

    assert.equal(res.status, 202);
    const body = (await res.json()) as AcceptedResponse;
    assert.equal(body.accepted, true);

    await completedPromise;
    unsubscribe();

    const snapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
    const snapshot = (await snapRes.json()) as LearningSessionSnapshot;
    assert.ok(snapshot.lesson.blocks.some((b) => b.type === 'code'));
  });

  await t.test('7. GET /api/ai/providers returns non-leaking provider list', async () => {
    const res = await fetch(`${baseUrl}/api/ai/providers`);
    assert.equal(res.status, 200);
    const providers = (await res.json()) as Array<{ id: string; name: string; configured: boolean }>;
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0);
    assert.ok(providers.some((p) => p.id === 'anthropic'));
  });

  await t.test('8. GET & PUT /api/ai/preferences manages default provider/model', async () => {
    const putRes = await fetch(`${baseUrl}/api/ai/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultProviderId: 'anthropic',
        defaultModelId: 'claude-3-7-sonnet-20250219',
        thinkingLevel: 'high',
      }),
    });
    assert.equal(putRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/ai/preferences`);
    assert.equal(getRes.status, 200);
    const prefs = (await getRes.json()) as { defaultProviderId: string; defaultModelId: string; thinkingLevel: string };
    assert.equal(prefs.defaultProviderId, 'anthropic');
    assert.equal(prefs.defaultModelId, 'claude-3-7-sonnet-20250219');
    assert.equal(prefs.thinkingLevel, 'high');
  });

  await t.test('9. POST /api/ai/auth/sessions starts interactive auth flow and supports cancellation', async () => {
    const createRes = await fetch(`${baseUrl}/api/ai/auth/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'anthropic', type: 'api_key' }),
    });
    assert.equal(createRes.status, 201);
    const { authSessionId } = (await createRes.json()) as { authSessionId: string };
    assert.ok(authSessionId.startsWith('auth-'));

    // Cancel auth session
    const cancelRes = await fetch(`${baseUrl}/api/ai/auth/sessions/${authSessionId}`, {
      method: 'DELETE',
    });
    assert.equal(cancelRes.status, 200);
    const cancelBody = (await cancelRes.json()) as { cancelled: boolean };
    assert.equal(cancelBody.cancelled, true);
  });
});
