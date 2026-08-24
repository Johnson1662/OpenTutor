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
  server.listen(0, '127.0.0.1', () => resolveListen());
  await listenPromise;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://127.0.0.1:${port}`;

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

  // 5. Diagnostic Probing & Prerequisite Detour Insertion (HTTP POST /actions & /answer)
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

  // 5b. Verify probe placed on Canvas and answer with misconception to confirm diagnosis
  const probeSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const probeSnap = (await probeSnapRes.json()) as LearningSessionSnapshot;
  const probeBlock = probeSnap.lesson.blocks.find((b) => b.id.startsWith('probe-') || ('assessmentKind' in b && b.assessmentKind === 'probe'));
  assert.ok(probeBlock, 'Diagnostic probe block placed on Canvas');

  const probeAnsRes = await fetch(`${baseUrl}/api/lessons/${probeSnap.lesson.id}/blocks/${probeBlock.id}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'wrong-guess' }),
  });
  assert.equal(probeAnsRes.status, 200);

  const detourSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const detourSnapshot = (await detourSnapRes.json()) as LearningSessionSnapshot;
  const detourNode = detourSnapshot.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'softmax' && n.type === 'detour');
  assert.ok(detourNode);
  assert.equal(detourNode.status, 'current');

  // 6. Assessment Answer Submission on 3 distinct items -> Evaluator -> BetaMasteryAggregator -> Automatic Detour Resume (HTTP POST /answer)
  const quizRes1 = await fetch(`${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'Softmax ensures that all output probabilities are non-negative and sum to exactly 1.' }),
  });
  assert.equal(quizRes1.status, 200);

  const quizRes2 = await fetch(`${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz-2/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'opt-exp-1' }),
  });
  assert.equal(quizRes2.status, 200);

  const quizRes3 = await fetch(`${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz-3/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'opt-sum-1' }),
  });
  assert.equal(quizRes3.status, 200);

  // 7. Verify Final Snapshot State (HTTP GET - zero repository shortcut calls!)
  const finalSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  assert.equal(finalSnapRes.status, 200);
  const finalSnap = (await finalSnapRes.json()) as LearningSessionSnapshot;

  const completedDetour = finalSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'softmax');
  const mainNode = finalSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'self-attention');

  assert.equal(completedDetour?.status, 'completed');
  assert.equal(mainNode?.status, 'current');
});
