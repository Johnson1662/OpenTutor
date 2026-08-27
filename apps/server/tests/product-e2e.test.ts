import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerContext } from '../src/index.ts';
import type {
  AcceptedResponse,
  LearningPathNode,
  LearningSessionSnapshot,
  Lesson,
} from '@opentutor/protocol';

test('Product E2E Golden Path v0.6: Usable AI Tutor MVP Full Lifecycle', async (t) => {
  process.env.OPENTUTOR_RUNTIME_MODE = 'fake';
  // 1. Start fresh server with in-memory SQLite database
  const context = await createServerContext(':memory:');
  const server = context.server;
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 8787;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  t.after(async () => {
    await context.close();
  });

  let sessionId = '';
  const getSessionSnapshot = async () =>
    (await (await fetch(`${baseUrl}/api/sessions/${sessionId}`)).json()) as LearningSessionSnapshot;

  const advanceActiveStep = async () => {
    const current = await getSessionSnapshot();
    assert.ok(current.lessonProgress);
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/lesson-progress/advance`, {
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

  const advanceUntilActive = async (lessonId: string, blockId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await getSessionSnapshot();
      assert.equal(current.lesson.id, lessonId);
      if (current.lessonProgress?.activeBlockId === blockId) return;
      await advanceActiveStep();
    }
    assert.fail(`Could not activate ${lessonId}/${blockId}`);
  };

  // 2. Configure AI Provider Preferences (HTTP PUT /api/ai/preferences)
  const prefRes = await fetch(`${baseUrl}/api/ai/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-opus-4-5',
      thinkingLevel: 'high',
    }),
  });
  assert.equal(prefRes.status, 200);
  const prefBody = (await prefRes.json()) as { defaultProviderId: string; defaultModelId: string };
  assert.equal(prefBody.defaultProviderId, 'anthropic');
  assert.equal(prefBody.defaultModelId, 'claude-opus-4-5');

  // 3. Create Course (HTTP POST /api/courses)
  const createCourseRes = await fetch(`${baseUrl}/api/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Mastering Transformer Architecture',
      description: 'From self-attention to multi-head layers and embeddings',
    }),
  });
  assert.equal(createCourseRes.status, 201);
  const { course } = (await createCourseRes.json()) as { course: { id: string; title: string } };
  assert.ok(course.id);

  // 4. Upload Course Materials (HTTP POST /api/courses/:id/sources)
  const source1Res = await fetch(`${baseUrl}/api/courses/${course.id}/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Attention Fundamentals.md',
      content: `# Self Attention
Self attention dynamically weights token representations across sequence context.
Softmax function converts unnormalized logits into valid probability distributions.

# Multi-Head Attention
Multi-head attention applies multiple self-attention projections in parallel.`,
    }),
  });
  assert.equal(source1Res.status, 201);

  // 5. Compile Course & Living Knowledge (HTTP POST /api/courses/:id/compile)
  const compileRes = await fetch(`${baseUrl}/api/courses/${course.id}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      learningGoal: 'I want to learn Transformer from scratch and master self-attention.',
    }),
  });
  if (compileRes.status !== 200) {
    console.error('Compile error body:', await compileRes.text());
  }
  assert.equal(compileRes.status, 200);
  const compileData = (await compileRes.json()) as {
    course: { compileStatus: string };
    snapshot: LearningSessionSnapshot;
  };
  assert.equal(compileData.course.compileStatus, 'ready');
  assert.ok(compileData.snapshot.sessionId);
  assert.ok(compileData.snapshot.path.length >= 2);

  sessionId = compileData.snapshot.sessionId;

  // 6. Inspect Course Map (HTTP GET /api/courses/:id/map)
  const mapRes = await fetch(`${baseUrl}/api/courses/${course.id}/map`);
  assert.equal(mapRes.status, 200);
  const mapData = (await mapRes.json()) as { map: { nodes: Array<{ title: string; position: number }> } };
  assert.ok(mapData.map.nodes.length >= 2);

  // 7. Verify Initial Generated Lesson
  const sessionRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  assert.equal(sessionRes.status, 200);
  const sessionSnap = (await sessionRes.json()) as LearningSessionSnapshot;
  assert.ok(sessionSnap.lesson.blocks.length >= 2);
  const quizBlock = sessionSnap.lesson.blocks.find((b) => b.type === 'quiz') as any;
  assert.ok(quizBlock);
  assert.ok(quizBlock.answerSpec);

  // 8. Socratic Tutor Interaction: Request Code Example (HTTP POST /api/sessions/:id/messages)
  const { promise: msgCompleted, resolve: resolveMsg } = Promise.withResolvers<void>();
  const unMsg = context.context.eventBus.subscribe(sessionId, (evt) => {
    if (evt.type === 'agent.completed') resolveMsg();
  });

  const msgRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Can you show me clean PyTorch code for attention?' }),
  });
  assert.equal(msgRes.status, 202);
  await msgCompleted;
  unMsg();

  // Verify code block injected on Lesson Canvas
  const updatedSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const updatedSnap = (await updatedSnapRes.json()) as LearningSessionSnapshot;
  assert.ok(updatedSnap.lesson.blocks.some((b) => b.type === 'code'));

  // 9. Socratic Tutor Action: Diagnostic Probing (HTTP POST /api/sessions/:id/actions & /answer)
  const { promise: actCompleted, resolve: resolveAct } = Promise.withResolvers<void>();
  const unAct = context.context.eventBus.subscribe(sessionId, (evt) => {
    if (evt.type === 'agent.completed') resolveAct();
  });

  const actRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'softmax_unknown' }),
  });
  assert.equal(actRes.status, 202);
  await actCompleted;
  unAct();

  // 9b. Verify probe on Canvas and submit misconception answer to confirm diagnosis
  const probeSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const probeSnap = (await probeSnapRes.json()) as LearningSessionSnapshot;
  const probeBlock = probeSnap.lesson.blocks.find((b) => b.id.startsWith('probe-') || ('assessmentKind' in b && b.assessmentKind === 'probe'));
  assert.ok(probeBlock, 'Diagnostic probe block placed on Canvas');

  const probeAnsRes = await fetch(`${baseUrl}/api/lessons/${probeSnap.lesson.id}/blocks/${probeBlock.id}/answer?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: 'wrong-guess' }),
  });
  assert.equal(probeAnsRes.status, 200);

  // 10. Verify Detour Active in Learning Path and Lesson Canvas Switched to Softmax
  const detourSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const detourSnap = (await detourSnapRes.json()) as LearningSessionSnapshot;
  const detourNode = detourSnap.path.find((n) => n.type === 'detour' && n.knowledgeNodeId === 'softmax');
  assert.ok(detourNode);
  assert.equal(detourNode.status, 'current');
  assert.equal(detourSnap.lesson.knowledgeNodeId, 'softmax');
  const detourLessonId = detourSnap.lesson.id;
  const detourQuizBlocks = detourSnap.lesson.blocks.filter((block) => block.type === 'quiz');
  assert.ok(detourQuizBlocks.length >= 3, 'Detour lesson exposes distinct assessment items');
  const answerDetourQuiz = async (blockId: string, answer: string) => {
    await advanceUntilActive(detourLessonId, blockId);
    return fetch(`${baseUrl}/api/lessons/${detourLessonId}/blocks/${blockId}/answer?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    });
  };

  // 11. Diagnostic Assessment Quiz Submission on distinct items (HTTP POST /api/lessons/:id/blocks/:id/answer)
  // Answer 1: Verify single answer does not prematurely complete the detour
  const quizAnswerRes1 = await answerDetourQuiz(
    detourQuizBlocks[0].id,
    'Softmax ensures that each probability output forms a positive distribution and sum to exactly 1.'
  );
  assert.equal(quizAnswerRes1.status, 200);
  const quizBody1 = (await quizAnswerRes1.json()) as { assessment: { result: string; confidence: number } };
  assert.equal(quizBody1.assessment.result, 'correct');
  assert.ok(quizBody1.assessment.confidence >= 0.25);

  const midSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  const midSnap = (await midSnapRes.json()) as LearningSessionSnapshot;
  const midDetour = midSnap.path.find((n) => n.knowledgeNodeId === 'softmax');
  assert.equal(midDetour?.status, 'current');

  // Answer 2 & 3: Accumulate distinct evidence to meet mastery threshold (distinctSourceItemCount >= 2, effectiveEvidenceCount >= 3, and p >= 0.85)
  const quizAnswerRes2 = await answerDetourQuiz(
    detourQuizBlocks[1].id,
    'opt-exp-1'
  );
  assert.equal(quizAnswerRes2.status, 200);

  const quizAnswerRes3 = await answerDetourQuiz(
    detourQuizBlocks[2].id,
    'opt-sum-1'
  );
  assert.equal(quizAnswerRes3.status, 200);

  // 12. Verify Automatic Detour Resume on Main Track
  const resumedSnapRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
  assert.equal(resumedSnapRes.status, 200);
  const resumedSnap = (await resumedSnapRes.json()) as LearningSessionSnapshot;

  const completedDetour = resumedSnap.path.find((n) => n.knowledgeNodeId === 'softmax');
  const mainActiveNode = sessionSnap.path.find((n) => n.status === 'current')!;
  const restoredMainNode = resumedSnap.path.find((n) => n.id === mainActiveNode.id);

  assert.equal(completedDetour?.status, 'completed');
  assert.equal(restoredMainNode?.status, 'current');
  assert.equal(resumedSnap.lesson.id, sessionSnap.lesson.id);
});
