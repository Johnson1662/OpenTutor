import { SOCRATIC_TUTOR_SYSTEM_PROMPT } from './prompt.ts';
import {
  TUTOR_TOOL_DEFINITIONS,
  type DomainToolsExecutor,
} from '@opentutor/tutor-tools';
import type { ActiveStepContext, LessonPatch, LearningPathPatch } from '@opentutor/protocol';
import { formatTutorPrompt } from './tutor-runtime.ts';

export interface TutorAgentOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  systemPrompt?: string;
}

export interface AgentRunResult {
  reply: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>;
}

const OPENAI_TOOLS = TUTOR_TOOL_DEFINITIONS.map((def) => ({
  type: 'function' as const,
  function: {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  },
}));

export class TutorAgent {
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly apiKey: string | undefined;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly systemPrompt: string;

  constructor(toolsExecutor: DomainToolsExecutor, options?: TutorAgentOptions) {
    this.toolsExecutor = toolsExecutor;
    this.apiKey = options?.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    this.baseURL =
      options?.baseURL ??
      process.env.LLM_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1';
    this.model = options?.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
    this.systemPrompt = options?.systemPrompt ?? SOCRATIC_TUTOR_SYSTEM_PROMPT;
  }

  async run(
    sessionId: string,
    userMessage: string,
    emitTextDelta?: (delta: string) => void,
    activeStepContext?: ActiveStepContext
  ): Promise<AgentRunResult> {
    if (this.apiKey) {
      return this.runWithLlm(sessionId, userMessage, emitTextDelta, activeStepContext);
    }
    return this.runWithPedagogicalFallback(sessionId, userMessage, emitTextDelta, activeStepContext);
  }

  private async runWithLlm(
    sessionId: string,
    userMessage: string,
    emitTextDelta?: (delta: string) => void,
    activeStepContext?: ActiveStepContext
  ): Promise<AgentRunResult> {
    const executedToolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> =
      [];

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: formatTutorPrompt(userMessage, activeStepContext) },
    ];

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: OPENAI_TOOLS,
        tool_choice: 'auto',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`LLM call failed (${response.status}): ${errText}, falling back to rule engine.`);
      return this.runWithPedagogicalFallback(sessionId, userMessage, emitTextDelta, activeStepContext);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    const choice = data.choices[0]?.message;
    let finalReply = choice?.content ?? '';

    if (choice?.tool_calls && choice.tool_calls.length > 0) {
      for (const call of choice.tool_calls) {
        const toolName = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }

        const toolRes = await this.toolsExecutor.executeTool(sessionId, toolName, args);
        executedToolCalls.push({ tool: toolName, args, result: toolRes });
      }

      if (!finalReply) {
        finalReply = 'Updated your learning room with the requested pedagogical material.';
      }
    }

    if (emitTextDelta && finalReply) {
      emitTextDelta(finalReply);
    }

    return { reply: finalReply, toolCalls: executedToolCalls };
  }

  private async runWithPedagogicalFallback(
    sessionId: string,
    userMessage: string,
    emitTextDelta?: (delta: string) => void,
    activeStepContext?: ActiveStepContext
  ): Promise<AgentRunResult> {
    const lower = userMessage.toLowerCase();
    const executedToolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> =
      [];

    const snapRes = (await this.toolsExecutor.executeTool(sessionId, 'path_get', { sessionId })) as {
      success: boolean;
      data?: { path: Array<{ id: string; position: number; status: string }>; version: number };
    };

    const lessonRes = (await this.toolsExecutor.executeTool(sessionId, 'lesson_get', {
      lessonId: activeStepContext?.lessonId ?? 'lesson-self-attention',
    })) as {
      success: boolean;
      data?: { id: string; version: number };
    };

    const currentLessonId = lessonRes.data?.id ?? activeStepContext?.lessonId ?? 'lesson-self-attention';
    const lessonVersion = lessonRes.data?.version ?? 1;
    const pathVersion = snapRes.data?.version ?? 1;

    let reply = '';

    if (lower.includes('code') || lower.includes('代码') || lower.includes('实现')) {
      const patch: LessonPatch = {
        op: 'insert',
        position: { index: 2 },
        block: {
          id: `code-${Date.now()}`,
          type: 'code',
          language: 'python',
          code: `import torch\nimport torch.nn.functional as F\n\ndef attention(q, k, v):\n    d_k = q.size(-1)\n    scores = torch.matmul(q, k.transpose(-2, -1)) / (d_k ** 0.5)\n    weights = F.softmax(scores, dim=-1)\n    return torch.matmul(weights, v)`,
          explanation: 'Core attention implementation with tensor projections.',
        },
      };

      const res = await this.toolsExecutor.executeTool(sessionId, 'lesson_patch', {
        lessonId: currentLessonId,
        baseVersion: lessonVersion,
        patches: [patch],
      });
      executedToolCalls.push({
        tool: 'lesson_patch',
        args: { lessonId: currentLessonId, baseVersion: lessonVersion },
        result: res,
      });
      reply = 'I have injected a concise PyTorch implementation into your lesson canvas.';
    } else if (
      lower.includes('simple') ||
      lower.includes('简单') ||
      lower.includes('通俗') ||
      lower.includes('比喻')
    ) {
      const patch: LessonPatch = {
        op: 'insert',
        position: { index: 1 },
        block: {
          id: `simple-${Date.now()}`,
          type: 'text',
          variant: 'callout',
          content:
            '💡 Intuitive Analogy: Imagine searching in a library catalog — Queries are your search terms, Keys are book titles, and Values are the actual book contents.',
        },
      };

      const res = await this.toolsExecutor.executeTool(sessionId, 'lesson_patch', {
        lessonId: currentLessonId,
        baseVersion: lessonVersion,
        patches: [patch],
      });
      executedToolCalls.push({
        tool: 'lesson_patch',
        args: { lessonId: currentLessonId, baseVersion: lessonVersion },
        result: res,
      });
      reply = 'Here is an intuitive mental model to simplify the concept.';
    } else if (
      lower.includes('do not understand') ||
      lower.includes("don't understand") ||
      lower.includes('dont understand') ||
      lower.includes('do not know') ||
      lower.includes("don't know") ||
      lower.includes('dont know') ||
      lower.includes('confused') ||
      lower.includes('not sure') ||
      lower.includes('不懂') ||
      lower.includes('前置') ||
      lower.includes('困惑') ||
      lower.includes('gap')
    ) {
      const probeRes = await this.toolsExecutor.executeTool(sessionId, 'probe_request', {
        prerequisiteNodeId: lower.includes('softmax') ? 'softmax' : undefined,
        reason: 'Learner expressed uncertainty; assess the prerequisite before changing the path',
      });
      executedToolCalls.push({
        tool: 'probe_request',
        args: { prerequisiteNodeId: lower.includes('softmax') ? 'softmax' : undefined },
        result: probeRes,
      });
      reply = 'I placed a short prerequisite check on the canvas before changing your path.';
    } else if (
      lower.includes('confirmed diagnosis') ||
      lower.includes('diagnosis confirmed') ||
      lower.includes('已确认诊断')
    ) {
      const detourRes = await this.toolsExecutor.executeTool(sessionId, 'path_insert_detour', {
        nodeId: 'softmax',
        diagnosisId: 'diag-confirmed-softmax',
        detourKnowledgeNodeId: 'softmax',
        detourTitle: 'Detour: Softmax Normalization',
        note: 'Diagnosed prerequisite gap from query',
      });
      executedToolCalls.push({
        tool: 'path_insert_detour',
        args: { nodeId: 'softmax', diagnosisId: 'diag-confirmed-softmax' },
        result: detourRes,
      });
      reply =
        'I detected a prerequisite gap on Softmax and inserted a targeted detour into your learning path.';
    } else {
      reply = `I understand your question about "${userMessage}". Let's break this down systematically on your lesson canvas.`;
    }

    if (emitTextDelta) {
      emitTextDelta(reply);
    }

    return { reply, toolCalls: executedToolCalls };
  }
}
