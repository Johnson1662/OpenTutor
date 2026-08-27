import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AgentSessionRepository } from '@opentutor/database';
import type { ModelPreferencesRepository } from './preferences/model-preferences-repository.ts';
import { resolveSelectedModel } from './model-execution-service.ts';

export interface ResolvedSessionModel {
  providerId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  model?: Model<any>;
  isBound: boolean;
}

export class SessionModelResolver {
  private readonly modelRuntime: ModelRuntime;
  private readonly preferencesRepo: ModelPreferencesRepository;
  private readonly agentSessionRepo: AgentSessionRepository;

  constructor(
    modelRuntime: ModelRuntime,
    preferencesRepo: ModelPreferencesRepository,
    agentSessionRepo: AgentSessionRepository
  ) {
    this.modelRuntime = modelRuntime;
    this.preferencesRepo = preferencesRepo;
    this.agentSessionRepo = agentSessionRepo;
  }

  async resolveSessionModel(
    learningSessionId: string,
    userId: string = 'default-user'
  ): Promise<ResolvedSessionModel> {
    const existing = this.agentSessionRepo.getByLearningSessionId(learningSessionId);

    if (existing && existing.providerId && existing.modelId) {
      const model = this.modelRuntime.getModel(existing.providerId, existing.modelId);
      const rawThinking = existing.thinkingLevel ?? 'medium';
      const thinkingLevel: ThinkingLevel =
        rawThinking === 'off' || rawThinking === 'low' || rawThinking === 'medium' || rawThinking === 'high'
          ? rawThinking
          : 'medium';

      return {
        providerId: existing.providerId,
        modelId: existing.modelId,
        thinkingLevel,
        model: model ?? undefined,
        isBound: true,
      };
    }

    const selected = await resolveSelectedModel(this.modelRuntime, this.preferencesRepo, userId);
    const sessionId = `agent-session-${learningSessionId}`;

    const sessionRecord = this.agentSessionRepo.getOrCreate({
      id: sessionId,
      learningSessionId,
      providerId: selected.providerId,
      modelId: selected.modelId,
      thinkingLevel: selected.thinkingLevel,
    });

    if (!sessionRecord.providerId && selected.providerId && selected.modelId) {
      this.agentSessionRepo.bindModel(
        sessionRecord.id,
        selected.providerId,
        selected.modelId,
        selected.thinkingLevel
      );
    }

    return {
      providerId: selected.providerId,
      modelId: selected.modelId,
      thinkingLevel: selected.thinkingLevel,
      model: selected.model,
      isBound: false,
    };
  }
}
