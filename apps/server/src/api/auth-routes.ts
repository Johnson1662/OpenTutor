import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readJson, writeSseHeaders } from './http-utils.ts';
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

  // 1. POST /api/ai/auth/login-api-key (direct API key login)
  if (method === 'POST' && path === '/api/ai/auth/login-api-key') {
    const body = await readJson<{ providerId: string; apiKey: string }>(req);
    try {
      await ctx.authService.loginWithApiKey(body.providerId, body.apiKey);
      json(res, 200, { ok: true, providerId: body.providerId, status: 'connected' }, req);
    } catch (err: any) {
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  // 2. POST /api/ai/auth/sessions
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

  // 3. GET /api/ai/auth/sessions/:sessionId/events (SSE stream for interactive auth flow)
  const authEventsMatch = path.match(/^\/api\/ai\/auth\/sessions\/([a-zA-Z0-9_-]+)\/events$/);
  if (method === 'GET' && authEventsMatch) {
    const sessionId = authEventsMatch[1]!;
    const session = ctx.authService.getSession(sessionId);
    if (!session) {
      json(res, 404, { error: 'AUTH_SESSION_NOT_FOUND' }, req);
      return true;
    }

    writeSseHeaders(res, req);
    const unsubscribe = session.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });

    req.on('close', () => {
      unsubscribe();
    });
    return true;
  }

  // 4. DELETE /api/ai/auth/sessions/:id
  const cancelSessionMatch = path.match(/^\/api\/ai\/auth\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (method === 'DELETE' && cancelSessionMatch) {
    const sessionId = cancelSessionMatch[1]!;
    ctx.authService.cancel(sessionId);
    json(res, 200, { cancelled: true }, req);
    return true;
  }

  // 5. POST /api/ai/auth/sessions/:sessionId/respond
  const respondMatch = path.match(/^\/api\/ai\/auth\/sessions\/([a-zA-Z0-9_-]+)\/respond$/);
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
