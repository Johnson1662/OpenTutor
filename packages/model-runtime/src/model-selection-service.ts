import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ModelPreferencesRepository } from './preferences/model-preferences-repository.ts';

export interface SelectedModelResult {
  providerId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  model?: Model<any>;
  isConfigured: boolean;
}

export class ModelSelectionService {
  private readonly runtime: ModelRuntime;
  private readonly preferencesRepo: ModelPreferencesRepository;

  constructor(runtime: ModelRuntime, preferencesRepo: ModelPreferencesRepository) {
    this.runtime = runtime;
    this.preferencesRepo = preferencesRepo;
  }

  async resolveSelectedModel(userId: string = 'default-user'): Promise<SelectedModelResult> {
    const prefs = this.preferencesRepo.getPreferences(userId);

    const providerId = prefs?.defaultProviderId ?? process.env.OPENTUTOR_DEFAULT_PROVIDER ?? 'anthropic';
    const modelId = prefs?.defaultModelId ?? process.env.OPENTUTOR_DEFAULT_MODEL ?? 'claude-3-7-sonnet-20250219';
    const rawThinking = prefs?.thinkingLevel ?? 'medium';
    const thinkingLevel: ThinkingLevel =
      rawThinking === 'off' || rawThinking === 'low' || rawThinking === 'medium' || rawThinking === 'high'
        ? rawThinking
        : 'medium';

    const model = this.runtime.getModel(providerId, modelId);
    const isConfigured = this.runtime.hasConfiguredAuth(providerId);

    return {
      providerId,
      modelId,
      thinkingLevel,
      model: model ?? undefined,
      isConfigured,
    };
  }
}
