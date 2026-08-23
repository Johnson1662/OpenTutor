import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readJson } from './http-utils.ts';
import type { ProviderService, ModelPreferencesRepository } from '@opentutor/model-runtime';

export interface AiRouteContext {
  providerService: ProviderService;
  preferencesRepo: ModelPreferencesRepository;
}

export async function handleAiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: AiRouteContext
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // 1. GET /api/ai/providers
  if (method === 'GET' && path === '/api/ai/providers') {
    const providers = await ctx.providerService.listProviders();
    json(res, 200, providers, req);
    return true;
  }

  // 2. GET /api/ai/providers/:providerId/models
  const modelsMatch = path.match(/^\/api\/ai\/providers\/([a-zA-Z0-9_-]+)\/models$/);
  if (method === 'GET' && modelsMatch) {
    const providerId = modelsMatch[1]!;
    try {
      const models = await ctx.providerService.listModels(providerId);
      json(res, 200, { models }, req);
    } catch (err: any) {
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  // 3. GET /api/ai/preferences
  if (method === 'GET' && path === '/api/ai/preferences') {
    const userId = url.searchParams.get('userId') ?? 'default-user';
    const preferences = ctx.preferencesRepo.getPreferences(userId) ?? {
      userId,
      defaultProviderId: 'anthropic',
      defaultModelId: 'claude-3-7-sonnet-20250219',
      thinkingLevel: 'medium',
      updatedAt: new Date().toISOString(),
    };
    json(res, 200, preferences, req);
    return true;
  }

  // 4. PUT /api/ai/preferences
  if (method === 'PUT' && path === '/api/ai/preferences') {
    const body = await readJson<{
      userId?: string;
      defaultProviderId?: string;
      defaultModelId?: string;
      thinkingLevel?: string;
    }>(req);

    const userId = body.userId ?? 'default-user';
    const updated = ctx.preferencesRepo.setPreferences(userId, {
      defaultProviderId: body.defaultProviderId,
      defaultModelId: body.defaultModelId,
      thinkingLevel: body.thinkingLevel,
    });
    json(res, 200, updated, req);
    return true;
  }

  return false;
}
