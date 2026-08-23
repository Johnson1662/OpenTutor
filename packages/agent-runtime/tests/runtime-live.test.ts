import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from '@opentutor/database';
import { DomainToolsExecutor } from '@opentutor/tutor-tools';
import { createOpenTutorModelRuntime } from '@opentutor/model-runtime';
import { PiTutorRuntime } from '../src/index.ts';

test('packages/agent-runtime - Live Model Integration Test', async (t) => {
  const modelRuntime = await createOpenTutorModelRuntime();
  const available = await modelRuntime.getAvailable();

  if (available.length === 0) {
    t.skip('No live AI credentials or models available');
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
    model: available[0],
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
          'Please remember this secret test verification code: OT-7391. Reply acknowledging you remembered it.',
      });

      assert.ok(turn1Result.reply);
      assert.ok(turn1Result.reply.length > 0);

      // Turn 2: Query the agent for the verification code across turns
      const turn2Result = await runtime.runTurn({
        sessionId,
        message:
          'What was the secret test verification code I just told you to remember? Reply with the code.',
      });

      assert.ok(turn2Result.reply);
      assert.ok(
        turn2Result.reply.includes('OT-7391') || turn2Result.reply.includes('7391'),
        `Turn 2 response must recall session memory code OT-7391. Got: ${turn2Result.reply}`
      );
    }
  );

  t.after(async () => {
    await runtime.disposeSession(sessionId);
  });
});
