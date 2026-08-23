import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import { KnowledgeCompiler } from '@opentutor/knowledge-core';
import { CourseCompiler } from '@opentutor/assessment-core';
import type { LearningPathNode, LearningSessionSnapshot } from '@opentutor/protocol';

test('End-to-End Golden Path v0.4: Zero Repository Shortcuts (All via Application/HTTP Boundary)', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { server, db, context, close } = await createServerContext(':memory:');
  const { promise: listenPromise, resolve: resolveListen } = Promise.withResolvers<void>();
  server.listen(0, () => resolveListen());
  await listenPromise;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await close();
  });

  // 1. Knowledge Ingestion (via KnowledgeCompiler service)
  const compiler = new KnowledgeCompiler(db);
  const doc = compiler.ingest({
    id: 'attention-paper',
    title: 'Attention Is All You Need',
    content: `# Background\n\nAttention mechanisms compute representations using scaled dot-product attention.\n\n# Softmax Function\n\nSoftmax converts logits into normalized probability distribution.`,
  });
  assert.ok(doc.chunks.length >= 2);

  // 2. Course Roadmap Compilation (via CourseCompiler)
  const courseCompiler = new CourseCompiler();
  const compiledPlan = courseCompiler.compile(
    [
      { id: 'vector-math', title: 'Vector Math' },
      { id: 'softmax', title: 'Softmax Activation' },
      { id: 'self-attention', title: 'Self-Attention' },
    ],
    [
      { from: 'vector-math', to: 'softmax' },
      { from: 'softmax', to: 'self-attention' },
    ],
    ['self-attention'],
    new Set(['vector-math']),
  );
  assert.deepEqual(compiledPlan.nodeIds, ['softmax', 'self-attention']);

  // 3. Learning Room Initial Snapshot (HTTP GET)
  const initialSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  assert.equal(initialSnapRes.status, 200);
  const initialSnapshot = (await initialSnapRes.json()) as LearningSessionSnapshot;
  assert.equal(initialSnapshot.sessionId, 'prototype');
  assert.equal(initialSnapshot.lesson.knowledgeNodeId, 'self-attention');

  // 4. Tutor Agent Interaction (HTTP POST /messages)
  const { promise: msgPromise, resolve: resolveMsg } = Promise.withResolvers<void>();
  const unMsg = context.eventBus.subscribe('prototype', (evt) => {
    if (evt.type === 'agent.completed') resolveMsg();
  });
  const msgRes = await fetch(`${baseUrl}/api/sessions/prototype/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'show me code' }),
  });
  assert.equal(msgRes.status, 202);
  await msgPromise;
  unMsg();

  const postMsgSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const postMsgSnapshot = (await postMsgSnapRes.json()) as LearningSessionSnapshot;
  assert.ok(postMsgSnapshot.lesson.blocks.some((b) => b.type === 'code'));

  // 5. Prerequisite Detour Insertion (HTTP POST /actions)
  const { promise: actPromise, resolve: resolveAct } = Promise.withResolvers<void>();
  const unAct = context.eventBus.subscribe('prototype', (evt) => {
    if (evt.type === 'agent.completed') resolveAct();
  });
  const detourRes = await fetch(`${baseUrl}/api/sessions/prototype/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'softmax_unknown' }),
  });
  assert.equal(detourRes.status, 202);
  await actPromise;
  unAct();

  const detourSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const detourSnapshot = (await detourSnapRes.json()) as LearningSessionSnapshot;
  const detourNode = detourSnapshot.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'softmax' && n.type === 'detour');
  assert.ok(detourNode);
  assert.equal(detourNode.status, 'current');

  // 6. Assessment Answer Submission -> Evaluator -> MasteryPolicy -> Automatic Detour Resume (HTTP POST /answer)
  const quizRes = await fetch(`${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'Softmax ensures that probability outputs sum up to 1 across the sequence.' }),
  });
  assert.equal(quizRes.status, 200);
  const quizBody = (await quizRes.json()) as { assessment: { result: string; confidence: number } };
  assert.equal(quizBody.assessment.result, 'correct');
  assert.ok(quizBody.assessment.confidence >= 0.25);

  // 7. Verify Final Snapshot State (HTTP GET - zero repository shortcut calls!)
  const finalSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  assert.equal(finalSnapRes.status, 200);
  const finalSnap = (await finalSnapRes.json()) as LearningSessionSnapshot;

  const completedDetour = finalSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'softmax');
  const mainNode = finalSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'self-attention');

  assert.equal(completedDetour?.status, 'completed');
  assert.equal(mainNode?.status, 'current');
});
