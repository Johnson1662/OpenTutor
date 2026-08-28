import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainToolsExecutor,
  TUTOR_TOOL_NAMES,
  TUTOR_TOOL_DEFINITIONS,
} from '@opentutor/tutor-tools';
import {
  createOpenTutorExtension,
  PiEventAdapter,
  FakeTutorRuntime,
} from '../src/index.ts';

test('packages/agent-runtime - Pi Extension Security & Event Handling', async (t) => {
  await t.test('1. Tutor tools allowlist strictly forbids dangerous shell/system tools', () => {
    const forbiddenTools = ['bash', 'write', 'edit', 'read', 'grep', 'find', 'ls'];
    for (const tool of forbiddenTools) {
      assert.equal(TUTOR_TOOL_NAMES.has(tool), false, `Tool "${tool}" must not be in allowlist`);
    }

    assert.equal(TUTOR_TOOL_DEFINITIONS.length, 10);
    for (const def of TUTOR_TOOL_DEFINITIONS) {
      assert.ok(TUTOR_TOOL_NAMES.has(def.name));
    }
  });

  await t.test('2. Extension security gate blocks forbidden tool execution', () => {
    const mockServices = {
      lessonService: { getLesson: () => ({ id: 'l1', version: 1 }), patchLesson: () => ({}) },
      sessionService: { getSnapshot: () => ({ pathVersion: 1 }), insertDetour: () => ({}) },
      knowledgeService: { searchKnowledge: () => [], recordAssessment: () => { } },
    };

    const executor = new DomainToolsExecutor(mockServices as any);
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
      sessionId: 'test-session',
      executor,
    });
    extensionFactory(fakePi);

    const handlers = registeredHandlers.get('tool_call') ?? [];
    assert.ok(handlers.length > 0);

    const gate = handlers[0];
    const blockedBash = gate({ type: 'tool_call', toolName: 'bash' });
    assert.ok(blockedBash);
    assert.equal(blockedBash.block, true);
    assert.ok(blockedBash.reason.includes('Security Violation'));

    const blockedWrite = gate({ type: 'tool_call', toolName: 'write' });
    assert.ok(blockedWrite);
    assert.equal(blockedWrite.block, true);
  });

  await t.test('3. PiEventAdapter translates text_delta and tool lifecycle events', () => {
    let capturedDelta = '';
    let startedTool = '';
    let completedTool = '';
    let isSuccess = false;

    const adapter = new PiEventAdapter({
      sessionId: 's1',
      message: 'test',
      onTextDelta: (delta) => {
        capturedDelta += delta;
      },
      onToolStart: (_id, name) => {
        startedTool = name;
      },
      onToolEnd: (_id, name, success) => {
        completedTool = name;
        isSuccess = success;
      },
    });

    adapter.handleEvent({ type: 'text_delta', delta: 'Hello ' });
    adapter.handleEvent({ type: 'text_delta', delta: 'Learner' });
    assert.equal(capturedDelta, 'Hello Learner');
    adapter.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '!' },
    });
    assert.equal(capturedDelta, 'Hello Learner!');

    adapter.handleEvent({ type: 'tool_call_start', toolCallId: 'tc-1', toolName: 'lesson_patch' });
    assert.equal(startedTool, 'lesson_patch');

    adapter.handleEvent({
      type: 'tool_call_end',
      toolCallId: 'tc-1',
      toolName: 'lesson_patch',
      isError: false,
    });
    assert.equal(completedTool, 'lesson_patch');
    assert.equal(isSuccess, true);
  });

  await t.test('4. Session serialization and cancellation in runtime', async () => {
    const mockServices = {
      lessonService: { getLesson: () => ({ id: 'l1', version: 1 }), patchLesson: () => ({}) },
      sessionService: { getSnapshot: () => ({ pathVersion: 1 }), insertDetour: () => ({}) },
      knowledgeService: { searchKnowledge: () => [], recordAssessment: () => { } },
    };

    const executor = new DomainToolsExecutor(mockServices as any);
    const runtime = new FakeTutorRuntime(executor);

    const firstPromise = runtime.runTurn({ sessionId: 's1', message: 'First request' });
    const secondPromise = runtime.runTurn({ sessionId: 's1', message: 'Second request' });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.ok(first.reply);
    assert.ok(second.reply);
  });
});
