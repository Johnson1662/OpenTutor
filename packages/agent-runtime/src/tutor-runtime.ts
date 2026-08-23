import { randomUUID } from 'node:crypto';
import type { DomainToolsExecutor } from '@opentutor/agent-tools';
import type { TraceRepository } from '@opentutor/database';
import { SOCRATIC_TUTOR_SYSTEM_PROMPT } from './prompt.ts';
import { DOMAIN_TOOLS_DEFINITIONS } from '@opentutor/agent-tools';
import type { LearningPathNode, Lesson, LessonPatch } from '@opentutor/protocol';

export interface TutorTurnInput {
  sessionId: string;
  message: string;
  requestId?: string;
  onTextDelta?: (delta: string) => void;
}

export interface TutorTurnResult {
  requestId: string;
  reply: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>;
}

export interface TutorRuntime {
  runTurn(input: TutorTurnInput): Promise<TutorTurnResult>;
  cancel?(requestId: string): Promise<void>;
  disposeSession?(sessionId: string): Promise<void>;
}

export class FakeTutorRuntime implements TutorRuntime {
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly traceRepo?: TraceRepository;
  private readonly sessionLocks = new Map<string, Promise<void>>();
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(toolsExecutor: DomainToolsExecutor, traceRepo?: TraceRepository) {
    this.toolsExecutor = toolsExecutor;
    this.traceRepo = traceRepo;
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

  private async runTurnUnlocked(input: TutorTurnInput): Promise<TutorTurnResult> {
    const requestId = input.requestId ?? `req-${randomUUID()}`;
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    if (controller.signal.aborted) throw new Error('Turn cancelled');

    try {
      return await this.runTurnWithRequest(input, requestId, controller.signal);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  private async runTurnWithRequest(input: TutorTurnInput, requestId: string, signal: AbortSignal): Promise<TutorTurnResult> {
    if (signal.aborted) throw new Error('Turn cancelled');
    const runId = `run-${randomUUID()}`;
    const lower = input.message.toLowerCase();
    const executedToolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];

    this.traceRepo?.startRun({
      id: runId,
      sessionId: input.sessionId,
      requestId,
      model: 'fake-socratic-tutor',
    });

    let reply = '';

    try {
      // Fetch dynamic live versions to satisfy optimistic locking
      const lessonRes = (await this.toolsExecutor.executeTool(input.sessionId, 'lesson_get', {
        lessonId: 'lesson-self-attention',
      })) as { success: boolean; data?: Lesson };
      if (signal.aborted) throw new Error('Turn cancelled');
      const currentLessonVersion = lessonRes.data?.version ?? 1;

      const pathRes = (await this.toolsExecutor.executeTool(input.sessionId, 'path_get', {
        sessionId: input.sessionId,
      })) as { success: boolean; data?: { path: LearningPathNode[]; version: number } };
      if (signal.aborted) throw new Error('Turn cancelled');
      const currentPathVersion = pathRes.data?.version ?? 1;

      if (lower.includes('code') || lower.includes('代码') || lower.includes('show_code')) {
        const patch: LessonPatch = {
          op: 'insert',
          position: { index: 2 },
          block: {
            id: `code-${Date.now()}`,
            type: 'code',
            language: 'python',
            code: `import torch\nimport torch.nn.functional as F\n\ndef scaled_dot_product_attention(q, k, v):\n    d_k = q.size(-1)\n    scores = torch.matmul(q, k.transpose(-2, -1)) / (d_k ** 0.5)\n    weights = F.softmax(scores, dim=-1)\n    return torch.matmul(weights, v), weights`,
            explanation: 'Standard PyTorch implementation of Scaled Dot-Product Attention.',
          },
        };

        const toolRes = await this.toolsExecutor.executeTool(input.sessionId, 'lesson_patch', {
          lessonId: 'lesson-self-attention',
          baseVersion: currentLessonVersion,
          patches: [patch],
        });

        const toolCallId = `tc-${randomUUID()}`;
        this.traceRepo?.recordToolCall({
          id: toolCallId,
          runId,
          toolName: 'lesson_patch',
          arguments: { lessonId: 'lesson-self-attention', baseVersion: currentLessonVersion },
          result: toolRes,
          status: toolRes.success ? 'success' : 'error',
        });

        executedToolCalls.push({ tool: 'lesson_patch', args: { lessonId: 'lesson-self-attention' }, result: toolRes });
        reply = 'Injected a working PyTorch code implementation into the lesson canvas.';
      } else if (lower.includes('simple') || lower.includes('简单') || lower.includes('simpler')) {
        const patch: LessonPatch = {
          op: 'insert',
          position: { index: 1 },
          block: {
            id: `simple-${Date.now()}`,
            type: 'text',
            variant: 'callout',
            content: '💡 Intuition: Self-attention allows each token to dynamically lookup and focus on relevant context across the sequence.',
          },
        };

        const toolRes = await this.toolsExecutor.executeTool(input.sessionId, 'lesson_patch', {
          lessonId: 'lesson-self-attention',
          baseVersion: currentLessonVersion,
          patches: [patch],
        });

        const toolCallId = `tc-${randomUUID()}`;
        this.traceRepo?.recordToolCall({
          id: toolCallId,
          runId,
          toolName: 'lesson_patch',
          arguments: { lessonId: 'lesson-self-attention', baseVersion: currentLessonVersion },
          result: toolRes,
          status: toolRes.success ? 'success' : 'error',
        });

        executedToolCalls.push({ tool: 'lesson_patch', args: { lessonId: 'lesson-self-attention' }, result: toolRes });
        reply = 'Simplified the explanation with an intuitive callout analogy.';
      } else if (lower.includes('softmax') || lower.includes('detour') || lower.includes('softmax_unknown')) {
        const detourRes = await this.toolsExecutor.executeTool(input.sessionId, 'path_insert_detour', {
          sessionId: input.sessionId,
          baseVersion: currentPathVersion,
          knowledgeNodeId: 'softmax',
          title: 'Detour: Softmax Normalization',
          note: 'Diagnosed prerequisite gap from learner query',
        });

        const toolCallId = `tc-${randomUUID()}`;
        this.traceRepo?.recordToolCall({
          id: toolCallId,
          runId,
          toolName: 'path_insert_detour',
          arguments: { sessionId: input.sessionId, knowledgeNodeId: 'softmax', baseVersion: currentPathVersion },
          result: detourRes,
          status: detourRes.success ? 'success' : 'error',
        });

        executedToolCalls.push({ tool: 'path_insert_detour', args: { knowledgeNodeId: 'softmax' }, result: detourRes });
        reply = 'Identified prerequisite gap: inserted Softmax detour before Self Attention.';
      } else {
        reply = `I have received your request: "${input.message}". Canvas remains structured.`;
      }

      input.onTextDelta?.(reply);
      this.traceRepo?.completeRun(runId, 'completed');
      return { requestId, reply, toolCalls: executedToolCalls };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.traceRepo?.completeRun(runId, 'failed', errorMsg);
      throw err;
    }
  }
}

export class PiTutorRuntime implements TutorRuntime {
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly traceRepo?: TraceRepository;
  private readonly sessionLocks = new Map<string, Promise<void>>();
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly apiKey?: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(toolsExecutor: DomainToolsExecutor, traceRepo?: TraceRepository, options?: { apiKey?: string; baseURL?: string; model?: string }) {
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
          const res = await this.toolsExecutor.executeTool(input.sessionId, tc.function.name, args);
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
