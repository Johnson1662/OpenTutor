import { randomUUID } from 'node:crypto';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { DomainToolsExecutor } from '@opentutor/agent-tools';
import type { TraceRepository } from '@opentutor/database';
import type { TutorRuntime, TutorTurnInput, TutorTurnResult } from '../tutor-runtime.ts';
import { FakeTutorRuntime } from '../fake-tutor-runtime.ts';
import { PiSessionRegistry, type PiSessionRegistryOptions } from './pi-session-registry.ts';
import { PiEventAdapter } from './pi-event-adapter.ts';
import type { RetrievalStepTracker } from './pi-tool-adapter.ts';

export interface PiTutorRuntimeOptions extends PiSessionRegistryOptions {
  runtimeMode?: 'pi' | 'fake';
  fallbackToFake?: boolean;
}

export class PiTutorRuntime implements TutorRuntime {
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly traceRepo?: TraceRepository;
  private readonly registry: PiSessionRegistry;
  private readonly options: PiTutorRuntimeOptions;
  private readonly sessionLocks = new Map<string, Promise<void>>();
  private readonly activeTurns = new Map<
    string,
    { session?: AgentSession; controller: AbortController }
  >();
  private readonly currentTurnContext = new Map<
    string,
    { requestId: string; retrieval: RetrievalStepTracker }
  >();
  private readonly runtimeMode: 'pi' | 'fake';

  constructor(
    toolsExecutor: DomainToolsExecutor,
    traceRepo?: TraceRepository,
    options: PiTutorRuntimeOptions = {}
  ) {
    this.toolsExecutor = toolsExecutor;
    this.traceRepo = traceRepo;
    this.options = options;
    const envMode = process.env.OPENTUTOR_RUNTIME_MODE;
    if (options.runtimeMode) {
      this.runtimeMode = options.runtimeMode;
    } else if (envMode === 'pi' || envMode === 'fake') {
      this.runtimeMode = envMode;
    } else if (
      process.env.NODE_ENV === 'test' ||
      (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.LLM_API_KEY && !options.apiKey)
    ) {
      this.runtimeMode = 'fake';
    } else {
      const hasAuth = Boolean(
        options.apiKey ??
        process.env.LLM_API_KEY ??
        process.env.OPENAI_API_KEY ??
        options.modelRuntime?.hasConfiguredAuth(options.model?.provider ?? 'anthropic')
      );
      this.runtimeMode = hasAuth ? 'pi' : 'fake';
    }
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
    const activeTurn = this.activeTurns.get(requestId);
    if (activeTurn) {
      if (activeTurn.session) {
        try {
          await activeTurn.session.abort();
        } catch {
          // Suppress abort errors
        }
      }
      activeTurn.controller.abort();
      this.activeTurns.delete(requestId);
    }
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.sessionLocks.delete(sessionId);
    await this.registry.disposeSession(sessionId);
  }

  private determineRetrievalBudget(message?: string): number {
    const lower = (message ?? '').toLowerCase();
    if (lower.includes('simple') || lower.includes('简单') || lower.includes('code') || lower.includes('代码')) {
      return 0; // None
    }
    if (lower.includes('conflict') || lower.includes('verify') || lower.includes('compare') || lower.includes('冲突')) {
      return 5; // Deep
    }
    return 2; // Standard
  }

  private async runTurnUnlocked(input: TutorTurnInput): Promise<TutorTurnResult> {
    if (this.runtimeMode === 'fake') {
      const fake = new FakeTutorRuntime(this.toolsExecutor, this.traceRepo);
      return await fake.runTurn(input);
    }

    const requestId = input.requestId ?? `req-${randomUUID()}`;
    const controller = new AbortController();
    const runId = `run-${randomUUID()}`;

    const budget = this.determineRetrievalBudget(input.message);
    let currentRetrievalSteps = 0;

    const retrievalTracker: RetrievalStepTracker = {
      consumeStep: (tool: string, _query?: string, _resultCount?: number) => {
        if (currentRetrievalSteps >= budget) {
          throw new Error(`RETRIEVAL_BUDGET_EXCEEDED: step limit of ${budget} reached`);
        }
        currentRetrievalSteps++;
      },
    };

    this.currentTurnContext.set(input.sessionId, {
      requestId,
      retrieval: retrievalTracker,
    });

    this.traceRepo?.startRun({
      id: runId,
      sessionId: input.sessionId,
      requestId,
      model: this.options.model?.id ?? 'pi-agent-session',
    });

    const toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];

    try {
      const session = await this.registry.getOrCreateSession(
        input.sessionId,
        (tcId, name) => {
          input.onToolStart?.(tcId, name);
        },
        (tcId, name, success) => {
          input.onToolEnd?.(tcId, name, success);
          toolCalls.push({ tool: name, args: {}, result: { success } });
        },
        () => this.currentTurnContext.get(input.sessionId)?.retrieval
      );

      this.activeTurns.set(requestId, { session, controller });

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
        await session.prompt(input.message ?? input.action ?? '');
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
      throw err;
    } finally {
      this.activeTurns.delete(requestId);
      this.currentTurnContext.delete(input.sessionId);
    }
  }
}
