import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext, type ServerContext } from '../src/index.ts';
import type { LearningPathNode, LearningSessionSnapshot, QuizBlock } from '@opentutor/protocol';

test('MVP Golden Path: Self-Attention requires Softmax Diagnostic Adaptive Arc + Real Restart Durability', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  const fs = await import('node:fs');
  const { randomUUID } = await import('node:crypto');
  const dbPath = `golden-path-${randomUUID().slice(0, 8)}.sqlite`;
  let ctx: ServerContext | undefined;
  let restartedCtx: ServerContext | undefined;

  try {
    ctx = await createServerContext(dbPath);
    const { promise: listenPromise, resolve: resolveListen } = Promise.withResolvers<void>();
    ctx.server.listen(0, '127.0.0.1', () => resolveListen());
    await listenPromise;

    let address = ctx.server.address();
    let port = typeof address === 'object' && address ? address.port : 8787;
    let baseUrl = `http://127.0.0.1:${port}`;
  const sessionId = 'prototype';

  // 1. Initial State: Self Attention Lesson active, Softmax mastery unknown
  const initialSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  assert.equal(initialSnapRes.status, 200);
  const initialSnap = (await initialSnapRes.json()) as LearningSessionSnapshot;
  assert.equal(initialSnap.sessionId, sessionId);
  assert.equal(initialSnap.lesson.knowledgeNodeId, 'self-attention');
  const initialActiveNode = initialSnap.path.find((n) => n.status === 'current')!;
  assert.equal(initialActiveNode.knowledgeNodeId, 'self-attention');

  // 2. User expresses confusion about prerequisite Softmax
  const { promise: agentPromise, resolve: resolveAgent } = Promise.withResolvers<void>();
  const unAgent = ctx.context.eventBus.subscribe(sessionId, (evt) => {
    if (evt.type === 'agent.completed') resolveAgent();
  });

  const msgRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'I really do not understand why we use Softmax here. I do not know Softmax at all.',
    }),
  });
  assert.equal(msgRes.status, 202);
  await agentPromise;
  unAgent();

  // 3 & 4. Verify Tutor did NOT directly detour, but placed a diagnostic Probe on Canvas
  const probeSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const probeSnap = (await probeSnapRes.json()) as LearningSessionSnapshot;
  assert.equal(probeSnap.lesson.knowledgeNodeId, 'self-attention', 'Must remain on Self-Attention before diagnosis confirmation');

  const probeBlock = probeSnap.lesson.blocks.find(
    (b): b is QuizBlock => b.id.startsWith('probe-') || ('assessmentKind' in b && b.assessmentKind === 'probe')
  );
  assert.ok(probeBlock, 'Diagnostic probe block must be present on Canvas');
  assert.equal(probeBlock.targetKnowledgeNodeId, 'softmax');

  // 5. User submits misconception/incorrect answer to the diagnostic probe
  const probeAnsRes = await fetch(
    `${baseUrl}/api/lessons/${probeSnap.lesson.id}/blocks/${probeBlock.id}/answer?sessionId=${sessionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'wrong-guess' }),
    }
  );
  assert.equal(probeAnsRes.status, 200);
  const probeAnsBody = (await probeAnsRes.json()) as { assessment: { result: string; knowledgeNodeId: string } };
  assert.equal(probeAnsBody.assessment.result, 'incorrect');
  assert.equal(probeAnsBody.assessment.knowledgeNodeId, 'softmax', 'Evidence must target prerequisite softmax');

  // 6. Verify confirmed diagnosis caused automatic Replan -> Detour insertion & Canvas switch to Softmax
  const detourSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const detourSnap = (await detourSnapRes.json()) as LearningSessionSnapshot;
  const detourNode = detourSnap.path.find((n) => n.type === 'detour' && n.knowledgeNodeId === 'softmax');
  assert.ok(detourNode, 'Detour node for Softmax must be inserted in learning path');
  assert.equal(detourNode.status, 'current');
  assert.equal(detourSnap.lesson.knowledgeNodeId, 'softmax', 'Lesson Canvas must switch to Softmax lesson');

  // 7. Verify single correct answer cannot yield mastered
  const quiz1Res = await fetch(
    `${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz/answer?sessionId=${sessionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: 'Softmax ensures that each probability output forms a positive distribution and sum to exactly 1.',
      }),
    }
  );
  assert.equal(quiz1Res.status, 200);

  const midSnapRes1 = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const midSnap1 = (await midSnapRes1.json()) as LearningSessionSnapshot;
  const midDetour1 = midSnap1.path.find((n) => n.knowledgeNodeId === 'softmax');
  assert.equal(midDetour1?.status, 'current', 'Single correct answer must NEVER complete detour');

  // 8. Verify repeating same item yields diminishing returns and cannot master alone
  for (let i = 0; i < 5; i++) {
    await fetch(
      `${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz/answer?sessionId=${sessionId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: 'Softmax ensures that each probability output forms a positive distribution and sum to exactly 1.',
        }),
      }
    );
  }
  const midSnapRes2 = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const midSnap2 = (await midSnapRes2.json()) as LearningSessionSnapshot;
  const midDetour2 = midSnap2.path.find((n) => n.knowledgeNodeId === 'softmax');
  assert.equal(midDetour2?.status, 'current', 'Spamming single quiz item must NOT complete detour');

  // 9. Answer 2nd and 3rd distinct assessment items on Softmax
  const quiz2Res = await fetch(
    `${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz-2/answer?sessionId=${sessionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'opt-exp-1' }),
    }
  );
  assert.equal(quiz2Res.status, 200);

  const quiz3Res = await fetch(
    `${baseUrl}/api/lessons/lesson-softmax/blocks/softmax-quiz-3/answer?sessionId=${sessionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'opt-sum-1' }),
    }
  );
  assert.equal(quiz3Res.status, 200);

  // 10. Verify Softmax is mastered, detour completes, and original lesson resumes
  const resumedSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  assert.equal(resumedSnapRes.status, 200);
  const resumedSnap = (await resumedSnapRes.json()) as LearningSessionSnapshot;

  const completedDetour = resumedSnap.path.find((n) => n.knowledgeNodeId === 'softmax');
  const restoredMainNode = resumedSnap.path.find((n) => n.id === initialActiveNode.id);

  assert.equal(completedDetour?.status, 'completed', 'Detour node must be marked completed');
  assert.equal(restoredMainNode?.status, 'current', 'Self Attention main track node must be restored to current');
  assert.equal(resumedSnap.lesson.id, initialSnap.lesson.id, 'Canvas must restore original Self Attention lesson');

    // 11. True Server Restart: Close server & SQLite connection, then reopen with a new ServerContext on same DB
    await ctx.close();
    ctx = undefined;

    restartedCtx = await createServerContext(dbPath);
    const { promise: restartListenPromise, resolve: resolveRestartListen } = Promise.withResolvers<void>();
    restartedCtx.server.listen(0, '127.0.0.1', () => resolveRestartListen());
    await restartListenPromise;

    const restartAddress = restartedCtx.server.address();
    const restartPort = typeof restartAddress === 'object' && restartAddress ? restartAddress.port : 8787;
    const restartBaseUrl = `http://127.0.0.1:${restartPort}`;

    // 12. Verify all persistent state intact after restart via HTTP API
    const postRestartSnapRes = await fetch(`${restartBaseUrl}/api/sessions/${sessionId}`);
    assert.equal(postRestartSnapRes.status, 200);
    const postRestartSnap = (await postRestartSnapRes.json()) as LearningSessionSnapshot;

    const postRestartDetour = postRestartSnap.path.find((n) => n.knowledgeNodeId === 'softmax');
    const postRestartMain = postRestartSnap.path.find((n) => n.id === initialActiveNode.id);

    assert.equal(postRestartDetour?.status, 'completed', 'Completed detour status must survive server restart');
    assert.equal(postRestartMain?.status, 'current', 'Current main node must survive server restart');
    assert.equal(postRestartSnap.lesson.id, initialSnap.lesson.id, 'Resumed lesson ID must survive server restart');

    const softmaxState = restartedCtx.context.knowledgeService?.getUserKnowledgeState('default-user', 'softmax');
    assert.ok(softmaxState);
    assert.equal(softmaxState.status, 'mastered');
    assert.ok((softmaxState.effectiveEvidenceCount ?? 0) >= 3);
    assert.ok((softmaxState.distinctSourceItemCount ?? 0) >= 2);

    // Verify diagnosis resolution survived restart
    const diagnoses = restartedCtx.diagnosisRepo?.listDiagnosesBySession(sessionId) ?? [];
    const softmaxDiag = diagnoses.find((d: any) => d.knowledgeNodeId === 'softmax');
    assert.ok(softmaxDiag, 'Confirmed diagnosis must have survived restart for Softmax');
    assert.equal(softmaxDiag.status, 'resolved', 'Resolved diagnosis status must survive server restart');

  } finally {
    await restartedCtx?.close();
    await ctx?.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
});
