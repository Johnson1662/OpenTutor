import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { RoleModelResolver, ResolvedRoleModel } from './role-model-resolver.ts';
import type { AiRole } from './preferences/model-preferences-repository.ts';

export type ModelExecutionErrorCode =
  | 'MODEL_SETUP_REQUIRED'
  | 'MODEL_AUTH_REQUIRED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_CONTEXT_EXCEEDED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_OUTPUT_INVALID'
  | 'MODEL_CANCELLED'
  | 'MODEL_PROVIDER_ERROR';

export class ModelExecutionError extends Error {
  readonly code: ModelExecutionErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: ModelExecutionErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(`[${code}] ${message}`);
    this.name = 'ModelExecutionError';
    this.code = code;
    this.cause = cause;
  }
}

export interface ModelExecutionRequest<T = unknown> {
  role: AiRole;
  userId?: string;
  system?: string;
  prompt: string;
  schema?: TSchema;
}

export type ModelDriver = (
  resolved: ResolvedRoleModel,
  prompt: string,
  system?: string
) => Promise<string>;

export interface ModelExecutionService {
  completeText(input: {
    role: AiRole;
    userId?: string;
    system?: string;
    prompt: string;
  }): Promise<string>;

  completeStructured<T>(input: {
    role: AiRole;
    userId?: string;
    system?: string;
    prompt: string;
    schema: TSchema;
  }): Promise<T>;
}

export class DefaultModelExecutionService implements ModelExecutionService {
  private readonly roleResolver: RoleModelResolver;
  private readonly customDriver?: ModelDriver;

  constructor(
    roleResolver: RoleModelResolver,
    customDriver?: ModelDriver
  ) {
    this.roleResolver = roleResolver;
    this.customDriver = customDriver;
  }

  async completeText(input: {
    role: AiRole;
    userId?: string;
    system?: string;
    prompt: string;
  }): Promise<string> {
    const userId = input.userId ?? 'default-user';
    let resolved: ResolvedRoleModel;

    try {
      resolved = await this.roleResolver.resolveRoleModel(userId, input.role);
    } catch (err: any) {
      if (err.message && err.message.includes('MODEL_SETUP_REQUIRED')) {
        throw new ModelExecutionError('MODEL_SETUP_REQUIRED', err.message, err);
      }
      throw new ModelExecutionError('MODEL_PROVIDER_ERROR', err.message ?? String(err), err);
    }

    try {
      if (this.customDriver) {
        return await this.customDriver(resolved, input.prompt, input.system);
      }

      // Default simulator / test driver
      return `[Model ${resolved.providerId}/${resolved.modelId} response for ${input.role}]: ${input.prompt.slice(0, 100)}`;
    } catch (err: any) {
      this.handleExecutionError(err);
      throw err;
    }
  }

  async completeStructured<T>(input: {
    role: AiRole;
    userId?: string;
    system?: string;
    prompt: string;
    schema: TSchema;
  }): Promise<T> {
    const userId = input.userId ?? 'default-user';
    let resolved: ResolvedRoleModel;

    try {
      resolved = await this.roleResolver.resolveRoleModel(userId, input.role);
    } catch (err: any) {
      if (err.message && err.message.includes('MODEL_SETUP_REQUIRED')) {
        throw new ModelExecutionError('MODEL_SETUP_REQUIRED', err.message, err);
      }
      throw new ModelExecutionError('MODEL_PROVIDER_ERROR', err.message ?? String(err), err);
    }

    const structuredPrompt = `${input.prompt}\n\nIMPORTANT: Respond ONLY with a valid JSON object matching the required schema. Do not enclose in markdown code fences.`;

    let rawOutput: string;
    try {
      if (this.customDriver) {
        rawOutput = await this.customDriver(resolved, structuredPrompt, input.system);
      } else {
        // Fallback default mock object or minimal valid json
        rawOutput = '{}';
      }
    } catch (err: any) {
      this.handleExecutionError(err);
      throw err;
    }

    // 1. Try initial JSON parse and TypeBox validation
    const parsed = this.tryParseAndValidate<T>(rawOutput, input.schema);
    if (parsed.success) {
      return parsed.value;
    }

    // 2. Exactly one repair attempt if validation or parsing failed
    const repairPrompt = `The previous JSON response was invalid.\nErrors:\n${parsed.error}\n\nOriginal prompt:\n${input.prompt}\n\nPrevious response:\n${rawOutput}\n\nPlease output the corrected valid JSON object only:`;

    let repairedOutput: string;
    try {
      if (this.customDriver) {
        repairedOutput = await this.customDriver(resolved, repairPrompt, input.system);
      } else {
        repairedOutput = rawOutput;
      }
    } catch (err: any) {
      this.handleExecutionError(err);
      throw err;
    }

    const repairedParsed = this.tryParseAndValidate<T>(repairedOutput, input.schema);
    if (repairedParsed.success) {
      return repairedParsed.value;
    }

    throw new ModelExecutionError(
      'MODEL_OUTPUT_INVALID',
      `Failed to produce valid structured output for role '${input.role}' after 1 repair attempt. Errors: ${repairedParsed.error}`
    );
  }

  private tryParseAndValidate<T>(
    raw: string,
    schema: TSchema
  ): { success: true; value: T } | { success: false; error: string } {
    let clean = raw.trim();
    // Strip markdown code fences if model returned them
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(clean);
    } catch (e: any) {
      return { success: false, error: `JSON parse error: ${e.message}` };
    }

    const isValid = Value.Check(schema, parsedJson);
    if (isValid) {
      return { success: true, value: parsedJson as T };
    }

    const errors = [...Value.Errors(schema, parsedJson)].map(
      (e: any) => `${e.path || 'root'}: ${e.message}`
    );
    return { success: false, error: errors.join('; ') };
  }

  private handleExecutionError(err: any): never {
    const msg = err.message ?? String(err);
    if (err.name === 'AbortError' || msg.includes('cancelled') || msg.includes('abort')) {
      throw new ModelExecutionError('MODEL_CANCELLED', msg, err);
    }
    if (msg.includes('rate limit') || msg.includes('429')) {
      throw new ModelExecutionError('MODEL_RATE_LIMITED', msg, err);
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      throw new ModelExecutionError('MODEL_TIMEOUT', msg, err);
    }
    if (msg.includes('context') || msg.includes('token limit')) {
      throw new ModelExecutionError('MODEL_CONTEXT_EXCEEDED', msg, err);
    }
    if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('401')) {
      throw new ModelExecutionError('MODEL_AUTH_REQUIRED', msg, err);
    }
    if (msg.includes('not found') || msg.includes('404')) {
      throw new ModelExecutionError('MODEL_NOT_FOUND', msg, err);
    }
    throw new ModelExecutionError('MODEL_PROVIDER_ERROR', msg, err);
  }
}
