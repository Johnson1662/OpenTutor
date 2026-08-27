import { randomUUID } from 'node:crypto';
import type { DomainToolsExecutor } from '@opentutor/tutor-tools';
import type { TraceRepository } from '@opentutor/database';
import type { LessonPatch } from '@opentutor/protocol';
import type { TutorRuntime, TutorTurnInput, TutorTurnResult } from './tutor-runtime.ts';

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
    this.activeRequests.get(requestId)?.abort();
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.sessionLocks.delete(sessionId);
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

  private async runTurnWithRequest(
    input: TutorTurnInput,
    requestId: string,
    signal: AbortSignal
  ): Promise<TutorTurnResult> {
    if (signal.aborted) throw new Error('Turn cancelled');
    const runId = `run-${randomUUID()}`;
    const lower = (input.message ?? input.action ?? '').toLowerCase();
    const executedToolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> =
      [];

    this.traceRepo?.startRun({
      id: runId,
      sessionId: input.sessionId,
      requestId,
      model: 'fake-socratic-tutor',
    });

    let reply = '';

    try {
      let activeLessonId = input.activeStepContext?.lessonId ?? 'lesson-self-attention';
      let currentLessonVersion = 1;
      const snap = await this.toolsExecutor.executeTool(input.sessionId, 'lesson_get', { lessonId: activeLessonId });
      if (
        snap.success &&
        snap.data &&
        typeof snap.data === 'object' &&
        'id' in snap.data &&
        typeof snap.data.id === 'string'
      ) {
        activeLessonId = snap.data.id;
        if ('version' in snap.data && typeof snap.data.version === 'number') {
          currentLessonVersion = snap.data.version;
        }
      }

      const pathSnap = await this.toolsExecutor.executeTool(input.sessionId, 'path_get', {
        sessionId: input.sessionId,
      });
      let currentPathVersion = 1;
      if (
        pathSnap.success &&
        pathSnap.data &&
        typeof pathSnap.data === 'object' &&
        'version' in pathSnap.data &&
        typeof pathSnap.data.version === 'number'
      ) {
        currentPathVersion = pathSnap.data.version;
      }

      if (lower.includes('code') || lower.includes('代码') || lower.includes('show_code')) {
        const patch: LessonPatch = {
          op: 'insert',
          position: { index: 2 },
          block: {
            id: `code-${Date.now()}`,
            type: 'code',
            language: 'python',
            code: `import torch\nimport torch.nn.functional as F\n\ndef scaled_dot_product_attention(Q, K, V, mask=None):\n    d_k = Q.size(-1)\n    scores = torch.matmul(Q, K.transpose(-2, -1)) / (d_k ** 0.5)\n    if mask is not None:\n        scores = scores.masked_fill(mask == 0, -1e9)\n    p_attn = F.softmax(scores, dim=-1)\n    return torch.matmul(p_attn, V), p_attn`,
            explanation: 'Clean PyTorch implementation of Scaled Dot-Product Attention.',
          },
        };

        const toolCallId = `tc-${randomUUID()}`;
        input.onToolStart?.(toolCallId, 'lesson_patch');
        const toolRes = await this.toolsExecutor.executeTool(input.sessionId, 'lesson_patch', {
          lessonId: activeLessonId,
          baseVersion: currentLessonVersion,
          patches: [patch],
        });
        if (!toolRes.success) {
          console.error('[FakeTutorRuntime] lesson_patch failed:', toolRes.error);
        }
        input.onToolEnd?.(toolCallId, 'lesson_patch', toolRes.success);

        this.traceRepo?.recordToolCall({
          id: toolCallId,
          runId,
          toolName: 'lesson_patch',
          arguments: { lessonId: activeLessonId, baseVersion: currentLessonVersion },
          result: toolRes,
          status: toolRes.success ? 'success' : 'error',
        });

        executedToolCalls.push({
          tool: 'lesson_patch',
          args: { lessonId: activeLessonId },
          result: toolRes,
        });
        reply = 'Injected a working PyTorch code implementation into the lesson canvas.';
      } else if (lower.includes('simple') || lower.includes('简单') || lower.includes('simpler')) {
        const patch: LessonPatch = {
          op: 'insert',
          position: { index: 1 },
          block: {
            id: `simple-${Date.now()}`,
            type: 'text',
            variant: 'callout',
            content:
              '💡 Intuition: Self-attention allows each token to dynamically lookup and focus on relevant context across the sequence.',
          },
        };

        const toolCallId = `tc-${randomUUID()}`;
        input.onToolStart?.(toolCallId, 'lesson_patch');
        const toolRes = await this.toolsExecutor.executeTool(input.sessionId, 'lesson_patch', {
          lessonId: activeLessonId,
          baseVersion: currentLessonVersion,
          patches: [patch],
        });
        input.onToolEnd?.(toolCallId, 'lesson_patch', toolRes.success);

        this.traceRepo?.recordToolCall({
          id: toolCallId,
          runId,
          toolName: 'lesson_patch',
          arguments: { lessonId: activeLessonId, baseVersion: currentLessonVersion },
          result: toolRes,
          status: toolRes.success ? 'success' : 'error',
        });

        executedToolCalls.push({
          tool: 'lesson_patch',
          args: { lessonId: activeLessonId },
          result: toolRes,
        });
        reply = 'Simplified the explanation with an intuitive callout analogy.';
      } else if (
        lower.includes('probe') ||
        lower.includes('doubt') ||
        lower.includes('struggling') ||
        lower.includes('confused') ||
        lower.includes("don't know") ||
        lower.includes('dont know') ||
        lower.includes('do not know') ||
        lower.includes('do not understand') ||
        lower.includes('not sure') ||
        lower.includes('uncertain') ||
        lower.includes('卡住') ||
        lower.includes('探针') ||
        lower.includes('unknown') ||
        lower.includes('softmax_unknown') ||
        lower.includes('probe_request')
      ) {
        const toolCallId = `tc-${randomUUID()}`;
        input.onToolStart?.(toolCallId, 'probe_request');
        const probeArgs: Record<string, unknown> = {
          reason: 'Learner expressed uncertainty regarding prerequisite concept',
        };
        if (lower.includes('softmax')) probeArgs.prerequisiteNodeId = 'softmax';
        const probeRes = await this.toolsExecutor.executeTool(
          input.sessionId,
          'probe_request',
          probeArgs
        );
        input.onToolEnd?.(toolCallId, 'probe_request', probeRes.success);

        this.traceRepo?.recordToolCall({
          id: toolCallId,
          runId,
          toolName: 'probe_request',
          arguments: probeArgs,
          result: probeRes,
          status: probeRes.success ? 'success' : 'error',
        });

        executedToolCalls.push({
          tool: 'probe_request',
          args: probeArgs,
          result: probeRes,
        });
        reply = 'Generated and placed a diagnostic probe on the canvas to check the prerequisite concept.';
      } else if (
        lower.includes('softmax') ||
        lower.includes('detour') ||
        lower.includes('softmax_unknown')
      ) {
        const toolCallId = `tc-${randomUUID()}`;
        input.onToolStart?.(toolCallId, 'path_insert_detour');
        const detourRes = await this.toolsExecutor.executeTool(
          input.sessionId,
          'path_insert_detour',
          {
            nodeId: 'softmax',
            diagnosisId: 'diag-confirmed-softmax',
            detourKnowledgeNodeId: 'softmax',
            detourTitle: 'Detour: Softmax Normalization',
            note: 'Diagnosed prerequisite gap from learner query',
          }
        );
        input.onToolEnd?.(toolCallId, 'path_insert_detour', detourRes.success);

        this.traceRepo?.recordToolCall({
          id: toolCallId,
          runId,
          toolName: 'path_insert_detour',
          arguments: {
            sessionId: input.sessionId,
            nodeId: 'softmax',
            diagnosisId: 'diag-confirmed-softmax',
            baseVersion: currentPathVersion,
          },
          result: detourRes,
          status: detourRes.success ? 'success' : 'error',
        });

        executedToolCalls.push({
          tool: 'path_insert_detour',
          args: { nodeId: 'softmax', diagnosisId: 'diag-confirmed-softmax' },
          result: detourRes,
        });
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
