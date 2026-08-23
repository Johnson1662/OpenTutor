import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainToolsExecutor, TUTOR_TOOL_NAMES } from '@opentutor/tutor-tools';
import {
  createOpenTutorResourceLoader,
  PiSessionRegistry,
  SOCRATIC_TUTOR_SYSTEM_PROMPT,
} from '../src/index.ts';

test('packages/agent-runtime - OpenTutor Resource & Tool Isolation', async (t) => {
  const mockServices = {
    lessonService: {
      getLesson: () => null,
      applyPatches: () => ({ lesson: {} as any, newVersion: 2 }),
    },
    sessionService: {
      getSnapshot: () => ({ path: [], pathVersion: 1 }),
    },
    knowledgeService: {},
  };

  const executor = new DomainToolsExecutor(mockServices as any);

  await t.test(
    '1. createOpenTutorResourceLoader configures complete isolation flags',
    async () => {
      const resourceLoader = await createOpenTutorResourceLoader({
        cwd: process.cwd(),
        extensionOptions: {
          sessionId: 'iso-session-1',
          executor,
        },
      });

      assert.ok(resourceLoader);

      // Verify system prompt is locked to Socratic Tutor prompt
      const systemPrompt = resourceLoader.getSystemPrompt();
      assert.equal(systemPrompt, SOCRATIC_TUTOR_SYSTEM_PROMPT);

      // Verify project context files (AGENTS.md, etc.) are blocked
      const agentsFiles = resourceLoader.getAgentsFiles();
      assert.deepEqual(agentsFiles.agentsFiles, []);

      // Verify skills, prompts, and themes are isolated
      assert.deepEqual(resourceLoader.getSkills().skills, []);
      assert.deepEqual(resourceLoader.getPrompts().prompts, []);

      // Verify extensions contain only the inline 'opentutor' extension
      const extensions = resourceLoader.getExtensions();
      assert.ok(extensions.extensions.some((ext) => ext.path.includes('opentutor')));
    }
  );

  await t.test(
    '2. PiSessionRegistry instantiates session with isolated tools only',
    async () => {
      const registry = new PiSessionRegistry(executor);
      const session = await registry.getOrCreateSession('iso-session-2');

      assert.ok(session);

      // Built-in coding tools must not be present
      const codingTools = ['bash', 'write', 'edit', 'read', 'grep', 'find', 'ls'];
      const activeToolNames = session.getActiveToolNames();

      for (const forbidden of codingTools) {
        assert.equal(
          activeToolNames.includes(forbidden),
          false,
          `Forbidden tool "${forbidden}" must not be active in Tutor session`
        );
      }

      // All active tools must be in TUTOR_TOOL_NAMES
      for (const toolName of activeToolNames) {
        assert.ok(TUTOR_TOOL_NAMES.has(toolName), `Tool "${toolName}" is not in Tutor allowlist`);
      }

      await registry.disposeSession('iso-session-2');
    }
  );
});
