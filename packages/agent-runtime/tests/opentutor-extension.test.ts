import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTOR_TOOL_DEFINITIONS,
  TUTOR_TOOL_NAMES,
  DomainToolsExecutor,
} from '@opentutor/tutor-tools';
import { createOpenTutorExtension } from '../src/index.ts';

test('packages/agent-runtime - OpenTutor Pi Extension & Tool Registration', async (t) => {
  const mockServices = {
    lessonService: {
      getLesson: (id: string) => ({
        schemaVersion: '1.0' as const,
        id,
        courseId: 'c1',
        knowledgeNodeId: 'node-1',
        title: 'Test Lesson',
        version: 1,
        blocks: [],
        status: 'active' as const,
      }),
      applyPatches: (
        _sessionId: string,
        lessonId: string,
        baseVersion: number,
        _patches: unknown[]
      ) => ({
        lesson: {
          schemaVersion: '1.0' as const,
          id: lessonId,
          courseId: 'c1',
          knowledgeNodeId: 'node-1',
          title: 'Test Lesson',
          version: baseVersion + 1,
          blocks: [],
          status: 'active' as const,
        },
        newVersion: baseVersion + 1,
      }),
    },
    sessionService: {
      getSnapshot: (_sessionId: string) => ({
        path: [
          {
            id: 'node-1',
            knowledgeNodeId: 'node-1',
            title: 'Node 1',
            type: 'main' as const,
            position: 1,
            status: 'current' as const,
          },
        ],
        pathVersion: 1,
      }),
      insertDetour: (
        _sessionId: string,
        baseVersion: number,
        detour: { id: string; knowledgeNodeId: string; title: string; note?: string }
      ) => ({
        path: [
          {
            id: detour.id,
            knowledgeNodeId: detour.knowledgeNodeId,
            title: detour.title,
            type: 'detour' as const,
            position: 1,
            status: 'current' as const,
            note: detour.note,
          },
        ],
        newVersion: baseVersion + 1,
      }),
      completeCurrentNode: (_sessionId: string, baseVersion: number) => ({
        path: [],
        newVersion: baseVersion + 1,
      }),
    },
    knowledgeService: {
      searchKnowledge: (query: string) => [{ id: 'k1', title: `Result for ${query}` }],
      readArtifact: (nodeId: string) => ({ nodeId, content: 'Compiled artifact' }),
      sourceSearch: (query: string) => [{ chunkId: 'c1', content: `Evidence for ${query}` }],
      sourceRead: (chunkId: string) => ({ chunkId, text: 'Verbatim chunk content' }),
      getNeighbors: (nodeId: string) => ({ nodeId, neighbors: [] }),
    },
  };

  const executor = new DomainToolsExecutor(mockServices as any);

  await t.test('1. Extension registers exact 10 tools from TUTOR_TOOL_DEFINITIONS', () => {
    const registeredTools = new Map<string, any>();
    const registeredHandlers = new Map<string, Function[]>();

    const fakePi: any = {
      registerTool: (toolDef: any) => {
        registeredTools.set(toolDef.name, toolDef);
      },
      on: (event: string, handler: Function) => {
        const existing = registeredHandlers.get(event) ?? [];
        existing.push(handler);
        registeredHandlers.set(event, existing);
      },
    };

    const extensionFactory = createOpenTutorExtension({
      sessionId: 'session-1',
      executor,
    });

    extensionFactory(fakePi);

    assert.equal(registeredTools.size, 10);
    assert.equal(registeredTools.size, TUTOR_TOOL_DEFINITIONS.length);

    for (const def of TUTOR_TOOL_DEFINITIONS) {
      assert.ok(registeredTools.has(def.name), `Expected tool "${def.name}" to be registered`);
      const registered = registeredTools.get(def.name);
      assert.equal(registered.name, def.name);
      assert.equal(registered.description, def.description);
      assert.ok(typeof registered.execute === 'function');
    }
  });

  await t.test(
    '2. Tool execution routes to DomainToolsExecutor and returns Pi ToolResult format',
    async () => {
      const registeredTools = new Map<string, any>();
      const fakePi: any = {
        registerTool: (toolDef: any) => {
          registeredTools.set(toolDef.name, toolDef);
        },
        on: () => { },
      };

      let startCalled = false;
      let endCalled = false;

      const extensionFactory = createOpenTutorExtension({
        sessionId: 'session-1',
        executor,
        onToolStart: (id, name) => {
          startCalled = true;
          assert.equal(id, 'call-1');
          assert.equal(name, 'lesson_get');
        },
        onToolEnd: (id, name, success) => {
          endCalled = true;
          assert.equal(id, 'call-1');
          assert.equal(name, 'lesson_get');
          assert.equal(success, true);
        },
      });

      extensionFactory(fakePi);

      const lessonGetTool = registeredTools.get('lesson_get');
      assert.ok(lessonGetTool);

      const result = await lessonGetTool.execute('call-1', { lessonId: 'lesson-123' }, undefined);

      assert.ok(startCalled);
      assert.ok(endCalled);
      assert.ok(Array.isArray(result.content));
      assert.equal(result.content[0].type, 'text');

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.id, 'lesson-123');
      assert.equal(parsed.title, 'Test Lesson');
    }
  );

  await t.test(
    '3. Retrieval tool execution consumes retrieval budget via getTurnContext',
    async () => {
      const registeredTools = new Map<string, any>();
      const fakePi: any = {
        registerTool: (toolDef: any) => {
          registeredTools.set(toolDef.name, toolDef);
        },
        on: () => { },
      };

      let consumedTool = '';
      let consumedQuery: string | undefined;

      const extensionFactory = createOpenTutorExtension({
        sessionId: 'session-1',
        executor,
        getTurnContext: () => ({
          requestId: 'req-1',
          retrieval: {
            consumeStep: (tool: string, query?: string) => {
              consumedTool = tool;
              consumedQuery = query;
            },
          },
        }),
      });

      extensionFactory(fakePi);

      const knowledgeSearchTool = registeredTools.get('knowledge_search');
      assert.ok(knowledgeSearchTool);

      const result = await knowledgeSearchTool.execute(
        'call-2',
        { query: 'attention mechanism' },
        undefined
      );

      assert.equal(consumedTool, 'knowledge_search');
      assert.equal(consumedQuery, 'attention mechanism');

      const parsed = JSON.parse(result.content[0].text);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed[0].id, 'k1');
    }
  );

  await t.test('4. Exceeding retrieval budget returns error result gracefully', async () => {
    const registeredTools = new Map<string, any>();
    const fakePi: any = {
      registerTool: (toolDef: any) => {
        registeredTools.set(toolDef.name, toolDef);
      },
      on: () => { },
    };

    const extensionFactory = createOpenTutorExtension({
      sessionId: 'session-1',
      executor,
      getTurnContext: () => ({
        requestId: 'req-1',
        retrieval: {
          consumeStep: () => {
            throw new Error('RETRIEVAL_BUDGET_EXCEEDED: step limit of 2 reached');
          },
        },
      }),
    });

    extensionFactory(fakePi);

    const knowledgeSearchTool = registeredTools.get('knowledge_search');
    const result = await knowledgeSearchTool.execute(
      'call-3',
      { query: 'exceeded query' },
      undefined
    );

    assert.ok(result.content[0].text.includes('RETRIEVAL_BUDGET_EXCEEDED'));
    assert.equal(result.details.success, false);
    assert.equal(result.details.error.code, 'RETRIEVAL_BUDGET_EXCEEDED');
  });

  await t.test('5. Security gate on tool_call blocks unauthorized tools', () => {
    const registeredHandlers = new Map<string, Function[]>();
    const fakePi: any = {
      registerTool: () => { },
      on: (event: string, handler: Function) => {
        const existing = registeredHandlers.get(event) ?? [];
        existing.push(handler);
        registeredHandlers.set(event, existing);
      },
    };

    const extensionFactory = createOpenTutorExtension({
      sessionId: 'session-1',
      executor,
    });

    extensionFactory(fakePi);

    const toolCallHandlers = registeredHandlers.get('tool_call') ?? [];
    assert.ok(toolCallHandlers.length > 0);

    const handler = toolCallHandlers[0];

    // Allowed tool
    const allowedRes = handler({ type: 'tool_call', toolName: 'lesson_patch' });
    assert.equal(allowedRes, undefined);

    // Blocked tools
    const forbiddenTools = ['bash', 'write', 'edit', 'read', 'grep', 'rm', 'arbitrary_custom_tool'];
    for (const toolName of forbiddenTools) {
      const blockedRes = handler({ type: 'tool_call', toolName });
      assert.ok(blockedRes, `Expected tool "${toolName}" to be blocked`);
      assert.equal(blockedRes.block, true);
      assert.ok(blockedRes.reason.includes('Security Violation'));
    }
  });
});
