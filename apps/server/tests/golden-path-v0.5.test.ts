import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import { LivingKnowledgeCompiler } from '@opentutor/knowledge-core';
import type { LearningPathNode, LearningSessionSnapshot } from '@opentutor/protocol';

test('End-to-End Golden Path v0.5: AI Control Plane + Living Knowledge + Adaptive Tutor Loop', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const { server, db, context, preferencesRepo, close } = await createServerContext(':memory:');
  const { promise: listenPromise, resolve: resolveListen } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => resolveListen());
  await listenPromise;

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8787;
  const baseUrl = `http://127.0.0.1:${port}`;

  const advanceActiveStep = async () => {
    const current = (await (await fetch(`${baseUrl}/api/sessions/prototype`)).json()) as LearningSessionSnapshot;
    assert.ok(current.lessonProgress);
    const response = await fetch(`${baseUrl}/api/sessions/prototype/lesson-progress/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonId: current.lesson.id,
        activeBlockId: current.lessonProgress.activeBlockId,
        version: current.lessonProgress.version,
      }),
    });
    assert.equal(response.status, 200);
  };

  t.after(async () => {
    await close();
  });

  // 1. AI Control Plane: Discover providers & set user default model preference
  const providersRes = await fetch(`${baseUrl}/api/ai/providers`);
  assert.equal(providersRes.status, 200);
  const providers = (await providersRes.json()) as Array<{ id: string; name: string }>;
  assert.ok(providers.length > 0);

  const putPrefRes = await fetch(`${baseUrl}/api/ai/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-3-7-sonnet-20250219',
      thinkingLevel: 'high',
    }),
  });
  assert.equal(putPrefRes.status, 200);
  const prefs = preferencesRepo.getPreferences('default-user');
  assert.equal(prefs?.defaultProviderId, 'anthropic');
  assert.equal(prefs?.thinkingLevel, 'high');

  // 2. Living Knowledge: Ingest two separate documents and compile canonical knowledge
  const livingCompiler = new LivingKnowledgeCompiler(db);

  // Document A: Attention Introduction
  const docA = await livingCompiler.ingestAndCompile({
    id: 'doc-attention-a',
    title: 'Self-Attention Foundations',
    content: `# Self Attention\n\nSelf attention enables dynamically weighting representation of tokens based on sequence context.\n\n# Softmax Normalization\n\nSoftmax converts logits into normalized probability distribution.`,
  });
  assert.equal(docA.document.version, 1);
  assert.ok(docA.compiledArtifacts.length >= 2);

  // Document B: Attention Mechanics (different surface form "Self-Attention Mechanism")
  const docB = await livingCompiler.ingestAndCompile({
    id: 'doc-attention-b',
    title: 'Attention Mechanics Deep Dive',
    content: `# Self Attention\n\nSelf attention calculates queries, keys, and values dot-product scores.`,
  });
  assert.equal(docB.document.version, 1);

  // Verify Entity Resolution deduplicated into single canonical node
  const ftsResults = livingCompiler.retrieval.knowledgeSearch('softmax');
  assert.ok(ftsResults.length > 0);
  const softmaxArtifact = livingCompiler.retrieval.artifactRead('softmax-normalization');
  assert.ok(softmaxArtifact);

  // 3. Learning Room Initial Snapshot (HTTP GET)
  const initialSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  assert.equal(initialSnapRes.status, 200);
  const initialSnapshot = (await initialSnapRes.json()) as LearningSessionSnapshot;
  assert.equal(initialSnapshot.sessionId, 'prototype');
  assert.equal(initialSnapshot.lesson.knowledgeNodeId, 'self-attention');

  // 4. Tutor Agent Interaction & Diagnostic Probing (HTTP POST /actions & /answer)
  const { promise: completedPromise, resolve: resolveCompleted } = Promise.withResolvers<void>();
  const unsubscribe = context.eventBus.subscribe('prototype', (evt) => {
    if (evt.type === 'agent.completed') {
      resolveCompleted();
    }
  });

  const detourRes = await fetch(`${baseUrl}/api/sessions/prototype/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'softmax_unknown' }),
  });
  assert.equal(detourRes.status, 202);

  await completedPromise;
  unsubscribe();

  // 4b. Verify probe on Canvas and answer with misconception to confirm diagnosis
  const probeSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const probeSnap = (await probeSnapRes.json()) as LearningSessionSnapshot;
  const probeBlock = probeSnap.lesson.blocks.find((b) => b.id.startsWith('probe-') || ('assessmentKind' in b && b.assessmentKind === 'probe'));
  assert.ok(probeBlock, 'Diagnostic probe placed on Canvas');

  const probeAnsRes = await fetch(`${baseUrl}/api/lessons/${probeSnap.lesson.id}/blocks/${probeBlock.id}/answer?sessionId=prototype`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'wrong-guess' }),
  });
  assert.equal(probeAnsRes.status, 200);

  // Verify detour is active
  const detourSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  const detourSnapshot = (await detourSnapRes.json()) as LearningSessionSnapshot;
  const detourNode = detourSnapshot.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'softmax' && n.type === 'detour');
  assert.ok(detourNode);
  assert.equal(detourNode.status, 'current');
  await advanceActiveStep();

  // 5. Assessment Evaluation on 3 distinct items & Mastery Update (HTTP POST /answer)
  const quizRes1 = await fetch(`${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz/answer?sessionId=prototype`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'Softmax ensures that each probability output forms a positive distribution and sum to exactly 1.' }),
  });
  assert.equal(quizRes1.status, 200);
  await advanceActiveStep();

  const quizRes2 = await fetch(`${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz-2/answer?sessionId=prototype`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'opt-exp-1' }),
  });
  assert.equal(quizRes2.status, 200);
  await advanceActiveStep();

  const quizRes3 = await fetch(`${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz-3/answer?sessionId=prototype`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'opt-sum-1' }),
  });
  assert.equal(quizRes3.status, 200);

  // 6. Verify Automatic Detour Resume on Main Track
  const resumedSnapRes = await fetch(`${baseUrl}/api/sessions/prototype`);
  assert.equal(resumedSnapRes.status, 200);
  const resumedSnap = (await resumedSnapRes.json()) as LearningSessionSnapshot;

  const completedDetour = resumedSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'softmax');
  const mainNode = resumedSnap.path.find((n: LearningPathNode) => n.knowledgeNodeId === 'self-attention');

  assert.equal(completedDetour?.status, 'completed');
  assert.equal(mainNode?.status, 'current');
});
