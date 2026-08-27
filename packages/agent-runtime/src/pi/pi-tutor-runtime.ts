import { randomUUID } from 'node:crypto';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { DomainToolsExecutor } from '@opentutor/tutor-tools';
import type { TraceRepository } from '@opentutor/database';
import { formatTutorPrompt, type TutorRuntime, type TutorTurnInput, type TutorTurnResult } from '../tutor-runtime.ts';
import { FakeTutorRuntime } from '../fake-tutor-runtime.ts';
import {
  PiSessionRegistry,
  type PiSessionRegistryOptions,
  type TurnContextInfo,
} from './pi-session-registry.ts';
import { PiEventAdapter } from './pi-event-adapter.ts';

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
  private readonly currentTurnContext = new Map<string, TurnContextInfo>();
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
    } else if (process.env.NODE_ENV === 'test') {
      this.runtimeMode = 'fake';
    } else {
      this.runtimeMode = 'pi';
    }

    this.registry = new PiSessionRegistry(toolsExecutor, {
      ...options,
      getTurnContext: (sessionId: string) => {
        return this.currentTurnContext.get(sessionId);
      },
    });
  }

  async runTurn(input: TutorTurnInput): Promise<TutorTurnResult> {
    const previous = this.sessionLocks.get(input.sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
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
    if (
      lower.includes('simple') ||
      lower.includes('简单') ||
      lower.includes('code') ||
      lower.includes('代码')
    ) {
      return 0; // None
    }
    if (
      lower.includes('conflict') ||
      lower.includes('verify') ||
      lower.includes('compare') ||
      lower.includes('冲突')
    ) {
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

    let resolvedProvider = this.options.model?.provider ?? 'anthropic';
    if (this.options.sessionModelResolver) {
      const resolved = await this.options.sessionModelResolver.resolveSessionModel(input.sessionId);
      if (resolved.providerId) {
        resolvedProvider = resolved.providerId;
      }
    }

    const isConfigured = Boolean(
      this.options.apiKey ??
      process.env.LLM_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      this.options.modelRuntime?.hasConfiguredAuth(resolvedProvider)
    );

    if (!isConfigured) {
      throw new Error(
        `MODEL_SETUP_REQUIRED: No API key or OAuth credentials found for provider '${resolvedProvider}'. Please connect in Settings.`
      );
    }

    const budget = this.determineRetrievalBudget(input.message);
    let currentRetrievalSteps = 0;

    const retrievalTracker = {
      consumeStep: (_tool: string, _query?: string) => {
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

    const toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];

    this.traceRepo?.startRun({
      id: runId,
      sessionId: input.sessionId,
      requestId,
      model: this.options.model?.id ?? 'pi-socratic-tutor',
    });

    const session = await this.registry.getOrCreateSession(
      input.sessionId,
      input.onToolStart,
      input.onToolEnd,
      () => this.currentTurnContext.get(input.sessionId)
    );

    this.activeTurns.set(requestId, { session, controller });

    const eventAdapter = new PiEventAdapter(input);

    let assistantReply = '';
    let assistantError: string | undefined;

    try {
      if (controller.signal.aborted) {
        throw new Error('Turn cancelled before execution');
      }

      const unsubscribe = session.subscribe((event: unknown) => {
        if (event && typeof event === 'object' && 'type' in event) {
          const evType = (event as { type: string }).type;
          eventAdapter.handleEvent(event as { type: string;[key: string]: unknown });
          if (evType === 'text_delta' && 'delta' in event && typeof event.delta === 'string') {
            assistantReply += event.delta;
          } else if (
            evType === 'content_delta' &&
            'text' in event &&
            typeof event.text === 'string'
          ) {
            assistantReply += event.text;
          } else if (evType === 'message_update' && 'assistantMessageEvent' in event) {
            const assistantMessageEvent = event.assistantMessageEvent;
            if (assistantMessageEvent && typeof assistantMessageEvent === 'object' && 'type' in assistantMessageEvent && assistantMessageEvent.type === 'text_delta' && 'delta' in assistantMessageEvent && typeof assistantMessageEvent.delta === 'string') {
              assistantReply += assistantMessageEvent.delta;
            }
          } else if (evType === 'message_end' && 'message' in event) {
            const message = event.message;
            if (message && typeof message === 'object' && 'role' in message && message.role === 'assistant') {
              if ('errorMessage' in message && typeof message.errorMessage === 'string') {
                assistantError = message.errorMessage;
              }
            }
          }
        }
      });

      try {
        await session.prompt(formatTutorPrompt(input.message ?? input.action ?? '', input.activeStepContext));
      } finally {
        unsubscribe();
      }

      if (assistantError) {
        throw new Error(`MODEL_PROVIDER_ERROR: ${assistantError}`);
      }
      if (!assistantReply) {
        const messages = session.state.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (message?.role !== 'assistant') continue;
          if ('errorMessage' in message && typeof message.errorMessage === 'string') {
            throw new Error(`MODEL_PROVIDER_ERROR: ${message.errorMessage}`);
          }
          if (!Array.isArray(message.content)) continue;
          assistantReply = message.content
            .filter((part): part is { type: 'text'; text: string } =>
              Boolean(part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string')
            )
            .map((part) => part.text)
            .join('');
          if (assistantReply) break;
        }
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
