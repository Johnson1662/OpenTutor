import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainToolsExecutor,
  TUTOR_TOOL_DEFINITIONS,
  TUTOR_TOOL_NAMES,
  type DomainServicesContext,
} from '../src/index.ts';
import type { Lesson, LearningPathNode } from '@opentutor/protocol';

test('packages/tutor-tools - Definitions & Executor Suite', async (t) => {
  await t.test('1. Tool definitions and metadata integrity', () => {
    assert.equal(TUTOR_TOOL_DEFINITIONS.length, 10);
    assert.equal(TUTOR_TOOL_NAMES.size, 10);

    const expectedNames = [
      'lesson_get',
      'lesson_patch',
      'path_get',
      'path_insert_detour',
      'path_advance',
      'knowledge_search',
      'artifact_read',
      'source_search',
      'source_read',
      'graph_neighbors',
    ];

    for (const name of expectedNames) {
      assert.ok(TUTOR_TOOL_NAMES.has(name), `Missing expected tool: ${name}`);
      const def = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === name);
      assert.ok(def, `Missing definition for: ${name}`);
      assert.ok(def.description.length > 0);
      assert.ok(def.parameters);
    }

    // Disallowed legacy tools
    assert.equal(TUTOR_TOOL_NAMES.has('session_get'), false);
    assert.equal(TUTOR_TOOL_NAMES.has('path_patch'), false);
    assert.equal(TUTOR_TOOL_NAMES.has('assessment_record'), false);

    // Metadata checks
    const lessonGetDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'lesson_get')!;
    assert.equal(lessonGetDef.category, 'lesson');
    assert.equal(lessonGetDef.retrieval, false);
    assert.equal(lessonGetDef.retrievalCost, 0);
    assert.equal(lessonGetDef.mutation, false);

    const pathGetDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'path_get')!;
    assert.equal(pathGetDef.category, 'path');
    assert.equal(pathGetDef.retrieval, false);
    assert.equal(pathGetDef.retrievalCost, 0);
    assert.equal(pathGetDef.mutation, false);

    const lessonPatchDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'lesson_patch')!;
    assert.equal(lessonPatchDef.category, 'lesson');
    assert.equal(lessonPatchDef.retrieval, false);
    assert.equal(lessonPatchDef.retrievalCost, 0);
    assert.equal(lessonPatchDef.mutation, true);

    const knowledgeSearchDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'knowledge_search')!;
    assert.equal(knowledgeSearchDef.category, 'knowledge');
    assert.equal(knowledgeSearchDef.retrieval, true);
    assert.equal(knowledgeSearchDef.retrievalCost, 1);
    assert.equal(knowledgeSearchDef.mutation, false);

    const artifactReadDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'artifact_read')!;
    assert.equal(artifactReadDef.retrieval, true);
    assert.equal(artifactReadDef.retrievalCost, 1);

    const sourceSearchDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'source_search')!;
    assert.equal(sourceSearchDef.retrieval, true);
    assert.equal(sourceSearchDef.retrievalCost, 1);

    const sourceReadDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'source_read')!;
    assert.equal(sourceReadDef.retrieval, true);
    assert.equal(sourceReadDef.retrievalCost, 1);

    const graphNeighborsDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === 'graph_neighbors')!;
    assert.equal(graphNeighborsDef.retrieval, true);
    assert.equal(graphNeighborsDef.retrievalCost, 1);
  });

  const mockLesson: Lesson = {
    schemaVersion: '1.0',
    id: 'lesson-1',
    courseId: 'transformer',
    knowledgeNodeId: 'attention-mechanisms',
    title: 'Attention Mechanisms',
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
      getLessonBySession: (sid) => (sid === 's1' ? mockLesson : null),
      applyPatches: (_sid, _lid, baseVersion) => {
        if (baseVersion !== 1) {
          const err = new Error('Version conflict: baseVersion mismatch');
          err.name = 'VersionConflictError';
          throw err;
        }
        return {
          lesson: { ...mockLesson, version: baseVersion + 1 },
          newVersion: baseVersion + 1,
        };
      },
    },
    sessionService: {
      getSnapshot: (sid) =>
        sid === 's1'
          ? { lesson: mockLesson, path: initialPath, pathVersion: 1 }
          : null,
      insertDetour: (_sid, baseVersion, detour) => {
        if (baseVersion !== 1) {
          const err = new Error('Version conflict');
          err.name = 'VersionConflictError';
          throw err;
        }
        return {
          path: [
            {
              id: detour.id,
              knowledgeNodeId: detour.knowledgeNodeId,
              title: detour.title,
              type: 'detour',
              status: 'current',
              position: 0,
            },
            { id: 'p1', knowledgeNodeId: 'n1', title: 'Node 1', type: 'main', status: 'upcoming', position: 1 },
          ],
          newVersion: baseVersion + 1,
        };
      },
      completeCurrentNode: (_sid, baseVersion) => {
        if (baseVersion !== 1) {
          const err = new Error('Version conflict');
          err.name = 'VersionConflictError';
          throw err;
        }
        return {
          path: [
            { id: 'p1', knowledgeNodeId: 'n1', title: 'Node 1', type: 'main', status: 'completed', position: 0 },
            { id: 'p2', knowledgeNodeId: 'n2', title: 'Node 2', type: 'main', status: 'current', position: 1 },
          ],
          newVersion: baseVersion + 1,
        };
      },
    },
    knowledgeService: {
      searchKnowledge: (q, limit) => [{ id: 'k1', title: q, limit }],
      readArtifact: (id) => (id === 'attention-mechanisms' ? { id, title: 'Attention Artifact' } : null),
      sourceSearch: (q, limit) => [{ chunkId: 'c1', query: q, limit }],
      sourceRead: (id) => (id === 'c1' ? { id: 'c1', content: 'Chunk text' } : null),
      getNeighbors: (id, direction) => [{ nodeId: id, direction: direction ?? 'all' }],
    },
  };

  const executor = new DomainToolsExecutor(mockServices);

  await t.test('2. Schema validation with TypeBox', async () => {
    // Missing required field
    const missingQuery = await executor.executeTool('s1', 'knowledge_search', {});
    assert.equal(missingQuery.success, false);
    if (!missingQuery.success) {
      assert.equal(missingQuery.error.code, 'INVALID_ARGUMENT');
    }

    // Number constraint violation: limit > 20
    const exceededLimit = await executor.executeTool('s1', 'knowledge_search', { query: 'attn', limit: 25 });
    assert.equal(exceededLimit.success, false);
    if (!exceededLimit.success) {
      assert.equal(exceededLimit.error.code, 'INVALID_ARGUMENT');
    }

    // Number constraint violation: limit < 1
    const subMinLimit = await executor.executeTool('s1', 'knowledge_search', { query: 'attn', limit: 0 });
    assert.equal(subMinLimit.success, false);
    if (!subMinLimit.success) {
      assert.equal(subMinLimit.error.code, 'INVALID_ARGUMENT');
    }

    // Invalid direction enum
    const invalidDirection = await executor.executeTool('s1', 'graph_neighbors', {
      nodeId: 'n1',
      direction: 'invalid_dir',
    });
    assert.equal(invalidDirection.success, false);
    if (!invalidDirection.success) {
      assert.equal(invalidDirection.error.code, 'INVALID_ARGUMENT');
    }

    // Missing nodeId on artifact_read
    const missingNodeId = await executor.executeTool('s1', 'artifact_read', {});
    assert.equal(missingNodeId.success, false);
    if (!missingNodeId.success) {
      assert.equal(missingNodeId.error.code, 'INVALID_ARGUMENT');
    }

    // Invalid patch operation in lesson_patch
    const invalidPatch = await executor.executeTool('s1', 'lesson_patch', {
      lessonId: 'lesson-1',
      baseVersion: 1,
      patches: [{ op: 'unknown_op', blockId: 'b1' }],
    });
    assert.equal(invalidPatch.success, false);
    if (!invalidPatch.success) {
      assert.equal(invalidPatch.error.code, 'INVALID_ARGUMENT');
    }
  });

  await t.test('3. Successful execution across all 10 tools', async () => {
    // 1. lesson_get with lessonId
    const l1 = await executor.executeTool('s1', 'lesson_get', { lessonId: 'lesson-1' });
    assert.equal(l1.success, true);
    if (l1.success) {
      assert.equal((l1.data as Lesson).id, 'lesson-1');
    }

    // 1b. lesson_get with default active lesson
    const l1Default = await executor.executeTool('s1', 'lesson_get', {});
    assert.equal(l1Default.success, true);
    if (l1Default.success) {
      assert.equal((l1Default.data as Lesson).id, 'lesson-1');
    }

    // 2. lesson_patch
    const patchRes = await executor.executeTool('s1', 'lesson_patch', {
      lessonId: 'lesson-1',
      baseVersion: 1,
      patches: [
        {
          op: 'insert',
          block: { id: 'b1', type: 'text', content: 'Attention is a mechanism.' },
          position: { index: 0 },
        },
      ],
    });
    assert.equal(patchRes.success, true);
    if (patchRes.success) {
      assert.equal((patchRes.data as { newVersion: number }).newVersion, 2);
    }

    // 3. path_get
    const pathRes = await executor.executeTool('s1', 'path_get', {});
    assert.equal(pathRes.success, true);
    if (pathRes.success) {
      const data = pathRes.data as { path: LearningPathNode[]; version: number };
      assert.equal(data.version, 1);
      assert.equal(data.path.length, 2);
    }

    // 4. path_insert_detour
    const detourRes = await executor.executeTool('s1', 'path_insert_detour', {
      detourKnowledgeNodeId: 'softmax',
      detourTitle: 'Softmax Review',
      note: 'Found gap in knowledge',
    });
    assert.equal(detourRes.success, true);
    if (detourRes.success) {
      const data = detourRes.data as { path: LearningPathNode[]; newVersion: number };
      assert.equal(data.newVersion, 2);
      assert.equal(data.path[0]?.type, 'detour');
      assert.equal(data.path[0]?.status, 'current');
    }

    // 5. path_advance
    const advanceRes = await executor.executeTool('s1', 'path_advance', {});
    assert.equal(advanceRes.success, true);
    if (advanceRes.success) {
      const data = advanceRes.data as { path: LearningPathNode[]; newVersion: number };
      assert.equal(data.newVersion, 2);
      assert.equal(data.path[0]?.status, 'completed');
    }

    // 6. knowledge_search
    const kSearchRes = await executor.executeTool('s1', 'knowledge_search', { query: 'attention', limit: 3 });
    assert.equal(kSearchRes.success, true);

    // 7. artifact_read
    const artRes = await executor.executeTool('s1', 'artifact_read', { nodeId: 'attention-mechanisms' });
    assert.equal(artRes.success, true);

    // 8. source_search
    const srcSearchRes = await executor.executeTool('s1', 'source_search', { query: 'attention', limit: 2 });
    assert.equal(srcSearchRes.success, true);

    // 9. source_read
    const srcReadRes = await executor.executeTool('s1', 'source_read', { chunkId: 'c1' });
    assert.equal(srcReadRes.success, true);

    // 10. graph_neighbors
    const graphRes = await executor.executeTool('s1', 'graph_neighbors', {
      nodeId: 'attention-mechanisms',
      direction: 'prerequisites',
    });
    assert.equal(graphRes.success, true);
  });

  await t.test('4. Version conflict handling', async () => {
    const conflictRes = await executor.executeTool('s1', 'lesson_patch', {
      lessonId: 'lesson-1',
      baseVersion: 99,
      patches: [],
    });
    assert.equal(conflictRes.success, false);
    if (!conflictRes.success) {
      assert.equal(conflictRes.error.code, 'VERSION_CONFLICT');
    }
  });

  await t.test('5. Not found & unavailable domain capabilities', async () => {
    const notFoundArtifact = await executor.executeTool('s1', 'artifact_read', { nodeId: 'non-existent' });
    assert.equal(notFoundArtifact.success, false);
    if (!notFoundArtifact.success) {
      assert.equal(notFoundArtifact.error.code, 'NOT_FOUND');
    }

    const bareExecutor = new DomainToolsExecutor({
      lessonService: mockServices.lessonService,
      sessionService: mockServices.sessionService,
    });

    const noKnowledgeRes = await bareExecutor.executeTool('s1', 'knowledge_search', { query: 'test' });
    assert.equal(noKnowledgeRes.success, false);
    if (!noKnowledgeRes.success) {
      assert.equal(noKnowledgeRes.error.code, 'DOMAIN_CAPABILITY_UNAVAILABLE');
    }
  });

  await t.test('6. Disallowed & unknown tools rejected', async () => {
    const sessionGetRes = await executor.executeTool('s1', 'session_get', {});
    assert.equal(sessionGetRes.success, false);
    if (!sessionGetRes.success) {
      assert.equal(sessionGetRes.error.code, 'INVALID_ARGUMENT');
    }

    const pathPatchRes = await executor.executeTool('s1', 'path_patch', { patches: [] });
    assert.equal(pathPatchRes.success, false);
    if (!pathPatchRes.success) {
      assert.equal(pathPatchRes.error.code, 'INVALID_ARGUMENT');
    }

    const asmtRes = await executor.executeTool('s1', 'assessment_record', { result: 'correct' });
    assert.equal(asmtRes.success, false);
    if (!asmtRes.success) {
      assert.equal(asmtRes.error.code, 'INVALID_ARGUMENT');
    }
  });
});
