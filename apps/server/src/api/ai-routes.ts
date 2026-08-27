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
    const saved = ctx.preferencesRepo.getPreferences(userId);
    // No fake defaults: unset provider/model stays undefined so the UI prompts setup.
    const preferences = saved ?? {
      userId,
      thinkingLevel: 'medium',
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

  // 5. POST /api/ai/providers — register a custom model provider
  if (method === 'POST' && path === '/api/ai/providers') {
    const body = await readJson<{
      id?: string;
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      api?: string;
      models?: Array<{ id: string; name?: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
    }>(req);
    try {
      const provider = await ctx.providerService.addCustomProvider({
        id: body.id ?? '',
        name: body.name,
        baseUrl: body.baseUrl ?? '',
        apiKey: body.apiKey,
        api: body.api,
        models: body.models ?? [],
      });
      json(res, 201, provider, req);
    } catch (err: any) {
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  // 6. DELETE /api/ai/providers/:id — remove a custom provider
  const deleteProviderMatch = path.match(/^\/api\/ai\/providers\/([a-zA-Z0-9_-]+)$/);
  if (method === 'DELETE' && deleteProviderMatch) {
    try {
      await ctx.providerService.removeCustomProvider(deleteProviderMatch[1]!);
      json(res, 200, { ok: true }, req);
    } catch (err: any) {
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  return false;
}
