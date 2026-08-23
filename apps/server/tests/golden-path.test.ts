import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import { KnowledgeCompiler } from '@opentutor/knowledge-core';
import { CourseCompiler, AssessmentEvaluator, MasteryPolicy } from '@opentutor/assessment-core';
import type { LearningPathNode, LearningSessionSnapshot } from '@opentutor/protocol';

test('End-to-End Golden Path: Knowledge -> Course -> Agent Session -> Detour -> Assessment -> Mastery', async (t) => {
  const { server, db, sessionRepo, close } = createServerContext(':memory:');
  const { promise: listenPromise, resolve: resolveListen } = Promise.withResolvers<void>();
  server.listen(0, () => resolveListen());
  await listenPromise;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await close();
  });

  // 1. Knowledge Ingestion
  const compiler = new KnowledgeCompiler(db);
  const doc = compiler.ingest({
    id: 'attention-paper',
    title: 'Attention Is All You Need',
    content: `# Background\n\nAttention mechanisms compute representations using scaled dot-product attention.\n\n# Softmax Function\n\nSoftmax converts logits into normalized probability distribution.`,
  });
  assert.ok(doc.chunks.length >= 2);

  // 2. Course Roadmap Compilation
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

  // 3. Learning Room Session Snapshot
  const initialSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  assert.equal(initialSnapRes.status, 200);
  const initialSnapshot = (await initialSnapRes.json()) as LearningSessionSnapshot;
  assert.equal(initialSnapshot.sessionId, 'prototype');
  assert.equal(initialSnapshot.lesson.knowledgeNodeId, 'self-attention');

  // 4. Tutor Agent Interaction (Trigger code explanation via message)
  const msgRes = await fetch(`${baseUrl}/api/sessions/prototype/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'show me code' }),
  });
  assert.equal(msgRes.status, 202);

  // Snapshot updated with code block
  const postMsgSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const postMsgSnapshot = (await postMsgSnapRes.json()) as LearningSessionSnapshot;
  assert.ok(postMsgSnapshot.lesson.blocks.some((b) => b.type === 'code'));

  // 5. Prerequisite Detour Insertion
  const detourRes = await fetch(`${baseUrl}/api/sessions/prototype/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'softmax_unknown' }),
  });
  assert.equal(detourRes.status, 202);

  const detourSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const detourSnapshot = (await detourSnapRes.json()) as LearningSessionSnapshot;
  const detourNode = detourSnapshot.path.find((n) => n.knowledgeNodeId === 'softmax' && n.type === 'detour');
  assert.ok(detourNode);
  assert.equal(detourNode.status, 'current');

  // 6. Assessment Evaluation & Mastery Policy
  const evaluator = new AssessmentEvaluator();
  const evaluation = evaluator.evaluateObjective(
    { correctAnswer: 'Softmax' },
    'Softmax',
  );
  assert.equal(evaluation.result, 'correct');

  const policy = new MasteryPolicy();
  const newConfidence = policy.updateConfidence(0.5, 'correct');
  assert.ok(newConfidence > 0.5);

  const quizRes = await fetch(`${baseUrl}/api/lessons/lesson-self-attention/blocks/q1/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'Softmax' }),
  });
  assert.equal(quizRes.status, 200);

  // 7. Complete Detour and Resume Main Track
  sessionRepo.completeCurrentNode('prototype', detourSnapshot.pathVersion);
  const finalSnap = sessionRepo.getSessionSnapshot('prototype');
  assert.ok(finalSnap);
  const completedDetour = finalSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'softmax');
  const mainNode = finalSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'self-attention');
  assert.equal(completedDetour?.status, 'completed');
  assert.equal(mainNode?.status, 'current');
});
