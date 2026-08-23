import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainToolsExecutor, DOMAIN_TOOLS_DEFINITIONS } from '../src/index.ts';
import type { DomainServicesContext } from '../src/executor.ts';
import type { Lesson, LearningPathNode } from '@opentutor/protocol';

test('packages/agent-tools - Segregated domain tools and executor', async (t) => {
  assert.ok(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'path_insert_detour'));
  assert.ok(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'path_advance'));
  assert.ok(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'knowledge_search'));
  assert.ok(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'artifact_read'));
  assert.ok(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'source_search'));
  assert.ok(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'source_read'));
  assert.ok(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'graph_neighbors'));

  // Assessment tool must NOT be in Tutor Agent definitions
  assert.equal(DOMAIN_TOOLS_DEFINITIONS.some((d) => d.function.name === 'assessment_record'), false);

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

  const initialPath: LearningPathNode[] = [
    { id: 'p1', knowledgeNodeId: 'n1', title: 'Node 1', type: 'main', status: 'current', position: 0 },
    { id: 'p2', knowledgeNodeId: 'n2', title: 'Node 2', type: 'main', status: 'upcoming', position: 1 },
  ];

  const mockServices: DomainServicesContext = {
    lessonService: {
      getLesson: (id) => (id === 'lesson-1' ? mockLesson : null),
      applyPatches: (_sid, _lid, baseVersion) => ({
        lesson: { ...mockLesson, version: baseVersion + 1 },
        newVersion: baseVersion + 1,
      }),
    },
    sessionService: {
      getSnapshot: () => ({ path: initialPath, pathVersion: 1 }),
      applyPathPatches: (_sid, baseVersion) => ({ path: [], newVersion: baseVersion + 1 }),
      insertDetour: (_sid, baseVersion, detour) => ({
        path: [
          { id: detour.id, knowledgeNodeId: detour.knowledgeNodeId, title: detour.title, type: 'detour', status: 'current', position: 0 },
          { id: 'p1', knowledgeNodeId: 'n1', title: 'Node 1', type: 'main', status: 'upcoming', position: 1 },
        ],
        newVersion: baseVersion + 1,
      }),
      completeCurrentNode: (_sid, baseVersion) => ({
        path: [
          { id: 'p1', knowledgeNodeId: 'n1', title: 'Node 1', type: 'main', status: 'completed', position: 0 },
          { id: 'p2', knowledgeNodeId: 'n2', title: 'Node 2', type: 'main', status: 'current', position: 1 },
        ],
        newVersion: baseVersion + 1,
      }),
    },
    knowledgeService: {
      searchKnowledge: (q) => [{ id: 'k1', title: q, summary: 'summary' }],
      readArtifact: (id) => ({ id, title: 'Artifact' }),
      sourceSearch: (q) => [{ chunkId: 'c1', snippet: `Match for ${q}` }],
      sourceRead: (id) => (id === 'c1' ? { id: 'c1', content: 'Chunk text' } : null),
      getNeighbors: (id) => [{ nodeId: 'n2', relation: 'prerequisite' }],
    },
  };

  const executor = new DomainToolsExecutor(mockServices);

  await t.test('1. path_insert_detour inserts detour and updates focus', async () => {
    const res = await executor.executeTool('s1', 'path_insert_detour', {
      sessionId: 's1',
      baseVersion: 1,
      knowledgeNodeId: 'softmax',
      title: 'Softmax Details',
    });
    assert.equal(res.success, true);
    const data = res.data as { path: LearningPathNode[]; newVersion: number };
    assert.equal(data.newVersion, 2);
    assert.equal(data.path[0]?.type, 'detour');
    assert.equal(data.path[0]?.status, 'current');
  });

  await t.test('2. All 5 retrieval tools execute against real domain service', async () => {
    const searchRes = await executor.executeTool('s1', 'knowledge_search', { query: 'Softmax' });
    assert.equal(searchRes.success, true);

    const artifactRes = await executor.executeTool('s1', 'artifact_read', { knowledgeNodeId: 'softmax' });
    assert.equal(artifactRes.success, true);

    const sourceSearchRes = await executor.executeTool('s1', 'source_search', { query: 'Softmax' });
    assert.equal(sourceSearchRes.success, true);

    const sourceReadRes = await executor.executeTool('s1', 'source_read', { chunkId: 'c1' });
    assert.equal(sourceReadRes.success, true);

    const neighborsRes = await executor.executeTool('s1', 'graph_neighbors', { knowledgeNodeId: 'softmax' });
    assert.equal(neighborsRes.success, true);
  });

  await t.test('3. Zero fake fallback: errors out when knowledge service is missing', async () => {
    const bareExecutor = new DomainToolsExecutor({
      lessonService: mockServices.lessonService,
      sessionService: mockServices.sessionService,
    });

    const searchRes = await bareExecutor.executeTool('s1', 'knowledge_search', { query: 'Softmax' });
    assert.equal(searchRes.success, false);
    assert.ok(searchRes.error?.includes('Knowledge service not available'));

    const readRes = await bareExecutor.executeTool('s1', 'source_read', { chunkId: 'c1' });
    assert.equal(readRes.success, false);
    assert.ok(readRes.error?.includes('Source read service not available'));
  });

  await t.test('4. assessment_record is disallowed for Tutor Agent', async () => {
    const res = await executor.executeTool('s1', 'assessment_record', { result: 'correct' });
    assert.equal(res.success, false);
    assert.ok(res.error?.includes('Unauthorized') || res.error?.includes('Unknown'));
  });
});
