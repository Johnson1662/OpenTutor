import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from '@opentutor/database';
import { DomainToolsExecutor } from '@opentutor/agent-tools';
import { PiTutorRuntime } from '../src/index.ts';

test('packages/agent-runtime - Live Model Integration Test', async (t) => {
  const hasRealKey = Boolean(
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.LLM_API_KEY
  );

  if (!hasRealKey) {
    t.skip('No live API credentials provided in environment (ANTHROPIC_API_KEY, OPENAI_API_KEY). Cleanly skipped.');
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
      path: [{ id: 'p1', knowledgeNodeId: 'self-attention', title: 'Self-Attention', type: 'main' as const, status: 'current' as const, position: 1 }],
      pathVersion: 1,
    }),
    applyPathPatches: () => ({ path: [], newVersion: 2 }),
  };

  const toolsExecutor = new DomainToolsExecutor({
    lessonService: mockLessonService as any,
    sessionService: mockSessionService as any,
  });

  const runtime = new PiTutorRuntime(toolsExecutor, undefined, {
    runtimeMode: 'pi',
  });

  await t.test('Executes real turn with live AI model', async () => {
    const result = await runtime.runTurn({
      sessionId: 'live-test-session',
      message: 'Explain self-attention briefly in one sentence.',
    });

    assert.ok(result.reply);
    assert.ok(result.reply.length > 10);
  });
});
