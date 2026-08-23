import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorAgent } from '../src/index.ts';
import { DomainToolsExecutor } from '@opentutor/tutor-tools';

test('packages/agent-runtime - TutorAgent execution & fallback loop', async (t) => {
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
        path: [
          {
            id: 'pn-2',
            knowledgeNodeId: 'self-attention',
            title: 'Self Attention',
            type: 'main' as const,
            position: 2,
            status: 'completed' as const,
          },
        ],
        pathVersion: 1,
      }),
      insertDetour: () => ({ path: [], newVersion: 2 }),
      applyPathPatches: () => ({ path: [], newVersion: 2 }),
    },
    knowledgeService: {
      searchKnowledge: () => [],
      readArtifact: () => null,
    },
  };

  const executor = new DomainToolsExecutor(mockServices);
  const agent = new TutorAgent(executor);

  await t.test('1. User asks for code -> agent invokes lesson_patch with CodeBlock', async () => {
    let textReceived = '';
    const result = await agent.run(
      'prototype',
      'Can you explain self attention with python code?',
      (delta) => {
        textReceived += delta;
      }
    );

    assert.ok(result.reply.includes('PyTorch'));
    assert.equal(textReceived, result.reply);
    assert.ok(result.toolCalls.some((tc) => tc.tool === 'lesson_patch'));
  });

  await t.test(
    '2. User asks for simpler intuition -> agent invokes lesson_patch with callout',
    async () => {
      const result = await agent.run('prototype', 'Please explain this simpler with an analogy');
      assert.ok(result.toolCalls.some((tc) => tc.tool === 'lesson_patch'));
    }
  );

  await t.test(
    '3. User indicates prerequisite gap -> agent invokes path_insert_detour',
    async () => {
      const result = await agent.run('prototype', 'I do not understand Softmax yet');
      assert.ok(result.toolCalls.some((tc) => tc.tool === 'path_insert_detour'));
    }
  );
});
