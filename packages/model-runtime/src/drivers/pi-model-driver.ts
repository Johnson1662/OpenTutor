import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { contentText, type Context } from '@earendil-works/pi-ai';
import type { ModelDriver } from './model-driver.ts';
import type { ResolvedRoleModel } from '../role-model-resolver.ts';
import { ModelExecutionError } from '../model-execution-service.ts';

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
      const reasoning = resolved.thinkingLevel && resolved.thinkingLevel !== 'off' ? resolved.thinkingLevel : undefined;
      response = await this.runtime.completeSimple(model, context, {
        reasoning: reasoning as any,
      });
    } catch (err: unknown) {
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
      throw new ModelExecutionError(
        'MODEL_PROVIDER_ERROR',
        response.errorMessage ?? `Model execution stopped with error: ${response.stopReason}`
      );
    }

    const text = contentText(response.content);
    if (!text || text.trim().length === 0) {
      throw new ModelExecutionError('MODEL_OUTPUT_INVALID', 'Model returned empty output.');
    }

    return text;
  }
}
