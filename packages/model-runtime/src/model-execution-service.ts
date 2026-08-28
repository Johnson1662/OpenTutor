import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { parseJsonWithRepair } from '@earendil-works/pi-ai';
import type { AiRole, ModelPreferencesRepository } from './preferences/model-preferences-repository.ts';
import type { ModelDriver } from './drivers/model-driver.ts';
import { PiModelDriver } from './drivers/pi-model-driver.ts';

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

export interface SelectedModelResult {
  providerId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  model?: Model<any>;
  isConfigured: boolean;
}

export interface ResolvedRoleModel {
  role: AiRole;
  providerId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  model?: Model<any>;
  isRoleSpecific: boolean;
}

/** Resolve the user's globally selected model: saved preference → first configured provider with a model → throw. */
export async function resolveSelectedModel(
  runtime: ModelRuntime,
  preferencesRepo: ModelPreferencesRepository,
  userId: string = 'default-user'
): Promise<SelectedModelResult> {
  const prefs = preferencesRepo.getPreferences(userId);

  const rawThinking = prefs?.thinkingLevel ?? 'medium';
  const thinkingLevel: ThinkingLevel =
    rawThinking === 'off' || rawThinking === 'low' || rawThinking === 'medium' || rawThinking === 'high'
      ? rawThinking
      : 'medium';

  // A. Saved preference wins — strict.
  if (prefs) {
    const providerId = prefs.defaultProviderId;
    const modelId = prefs.defaultModelId;
    if (!providerId || !modelId) {
      throw new ModelExecutionError(
        'MODEL_SETUP_REQUIRED',
        'MODEL_SETUP_REQUIRED: saved model preference is incomplete. Select a provider and model in Settings.'
      );
    }
    const model = runtime.getModel(providerId, modelId);
    if (!model) {
      throw new ModelExecutionError(
        'MODEL_SETUP_REQUIRED',
        `MODEL_SETUP_REQUIRED: saved model '${providerId}/${modelId}' is not available. Re-select a model in Settings.`
      );
    }
    return { providerId, modelId, thinkingLevel, model, isConfigured: runtime.hasConfiguredAuth(providerId) };
  }

  // B. No saved preference: first configured provider that has a model.
  for (const provider of runtime.getProviders()) {
    if (!runtime.hasConfiguredAuth(provider.id)) continue;
    const model = runtime.getModels(provider.id)[0];
    if (model) {
      return { providerId: provider.id, modelId: model.id, thinkingLevel, model, isConfigured: true };
    }
  }

  // C. Nothing configured — no silent fallback.
  throw new ModelExecutionError(
    'MODEL_SETUP_REQUIRED',
    'MODEL_SETUP_REQUIRED: no AI model configured. Configure a provider and model in Settings.'
  );
}

export class ModelExecutionService {
  private readonly modelRuntime: ModelRuntime;
  private readonly preferencesRepo: ModelPreferencesRepository;
  private readonly driver: ModelDriver;

  constructor(
    modelRuntime: ModelRuntime,
    preferencesRepo: ModelPreferencesRepository,
    driver?: ModelDriver
  ) {
    this.modelRuntime = modelRuntime;
    this.preferencesRepo = preferencesRepo;
    this.driver = driver ?? new PiModelDriver(modelRuntime);
  }

  async resolveRoleModel(userId: string = 'default-user', role: AiRole): Promise<ResolvedRoleModel> {
    const selection = await resolveSelectedModel(this.modelRuntime, this.preferencesRepo, userId);
    return {
      role,
      providerId: selection.providerId,
      modelId: selection.modelId,
      thinkingLevel: selection.thinkingLevel,
      model: selection.model,
      isRoleSpecific: false,
    };
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
      resolved = await this.resolveRoleModel(userId, input.role);
    } catch (err: unknown) {
      if (err instanceof ModelExecutionError) throw err;
      const errorObj = err instanceof Error ? err : new Error(String(err));
      throw new ModelExecutionError('MODEL_PROVIDER_ERROR', errorObj.message, err);
    }

    try {
      return await this.driver.complete(resolved, input.prompt, input.system);
    } catch (err: unknown) {
      this.handleExecutionError(err);
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
      resolved = await this.resolveRoleModel(userId, input.role);
    } catch (err: unknown) {
      if (err instanceof ModelExecutionError) throw err;
      const errorObj = err instanceof Error ? err : new Error(String(err));
      throw new ModelExecutionError('MODEL_PROVIDER_ERROR', errorObj.message, err);
    }

    const schemaJson = JSON.stringify(input.schema);
    const structuredPrompt = `${input.prompt}\n\nIMPORTANT: Respond ONLY with one valid JSON object. It MUST match this JSON Schema exactly:\n${schemaJson}\nDo not enclose the JSON in markdown code fences.`;

    let rawOutput: string;
    try {
      rawOutput = await this.driver.complete(resolved, structuredPrompt, input.system);
    } catch (err: unknown) {
      this.handleExecutionError(err);
    }

    // 1. Try initial parse and TypeBox validation
    const parsed = this.tryParseAndValidate<T>(rawOutput, input.schema);
    if (parsed.success) {
      return parsed.value;
    }

    // 2. Exactly one repair attempt if validation or parsing failed
    const repairPrompt = `The previous JSON response was invalid.\nErrors:\n${parsed.error}\n\nOriginal prompt:\n${input.prompt}\n\nRequired JSON Schema:\n${schemaJson}\n\nPrevious response:\n${rawOutput}\n\nPlease output one corrected JSON object matching the schema exactly, with no markdown:`;

    let repairedOutput: string;
    try {
      repairedOutput = await this.driver.complete(resolved, repairPrompt, input.system);
    } catch (err: unknown) {
      this.handleExecutionError(err);
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
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(clean);
    } catch {
      try {
        parsedJson = parseJsonWithRepair(clean);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `JSON parse error: ${msg}` };
      }
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

  private handleExecutionError(err: unknown): never {
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
}
