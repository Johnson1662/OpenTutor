import { randomUUID } from 'node:crypto';
import type { DomainToolsExecutor } from '@opentutor/agent-tools';
import type { TraceRepository } from '@opentutor/database';
import type { TutorRuntime, TutorTurnInput, TutorTurnResult } from '../tutor-runtime.ts';
import { FakeTutorRuntime } from '../fake-tutor-runtime.ts';
import { PiSessionRegistry, type PiSessionRegistryOptions } from './pi-session-registry.ts';
import { PiEventAdapter } from './pi-event-adapter.ts';

export interface PiTutorRuntimeOptions extends PiSessionRegistryOptions {
  fallbackToFake?: boolean;
}

export class PiTutorRuntime implements TutorRuntime {
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly traceRepo?: TraceRepository;
  private readonly registry: PiSessionRegistry;
  private readonly options: PiTutorRuntimeOptions;
  private readonly sessionLocks = new Map<string, Promise<void>>();
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly fallbackToFake: boolean;

  constructor(
    toolsExecutor: DomainToolsExecutor,
    traceRepo?: TraceRepository,
    options: PiTutorRuntimeOptions = {}
  ) {
    this.toolsExecutor = toolsExecutor;
    this.traceRepo = traceRepo;
    this.options = options;
    this.fallbackToFake = options.fallbackToFake ?? true;
    this.registry = new PiSessionRegistry(toolsExecutor, options);
  }

  async runTurn(input: TutorTurnInput): Promise<TutorTurnResult> {
    const previous = this.sessionLocks.get(input.sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.sessionLocks.set(input.sessionId, queued);
    await previous;

    try {
      return await this.runTurnUnlocked(input);
    } finally {
      release();
      if (this.sessionLocks.get(input.sessionId) === queued) {
        this.sessionLocks.delete(input.sessionId);
      }
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.activeRequests.get(requestId)?.abort();
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.sessionLocks.delete(sessionId);
    await this.registry.disposeSession(sessionId);
  }

  private async runTurnUnlocked(input: TutorTurnInput): Promise<TutorTurnResult> {
    const hasApiKey = Boolean(this.options.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY);
    if (!hasApiKey && this.fallbackToFake) {
      const fake = new FakeTutorRuntime(this.toolsExecutor, this.traceRepo);
      return await fake.runTurn(input);
    }

    const requestId = input.requestId ?? `req-${randomUUID()}`;
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    const runId = `run-${randomUUID()}`;

    this.traceRepo?.startRun({
      id: runId,
      sessionId: input.sessionId,
      requestId,
      model: 'pi-agent-session',
    });

    const toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];

    try {
      let session;
      try {
        session = await this.registry.getOrCreateSession(
          input.sessionId,
          (tcId, name) => {
            input.onToolStart?.(tcId, name);
          },
          (tcId, name, success) => {
            input.onToolEnd?.(tcId, name, success);
            toolCalls.push({ tool: name, args: {}, result: { success } });
          }
        );
      } catch (registryErr) {
        if (this.fallbackToFake) {
          const fake = new FakeTutorRuntime(this.toolsExecutor, this.traceRepo);
          return await fake.runTurn(input);
        }
        throw registryErr;
      }

      const eventAdapter = new PiEventAdapter(input);
      let assistantReply = '';

      const unsubscribe = session.subscribe((event: unknown) => {
        if (event && typeof event === 'object' && 'type' in event) {
          eventAdapter.handleEvent(event as { type: string;[key: string]: unknown });
          const ev = event as { type: string; text?: string; delta?: string };
          if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
            assistantReply += ev.delta;
          } else if (ev.type === 'content_delta' && typeof ev.text === 'string') {
            assistantReply += ev.text;
          }
        }
      });

      try {
        await session.prompt(input.message);
      } finally {
        unsubscribe();
      }

      this.traceRepo?.completeRun(runId, 'completed');
      return {
        requestId,
        reply: assistantReply || 'Processed learning interaction.',
        toolCalls,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.traceRepo?.completeRun(runId, 'failed', errorMsg);
      if (this.fallbackToFake) {
        const fake = new FakeTutorRuntime(this.toolsExecutor, this.traceRepo);
        return await fake.runTurn(input);
      }
      throw err;
    } finally {
      this.activeRequests.delete(requestId);
    }
  }
}
