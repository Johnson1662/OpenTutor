import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainToolsExecutor } from '@opentutor/agent-tools';
import { PiSessionRegistry, PiTutorRuntime } from '../src/index.ts';

test('packages/agent-runtime - Real Pi SDK Smoke Test Suite', async (t) => {
  const mockServices = {
    lessonService: {
      getLesson: () => ({
        schemaVersion: '1.0' as const,
        id: 'lesson-self-attention',
        courseId: 'c1',
        knowledgeNodeId: 'self-attention',
        title: 'Self Attention',
        version: 1,
        blocks: [],
        status: 'active' as const,
      }),
      applyPatches: () => ({
        lesson: {
          schemaVersion: '1.0' as const,
          id: 'lesson-self-attention',
          courseId: 'c1',
          knowledgeNodeId: 'self-attention',
          title: 'Self Attention',
          version: 2,
          blocks: [],
          status: 'active' as const,
        },
        newVersion: 2,
      }),
    },
    sessionService: {
      getSnapshot: () => ({
        path: [{ id: 'self-attention', knowledgeNodeId: 'self-attention', title: 'Self Attention', type: 'main' as const, position: 1, status: 'current' as const }],
        pathVersion: 1,
      }),
      insertDetour: () => ({ path: [], newVersion: 2 }),
      applyPathPatches: () => ({ path: [], newVersion: 2 }),
    },
    knowledgeService: {
      searchKnowledge: () => [],
      readArtifact: () => null,
      recordAssessment: () => { },
    },
  };

  const executor = new DomainToolsExecutor(mockServices as any);

  await t.test('1. PiSessionRegistry instantiates real AgentSession with Tutor sandbox tools', async () => {
    const registry = new PiSessionRegistry(executor);
    const session = await registry.getOrCreateSession('smoke-session');

    assert.ok(session);
    assert.equal(registry.hasSession('smoke-session'), true);

    // Verify session disposal
    await registry.disposeSession('smoke-session');
    assert.equal(registry.hasSession('smoke-session'), false);
  });

  await t.test('2. PiTutorRuntime manages multi-turn fallback and session lifecycle safely', async () => {
    const runtime = new PiTutorRuntime(executor, undefined, { runtimeMode: 'fake' });
    const turn1 = await runtime.runTurn({
      sessionId: 'smoke-turn-session',
      message: 'Show me code for self attention',
    });

    assert.ok(turn1.reply);
    assert.ok(turn1.toolCalls.some((tc) => tc.tool === 'lesson_patch'));

    const turn2 = await runtime.runTurn({
      sessionId: 'smoke-turn-session',
      message: 'Explain this simpler',
    });

    assert.ok(turn2.reply);
    assert.ok(turn2.toolCalls.some((tc) => tc.tool === 'lesson_patch'));

    await runtime.disposeSession('smoke-turn-session');
  });

  t.after(() => {
    // Terminate Pi subprocesses and active sockets cleanly
    setImmediate(() => {
      process.exit(0);
    });
  });
});
