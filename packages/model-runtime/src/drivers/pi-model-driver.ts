import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { contentText, type Context } from '@earendil-works/pi-ai';
import type { ModelDriver } from './model-driver.ts';
import type { ResolvedRoleModel } from '../model-execution-service.ts';
import { ModelExecutionError } from '../model-execution-service.ts';

let debugRequestSequence = 0;

function debugModelRequest(message: string): void {
  if (process.env.OPENTUTOR_MODEL_DEBUG === '1') {
    console.error(`[model-runtime] ${message}`);
  }
}

export class PiModelDriver implements ModelDriver {
  private readonly runtime: ModelRuntime;

  constructor(runtime: ModelRuntime) {
    this.runtime = runtime;
  }

  async complete(
    resolved: ResolvedRoleModel,
    prompt: string,
    system?: string
  ): Promise<string> {
    const debug = process.env.OPENTUTOR_MODEL_DEBUG === '1';
    const requestId = debug ? ++debugRequestSequence : 0;
    const startedAt = Date.now();
    if (debug) {
      debugModelRequest(`start #${requestId} role=${resolved.role} provider=${resolved.providerId} model=${resolved.modelId}`);
    }
    const model = resolved.model ?? this.runtime.getModel(resolved.providerId, resolved.modelId);
    if (!model) {
      throw new ModelExecutionError(
        'MODEL_NOT_FOUND',
        `Model '${resolved.providerId}/${resolved.modelId}' was not found in ModelRuntime.`
      );
    }

    const context: Context = {
      systemPrompt: system,
      messages: [
        {
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ],
    };

    let response;
    try {
      const structuredRoles = new Set([
        'knowledge_compiler',
        'artifact_synthesizer',
        'course_planner',
        'lesson_generator',
      ]);
      const requestedReasoning = resolved.thinkingLevel && resolved.thinkingLevel !== 'off'
        ? resolved.thinkingLevel
        : undefined;
      const reasoning = !resolved.isRoleSpecific && structuredRoles.has(resolved.role)
        ? 'off'
        : requestedReasoning;
      response = await this.runtime.completeSimple(model, context, {
        reasoning: reasoning as any,
        timeoutMs: 120_000,
      });
    } catch (err: unknown) {
      if (debug) {
        debugModelRequest(`error #${requestId} role=${resolved.role} elapsedMs=${Date.now() - startedAt} error=${err instanceof Error ? err.message : String(err)}`);
      }
      if (err instanceof ModelExecutionError) {
        throw err;
      }
      const errorObj = err instanceof Error ? err : new Error(String(err));
      const msg = errorObj.message;
      if (errorObj.name === 'AbortError' || msg.includes('cancelled') || msg.includes('abort')) {
        throw new ModelExecutionError('MODEL_CANCELLED', msg, err);
      }
      if (msg.includes('rate limit') || msg.includes('429')) {
        throw new ModelExecutionError('MODEL_RATE_LIMITED', msg, err);
      }
      if (msg.includes('timeout') || msg.includes('timed out')) {
        throw new ModelExecutionError('MODEL_TIMEOUT', msg, err);
      }
      if (msg.includes('context') || msg.includes('token limit') || msg.includes('maximum context length')) {
        throw new ModelExecutionError('MODEL_CONTEXT_EXCEEDED', msg, err);
      }
      if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('401') || msg.includes('API key')) {
        throw new ModelExecutionError('MODEL_AUTH_REQUIRED', msg, err);
      }
      if (msg.includes('not found') || msg.includes('404')) {
        throw new ModelExecutionError('MODEL_NOT_FOUND', msg, err);
      }
      throw new ModelExecutionError('MODEL_PROVIDER_ERROR', msg, err);
    }

    if (response.stopReason === 'error' || response.errorMessage) {
      const errorMessage = response.errorMessage ?? `Model execution stopped with error: ${response.stopReason}`;
      if (debug) {
        debugModelRequest(`error #${requestId} role=${resolved.role} elapsedMs=${Date.now() - startedAt} stopReason=${response.stopReason ?? 'unknown'} error=${errorMessage}`);
      }
      if (errorMessage.toLowerCase().includes('timeout') || errorMessage.toLowerCase().includes('timed out')) {
        throw new ModelExecutionError('MODEL_TIMEOUT', errorMessage);
      }
      throw new ModelExecutionError(
        'MODEL_PROVIDER_ERROR',
        errorMessage
      );
    }

    const text = contentText(response.content);
    if (!text || text.trim().length === 0) {
      if (debug) {
        debugModelRequest(`error #${requestId} role=${resolved.role} elapsedMs=${Date.now() - startedAt} error=empty_output`);
      }
      throw new ModelExecutionError('MODEL_OUTPUT_INVALID', 'Model returned empty output.');
    }

    if (debug) {
      debugModelRequest(`finish #${requestId} role=${resolved.role} elapsedMs=${Date.now() - startedAt} chars=${text.length} stopReason=${response.stopReason ?? 'unknown'}`);
    }

    return text;
  }
}
