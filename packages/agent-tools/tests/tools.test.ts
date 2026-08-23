import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainToolsExecutor, DOMAIN_TOOLS_DEFINITIONS } from '../src/index.ts';
import type { DomainServicesContext } from '../src/executor.ts';
import type { Lesson } from '@opentutor/protocol';

test('packages/agent-tools - Domain tools definitions and execution', async (t) => {
  assert.equal(DOMAIN_TOOLS_DEFINITIONS.length, 6);

  const mockLesson: Lesson = {
    schemaVersion: '1.0',
    id: 'lesson-1',
    courseId: 'course-1',
    knowledgeNodeId: 'node-1',
    title: 'Test Lesson',
    version: 1,
    blocks: [],
    status: 'active',
  };

  const mockServices: DomainServicesContext = {
    lessonService: {
      getLesson: (id) => (id === 'lesson-1' ? mockLesson : null),
      applyPatches: (_sid, _lid, baseVersion, patches) => ({
        lesson: { ...mockLesson, version: baseVersion + 1 },
        newVersion: baseVersion + 1,
      }),
    },
    sessionService: {
      getSnapshot: () => ({ path: [{ id: 'p1', position: 1, status: 'current' }], pathVersion: 1 }),
      applyPathPatches: (_sid, baseVersion) => ({ path: [], newVersion: baseVersion + 1 }),
    },
    knowledgeService: {
      recordAssessment: () => {},
    },
  };

  const executor = new DomainToolsExecutor(mockServices);

  await t.test('1. lesson_get retrieves existing lesson', async () => {
    const res = await executor.executeTool('s1', 'lesson_get', { lessonId: 'lesson-1' });
    assert.equal(res.success, true);
    assert.deepEqual(res.data, mockLesson);
  });

  await t.test('2. lesson_patch applies patches atomically', async () => {
    const res = await executor.executeTool('s1', 'lesson_patch', {
      lessonId: 'lesson-1',
      baseVersion: 1,
      patches: [{ op: 'insert', position: { index: 0 }, block: { id: 'b1', type: 'text', variant: 'paragraph', content: 'hi' } }],
    });
    assert.equal(res.success, true);
  });

  await t.test('3. path_get and path_patch execute correctly', async () => {
    const getRes = await executor.executeTool('s1', 'path_get', { sessionId: 's1' });
    assert.equal(getRes.success, true);

    const patchRes = await executor.executeTool('s1', 'path_patch', {
      sessionId: 's1',
      baseVersion: 1,
      patches: [{ op: 'remove_node', nodeId: 'p1' }],
    });
    assert.equal(patchRes.success, true);
  });

  await t.test('4. assessment_record succeeds with diagnostic data', async () => {
    const res = await executor.executeTool('s1', 'assessment_record', {
      knowledgeNodeId: 'node-1',
      lessonId: 'lesson-1',
      result: 'correct',
      confidence: 0.95,
      feedback: 'Good job',
    });
    assert.equal(res.success, true);
  });

  await t.test('5. unknown tool returns clean error', async () => {
    const res = await executor.executeTool('s1', 'dangerous_shell_exec', { cmd: 'rm -rf /' });
    assert.equal(res.success, false);
    assert.ok(res.error?.includes('Unknown tool'));
  });
});
