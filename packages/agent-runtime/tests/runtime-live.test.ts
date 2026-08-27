import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from '@opentutor/database';
import { DomainToolsExecutor } from '@opentutor/tutor-tools';
import { createOpenTutorModelRuntime } from '@opentutor/model-runtime';
import { PiTutorRuntime } from '../src/index.ts';

test('packages/agent-runtime - Live Model Integration Test', {
  skip: process.env.OPENTUTOR_RUN_LIVE !== '1',
}, async (t) => {
  const modelRuntime = await createOpenTutorModelRuntime();
  const available = await modelRuntime.getAvailable();

  if (available.length === 0) {
    t.skip('No live AI credentials or models available');
    return;
  }
  const preferredProvider = process.env.OPENTUTOR_DEFAULT_PROVIDER;
  const preferredModel = process.env.OPENTUTOR_DEFAULT_MODEL;
  const selectedModel = available.find((model) =>
    (!preferredProvider || model.provider === preferredProvider) &&
    (!preferredModel || model.id === preferredModel)
  ) ?? available[0];
  if (!selectedModel) {
    t.skip('MODEL_SETUP_REQUIRED: configured live model is unavailable');
    return;
  }

  const db = createDatabase(':memory:');
  seedDatabase(db);

  const mockLessonService = {
    getLesson: () => ({
      schemaVersion: '1.0' as const,
      id: 'lesson-self-attention',
      courseId: 'transformer',
      knowledgeNodeId: 'self-attention',
      title: 'Self-Attention',
      version: 1,
      blocks: [],
      status: 'active' as const,
    }),
    applyPatches: () => ({
      lesson: {
        schemaVersion: '1.0' as const,
        id: 'lesson-self-attention',
        courseId: 'transformer',
        knowledgeNodeId: 'self-attention',
        title: 'Self-Attention',
        version: 2,
        blocks: [],
        status: 'active' as const,
      },
      newVersion: 2,
    }),
  };

  const mockSessionService = {
    getSnapshot: () => ({
      path: [
        {
          id: 'p1',
          knowledgeNodeId: 'self-attention',
          title: 'Self-Attention',
          type: 'main' as const,
          status: 'current' as const,
          position: 1,
        },
      ],
      pathVersion: 1,
    }),
    applyPathPatches: () => ({ path: [], newVersion: 2 }),
  };

  const toolsExecutor = new DomainToolsExecutor({
    lessonService: mockLessonService,
    sessionService: mockSessionService,
  });

  const runtime = new PiTutorRuntime(toolsExecutor, undefined, {
    modelRuntime,
    model: selectedModel,
    runtimeMode: 'pi',
  });

  const sessionId = 'live-multi-turn-test-session';

  await t.test(
    'Executes multi-turn conversation preserving persistent session context',
    async () => {
      // Turn 1: Seed a unique nonce token in conversation context
      const turn1Result = await runtime.runTurn({
        sessionId,
        message:
          'For this self-attention lesson, remember the study marker OT-7391. Confirm the marker and connect it to the current lesson.',
      });

      assert.ok(turn1Result.reply);
      assert.ok(turn1Result.reply.length > 0);

      // Turn 2: Query the agent for the verification code across turns
      const turn2Result = await runtime.runTurn({
        sessionId,
        message:
          'What study marker did I give you for this self-attention lesson? Reply with the marker.',
      });

      assert.ok(turn2Result.reply);
      assert.ok(
        turn2Result.reply.includes('OT-7391') || turn2Result.reply.includes('7391'),
        `Turn 2 response must recall study marker OT-7391. Got: ${turn2Result.reply}`
      );
    }
  );

  t.after(async () => {
    await runtime.disposeSession(sessionId);
  });
});
