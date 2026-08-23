import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainToolsExecutor } from '@opentutor/agent-tools';
import {
  TUTOR_ALLOWED_TOOLS,
  TUTOR_FORBIDDEN_TOOLS,
  createTutorTools,
  validateTutorToolAllowlist,
  PiEventAdapter,
  FakeTutorRuntime,
} from '../src/index.ts';

test('packages/agent-runtime - Pi Tool Sandbox and Whitelist', async (t) => {
  await t.test('1. Pi exposed tools strictly match Tutor allowlist and forbid dangerous tools', () => {
    assert.ok(!TUTOR_ALLOWED_TOOLS.has('bash'));
    assert.ok(!TUTOR_ALLOWED_TOOLS.has('write'));
    assert.ok(!TUTOR_ALLOWED_TOOLS.has('edit'));
    assert.ok(!TUTOR_ALLOWED_TOOLS.has('read'));
    assert.ok(!TUTOR_ALLOWED_TOOLS.has('grep'));
    assert.ok(!TUTOR_ALLOWED_TOOLS.has('find'));
    assert.ok(!TUTOR_ALLOWED_TOOLS.has('ls'));

    assert.ok(TUTOR_FORBIDDEN_TOOLS.has('bash'));
    assert.ok(TUTOR_FORBIDDEN_TOOLS.has('write'));
    assert.ok(TUTOR_FORBIDDEN_TOOLS.has('edit'));

    const mockServices = {
      lessonService: { getLesson: () => ({ id: 'l1', version: 1 }), patchLesson: () => ({}) },
      sessionService: { getSnapshot: () => ({ pathVersion: 1 }), insertDetour: () => ({}) },
      knowledgeService: { searchKnowledge: () => [], recordAssessment: () => { } },
    };

    const executor = new DomainToolsExecutor(mockServices as any);
    const tools = createTutorTools('test-session', executor);

    assert.ok(tools.length > 0);
    assert.ok(validateTutorToolAllowlist(tools));

    for (const tool of tools) {
      assert.ok(TUTOR_ALLOWED_TOOLS.has(tool.name));
      assert.ok(!TUTOR_FORBIDDEN_TOOLS.has(tool.name));
    }
  });

  await t.test('2. validateTutorToolAllowlist throws when forbidden tool is passed', () => {
    assert.throws(() => {
      validateTutorToolAllowlist([{ name: 'bash' }]);
    }, /Forbidden tool "bash"/);

    assert.throws(() => {
      validateTutorToolAllowlist([{ name: 'write' }]);
    }, /Forbidden tool "write"/);
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

    adapter.handleEvent({ type: 'tool_call_start', toolCallId: 'tc-1', toolName: 'lesson_patch' });
    assert.equal(startedTool, 'lesson_patch');

    adapter.handleEvent({ type: 'tool_call_end', toolCallId: 'tc-1', toolName: 'lesson_patch', isError: false });
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
