import { randomUUID } from 'node:crypto';
import type { DomainToolsExecutor } from '@opentutor/agent-tools';
import { DOMAIN_TOOLS_DEFINITIONS } from '@opentutor/agent-tools';
import type { TraceRepository } from '@opentutor/database';
import { SOCRATIC_TUTOR_SYSTEM_PROMPT } from './prompt.ts';
import type { TutorRuntime, TutorTurnInput, TutorTurnResult } from './tutor-runtime.ts';
import { FakeTutorRuntime } from './fake-tutor-runtime.ts';

export interface OpenAICompatibleRuntimeOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class OpenAICompatibleTutorRuntime implements TutorRuntime {
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly traceRepo?: TraceRepository;
  private readonly sessionLocks = new Map<string, Promise<void>>();
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly apiKey?: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(
    toolsExecutor: DomainToolsExecutor,
    traceRepo?: TraceRepository,
    options?: OpenAICompatibleRuntimeOptions
  ) {
    this.toolsExecutor = toolsExecutor;
    this.traceRepo = traceRepo;
    this.apiKey = options?.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    this.baseURL = options?.baseURL ?? process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
    this.model = options?.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
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
      if (this.sessionLocks.get(input.sessionId) === queued) this.sessionLocks.delete(input.sessionId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.activeRequests.get(requestId)?.abort();
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.sessionLocks.delete(sessionId);
  }

  private async runTurnUnlocked(input: TutorTurnInput): Promise<TutorTurnResult> {
    if (!this.apiKey) {
      const fake = new FakeTutorRuntime(this.toolsExecutor, this.traceRepo);
      return fake.runTurn(input);
    }

    const requestId = input.requestId ?? `req-${randomUUID()}`;
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    const runId = `run-${randomUUID()}`;
    this.traceRepo?.startRun({ id: runId, sessionId: input.sessionId, requestId, model: this.model });

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SOCRATIC_TUTOR_SYSTEM_PROMPT },
            { role: 'user', content: input.message },
          ],
          tools: DOMAIN_TOOLS_DEFINITIONS,
          tool_choice: 'auto',
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM Error: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: {
            content?: string;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
        }>;
      };

      const choice = data.choices[0]?.message;
      let reply = choice?.content ?? '';
      const toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];

      if (choice?.tool_calls) {
        for (const tc of choice.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          input.onToolStart?.(tc.id, tc.function.name);
          const res = await this.toolsExecutor.executeTool(input.sessionId, tc.function.name, args);
          input.onToolEnd?.(tc.id, tc.function.name, res.success);

          this.traceRepo?.recordToolCall({
            id: tc.id,
            runId,
            toolName: tc.function.name,
            arguments: args,
            result: res,
            status: res.success ? 'success' : 'error',
          });
          toolCalls.push({ tool: tc.function.name, args, result: res });
        }
        if (!reply) reply = 'Updated your learning room with the requested material.';
      }

      input.onTextDelta?.(reply);
      this.traceRepo?.completeRun(runId, 'completed');
      return { requestId, reply, toolCalls };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.traceRepo?.completeRun(runId, 'failed', errorMsg);
      throw err;
    }
  }
}
