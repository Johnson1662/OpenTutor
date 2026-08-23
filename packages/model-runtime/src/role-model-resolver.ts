import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { ModelSelectionService } from './model-selection-service.ts';
import type { ModelPreferencesRepository, AiRole } from './preferences/model-preferences-repository.ts';

export interface ResolvedRoleModel {
  role: AiRole;
  providerId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  model?: Model<any>;
  isRoleSpecific: boolean;
}

export class RoleModelResolver {
  private readonly modelSelectionService: ModelSelectionService;
  private readonly modelRuntime: ModelRuntime;
  private readonly preferencesRepo: ModelPreferencesRepository;

  constructor(
    modelSelectionService: ModelSelectionService,
    modelRuntime: ModelRuntime,
    preferencesRepo: ModelPreferencesRepository
  ) {
    this.modelSelectionService = modelSelectionService;
    this.modelRuntime = modelRuntime;
    this.preferencesRepo = preferencesRepo;
  }

  async resolveRoleModel(userId: string = 'default-user', role: AiRole): Promise<ResolvedRoleModel> {
    // 1. Check role-specific preference
    const rolePref = this.preferencesRepo.getRolePreference(userId, role);
    if (rolePref && rolePref.providerId && rolePref.modelId) {
      const model = this.modelRuntime.getModel(rolePref.providerId, rolePref.modelId);
      return {
        role,
        providerId: rolePref.providerId,
        modelId: rolePref.modelId,
        thinkingLevel: rolePref.thinkingLevel as ThinkingLevel,
        model: model ?? undefined,
        isRoleSpecific: true,
      };
    }

    // 2. Fall back to global default preference
    const defaultSelection = await this.modelSelectionService.resolveSelectedModel(userId);
    if (defaultSelection && defaultSelection.providerId && defaultSelection.modelId) {
      const model = this.modelRuntime.getModel(defaultSelection.providerId, defaultSelection.modelId);
      const allModels = this.modelRuntime.getModels();
      if (!model && allModels.length === 0) {
        throw new Error(
          `MODEL_SETUP_REQUIRED: No AI model configured for role '${role}'. Please configure an AI Provider in Settings.`
        );
      }

      return {
        role,
        providerId: defaultSelection.providerId,
        modelId: defaultSelection.modelId,
        thinkingLevel: defaultSelection.thinkingLevel,
        model: model ?? defaultSelection.model,
        isRoleSpecific: false,
      };
    }

    // 3. Fallback to first available configured model if runtime has any
    const allModels = this.modelRuntime.getModels();
    if (allModels.length > 0) {
      const fallback = allModels[0] as any;
      return {
        role,
        providerId: fallback.providerId ?? fallback.provider,
        modelId: fallback.id,
        thinkingLevel: 'medium',
        model: fallback,
        isRoleSpecific: false,
      };
    }

    throw new Error(
      `MODEL_SETUP_REQUIRED: No AI model configured for role '${role}'. Please configure an AI Provider in Settings.`
    );
  }
}
