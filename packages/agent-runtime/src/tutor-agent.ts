import { SOCRATIC_TUTOR_SYSTEM_PROMPT } from './prompt.ts';
import { DOMAIN_TOOLS_DEFINITIONS, type DomainToolsExecutor } from '@opentutor/agent-tools';
import type { LessonPatch, LearningPathPatch } from '@opentutor/protocol';

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

export class TutorAgent {
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly apiKey: string | undefined;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly systemPrompt: string;

  constructor(toolsExecutor: DomainToolsExecutor, options?: TutorAgentOptions) {
    this.toolsExecutor = toolsExecutor;
    this.apiKey = options?.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    this.baseURL = options?.baseURL ?? process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    this.model = options?.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
    this.systemPrompt = options?.systemPrompt ?? SOCRATIC_TUTOR_SYSTEM_PROMPT;
  }

  async run(
    sessionId: string,
    userMessage: string,
    emitTextDelta?: (delta: string) => void
  ): Promise<AgentRunResult> {
    if (this.apiKey) {
      return this.runWithLlm(sessionId, userMessage, emitTextDelta);
    }
    return this.runWithPedagogicalFallback(sessionId, userMessage, emitTextDelta);
  }

  private async runWithLlm(
    sessionId: string,
    userMessage: string,
    emitTextDelta?: (delta: string) => void
  ): Promise<AgentRunResult> {
    const executedToolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userMessage },
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
        tools: DOMAIN_TOOLS_DEFINITIONS,
        tool_choice: 'auto',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`LLM call failed (${response.status}): ${errText}, falling back to rule engine.`);
      return this.runWithPedagogicalFallback(sessionId, userMessage, emitTextDelta);
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
    emitTextDelta?: (delta: string) => void
  ): Promise<AgentRunResult> {
    const lower = userMessage.toLowerCase();
    const executedToolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];

    // 1. Fetch current session snapshot via tool
    const snapRes = (await this.toolsExecutor.executeTool(sessionId, 'path_get', { sessionId })) as {
      success: boolean;
      data?: { path: Array<{ id: string; position: number; status: string }>; version: number };
    };

    const lessonRes = (await this.toolsExecutor.executeTool(sessionId, 'lesson_get', {
      lessonId: 'lesson-self-attention',
    })) as {
      success: boolean;
      data?: { id: string; version: number };
    };

    const currentLessonId = lessonRes.data?.id ?? 'lesson-self-attention';
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
      executedToolCalls.push({ tool: 'lesson_patch', args: { lessonId: currentLessonId, baseVersion: lessonVersion }, result: res });
      reply = 'I have injected a concise PyTorch implementation into your lesson canvas.';
    } else if (lower.includes('simple') || lower.includes('简单') || lower.includes('通俗') || lower.includes('比喻')) {
      const patch: LessonPatch = {
        op: 'insert',
        position: { index: 1 },
        block: {
          id: `simple-${Date.now()}`,
          type: 'text',
          variant: 'callout',
          content: '💡 Intuitive Analogy: Imagine searching in a library catalog — Queries are your search terms, Keys are book titles, and Values are the actual book contents.',
        },
      };

      const res = await this.toolsExecutor.executeTool(sessionId, 'lesson_patch', {
        lessonId: currentLessonId,
        baseVersion: lessonVersion,
        patches: [patch],
      });
      executedToolCalls.push({ tool: 'lesson_patch', args: { lessonId: currentLessonId, baseVersion: lessonVersion }, result: res });
      reply = 'Here is an intuitive mental model to simplify the concept.';
    } else if (lower.includes('softmax') || lower.includes('不懂') || lower.includes('前置') || lower.includes('gap')) {
      const pathPatch: LearningPathPatch = {
        op: 'insert_node',
        after: 'pn-2',
        node: {
          id: `detour-softmax-${Date.now()}`,
          knowledgeNodeId: 'softmax',
          title: 'Detour: Softmax Normalization',
          type: 'detour',
          position: 3,
          status: 'current',
          note: 'Diagnosed prerequisite gap from query',
        },
      };

      const res = await this.toolsExecutor.executeTool(sessionId, 'path_patch', {
        sessionId,
        baseVersion: pathVersion,
        patches: [pathPatch],
      });
      executedToolCalls.push({ tool: 'path_patch', args: { sessionId, baseVersion: pathVersion }, result: res });
      reply = 'I detected a prerequisite gap on Softmax and inserted a targeted detour into your learning path.';
    } else {
      reply = `I understand your question about "${userMessage}". Let's break this down systematically on your lesson canvas.`;
    }

    if (emitTextDelta) {
      emitTextDelta(reply);
    }

    return { reply, toolCalls: executedToolCalls };
  }
}
