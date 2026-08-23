import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readJson } from './http-utils.ts';
import type { AuthService } from '@opentutor/model-runtime';

export interface AuthRouteContext {
  authService: AuthService;
}

export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: AuthRouteContext
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // 1. POST /api/ai/auth/sessions or /api/auth/:providerId/start
  if (method === 'POST' && path === '/api/ai/auth/sessions') {
    const body = await readJson<{ providerId: string; type?: string; method?: string }>(req);
    const authType = body.type === 'oauth' || body.method === 'oauth' ? 'oauth' : 'api_key';
    try {
      const authSession = ctx.authService.startAuthSession(body.providerId, authType);
      json(res, 201, {
        authSessionId: authSession.id,
        sessionId: authSession.id,
        providerId: authSession.providerId,
        status: authSession.status,
      }, req);
    } catch (err: any) {
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  const startMatch = path.match(/^\/api\/auth\/([a-zA-Z0-9_-]+)\/start$/);
  if (method === 'POST' && startMatch) {
    const providerId = startMatch[1]!;
    const body = await readJson<{ method?: string }>(req).catch(() => ({} as { method?: string }));
    const authType = body.method === 'oauth' ? 'oauth' : 'api_key';
    try {
      const authSession = ctx.authService.startAuthSession(providerId, authType);
      json(res, 200, {
        authSessionId: authSession.id,
        sessionId: authSession.id,
        providerId: authSession.providerId,
        status: authSession.status,
      }, req);
    } catch (err: any) {
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  // 2. DELETE /api/ai/auth/sessions/:id or POST /api/auth/:id/cancel
  const cancelSessionMatch = path.match(/^\/api\/ai\/auth\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (method === 'DELETE' && cancelSessionMatch) {
    const sessionId = cancelSessionMatch[1]!;
    ctx.authService.cancel(sessionId);
    json(res, 200, { cancelled: true }, req);
    return true;
  }

  const cancelMatch = path.match(/^\/api\/auth\/([a-zA-Z0-9_-]+)\/cancel$/);
  if (method === 'POST' && cancelMatch) {
    const sessionId = cancelMatch[1]!;
    ctx.authService.cancel(sessionId);
    json(res, 200, { ok: true, cancelled: true }, req);
    return true;
  }

  // 3. POST /api/auth/:sessionId/respond
  const respondMatch = path.match(/^\/api\/auth\/([a-zA-Z0-9_-]+)\/respond$/);
  if (method === 'POST' && respondMatch) {
    const sessionId = respondMatch[1]!;
    const body = await readJson<{ promptId: string; response: string }>(req);
    const session = ctx.authService.getSession(sessionId);
    if (!session) {
      json(res, 404, { error: 'AUTH_SESSION_NOT_FOUND' }, req);
      return true;
    }
    session.respond(body.promptId, body.response);
    json(res, 200, { ok: true }, req);
    return true;
  }

  return false;
}
