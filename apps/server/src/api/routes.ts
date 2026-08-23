import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AcceptedResponse,
  AssessmentResult,
  LearningEvent,
  RunTutorActionRequest,
  SubmitQuizAnswerRequest,
} from '@opentutor/protocol';
import type { SessionService } from '../services/session-service.ts';
import type { LessonService } from '../services/lesson-service.ts';
import type { KnowledgeService } from '../services/knowledge-service.ts';
import type { AssessmentService } from '../services/assessment-service.ts';
import type { LearningProgressService } from '../services/learning-progress-service.ts';
import type { ProviderService, AuthService, ModelPreferencesRepository } from '@opentutor/model-runtime';
import type { TutorRuntime } from '@opentutor/agent-runtime';
import type { EventBus } from '../events/event-bus.ts';
import { randomUUID } from 'node:crypto';

export interface RouteContext {
  sessionService: SessionService;
  lessonService: LessonService;
  knowledgeService: KnowledgeService;
  assessmentService: AssessmentService;
  learningProgressService: LearningProgressService;
  providerService: ProviderService;
  authService: AuthService;
  preferencesRepo: ModelPreferencesRepository;
  tutorRuntime: TutorRuntime;
  eventBus: EventBus;
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? (JSON.parse(body) as T) : ({} as T);
}

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
  });
  res.end(JSON.stringify(body));
}

export function notFound(res: ServerResponse) {
  json(res, 404, { error: 'NOT_FOUND' });
}

export function writeSseHeaders(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
  });
}

export function encodeSse(event: LearningEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
    });
    res.end();
    return;
  }

  // --- AI Control Plane Routes ---
  // A1. GET /api/ai/providers
  if (method === 'GET' && pathname === '/api/ai/providers') {
    const providers = ctx.providerService.listProviders();
    json(res, 200, providers);
    return;
  }

  // A2. GET /api/ai/preferences & PUT /api/ai/preferences
  if (pathname === '/api/ai/preferences') {
    if (method === 'GET') {
      const prefs = ctx.preferencesRepo.getPreferences('default-user') ?? {
        userId: 'default-user',
        defaultProviderId: null,
        defaultModelId: null,
        thinkingLevel: 'medium',
        updatedAt: new Date().toISOString(),
      };
      json(res, 200, prefs);
      return;
    }
    if (method === 'PUT') {
      const body = await readJson<{ defaultProviderId?: string; defaultModelId?: string; thinkingLevel?: string }>(req);
      const updated = ctx.preferencesRepo.setPreferences('default-user', body);
      json(res, 200, updated);
      return;
    }
  }

  // A3. Provider Specific Actions
  const providerModelsMatch = pathname.match(/^\/api\/ai\/providers\/([^/]+)\/models$/);
  if (method === 'GET' && providerModelsMatch) {
    const providerId = providerModelsMatch[1];
    try {
      const models = await ctx.providerService.listModels(providerId);
      json(res, 200, models);
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'FAILED_TO_LIST_MODELS' });
    }
    return;
  }

  const providerRefreshMatch = pathname.match(/^\/api\/ai\/providers\/([^/]+)\/refresh$/);
  if (method === 'POST' && providerRefreshMatch) {
    const providerId = providerRefreshMatch[1];
    try {
      await ctx.providerService.refreshProvider(providerId);
      json(res, 200, { refreshed: true });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'REFRESH_FAILED' });
    }
    return;
  }

  const providerApiKeyMatch = pathname.match(/^\/api\/ai\/providers\/([^/]+)\/api-key$/);
  if (method === 'POST' && providerApiKeyMatch) {
    const providerId = providerApiKeyMatch[1];
    const body = await readJson<{ apiKey: string }>(req);
    try {
      await ctx.authService.loginWithApiKey(providerId, body.apiKey ?? '');
      json(res, 200, { success: true });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'API_KEY_LOGIN_FAILED' });
    }
    return;
  }

  const providerAuthMatch = pathname.match(/^\/api\/ai\/providers\/([^/]+)\/auth$/);
  if (method === 'DELETE' && providerAuthMatch) {
    const providerId = providerAuthMatch[1];
    try {
      await ctx.providerService.logout(providerId);
      json(res, 200, { loggedOut: true });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'LOGOUT_FAILED' });
    }
    return;
  }

  const providerStatusMatch = pathname.match(/^\/api\/ai\/providers\/([^/]+)$/);
  if (method === 'GET' && providerStatusMatch) {
    const providerId = providerStatusMatch[1];
    try {
      const status = await ctx.providerService.getProviderStatus(providerId);
      json(res, 200, status);
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'STATUS_CHECK_FAILED' });
    }
    return;
  }

  // A4. Auth Flow Sessions
  if (method === 'POST' && pathname === '/api/ai/auth/sessions') {
    const body = await readJson<{ providerId: string; type: 'api_key' | 'oauth' }>(req);
    if (!body.providerId || !body.type) {
      json(res, 400, { error: 'MISSING_PROVIDER_OR_TYPE' });
      return;
    }
    const session = ctx.authService.startAuthSession(body.providerId, body.type);
    json(res, 201, { authSessionId: session.id });
    return;
  }

  const authEventsMatch = pathname.match(/^\/api\/ai\/auth\/sessions\/([^/]+)\/events$/);
  if (method === 'GET' && authEventsMatch) {
    const authSessionId = authEventsMatch[1];
    const session = ctx.authService.getSession(authSessionId);
    if (!session) {
      notFound(res);
      return;
    }
    writeSseHeaders(res);
    const unsubscribe = session.subscribe((evt) => {
      res.write(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
    });
    req.on('close', () => {
      unsubscribe();
    });
    return;
  }

  const authRespondMatch = pathname.match(/^\/api\/ai\/auth\/sessions\/([^/]+)\/respond$/);
  if (method === 'POST' && authRespondMatch) {
    const authSessionId = authRespondMatch[1];
    const body = await readJson<{ promptId: string; value: string }>(req);
    const ok = ctx.authService.respond(authSessionId, body.promptId ?? '', body.value ?? '');
    json(res, ok ? 200 : 404, { accepted: ok });
    return;
  }

  const authCancelMatch = pathname.match(/^\/api\/ai\/auth\/sessions\/([^/]+)$/);
  if (method === 'DELETE' && authCancelMatch) {
    const authSessionId = authCancelMatch[1];
    const ok = ctx.authService.cancel(authSessionId);
    json(res, ok ? 200 : 404, { cancelled: ok });
    return;
  }

  // --- Core Learning Session Routes ---
  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (method === 'GET' && sessionMatch) {
    const sessionId = sessionMatch[1];
    const snapshot = ctx.sessionService.getSnapshot(sessionId);
    if (!snapshot) {
      notFound(res);
      return;
    }
    json(res, 200, snapshot);
    return;
  }

  // 2. GET /api/sessions/:sessionId/events (SSE with Resume)
  const eventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (method === 'GET' && eventsMatch) {
    const sessionId = eventsMatch[1];
    writeSseHeaders(res);

    // Parse Last-Event-ID from header or query param
    const lastEventIdHeader = req.headers['last-event-id'];
    const querySeq = url.searchParams.get('lastSeq') ?? url.searchParams.get('after');
    const hasSeq = lastEventIdHeader !== undefined || querySeq !== null;
    const lastSeq = Number(lastEventIdHeader ?? querySeq ?? 0);

    let lastSentSeq = lastSeq;
    const unsubscribe = ctx.eventBus.subscribe(sessionId, (evt) => {
      if (evt.seq <= lastSentSeq) return;
      lastSentSeq = evt.seq;
      res.write(encodeSse(evt));
    });

    // Subscribe before replay so mutations between the two steps are not lost.
    if (hasSeq) {
      ctx.eventBus.replayMissedEvents(sessionId, lastSeq, (evt) => {
        if (evt.seq <= lastSentSeq) return;
        lastSentSeq = evt.seq;
        res.write(encodeSse(evt));
      });
    }

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\\n\\n');
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return;
  }

  // 3. POST /api/sessions/:sessionId/messages
  const messageMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (method === 'POST' && messageMatch) {
    const sessionId = messageMatch[1];
    const body = await readJson<{ message: string }>(req);
    const requestId = `req-${randomUUID()}`;

    ctx.eventBus.publish(sessionId, 'agent.started', { requestId });

    ctx.tutorRuntime
      .runTurn({
        sessionId,
        message: body.message,
        requestId,
        onTextDelta: (delta) => {
          ctx.eventBus.publish(sessionId, 'agent.text.delta', { requestId, delta });
        },
      })
      .then((turnResult) => {
        ctx.eventBus.publish(sessionId, 'agent.completed', { requestId, message: turnResult.reply });
      })
      .catch((err: Error) => {
        ctx.eventBus.publish(sessionId, 'error', { message: err.message });
      });

    json(res, 202, { accepted: true, requestId });
    return;
  }

  // 4. POST /api/sessions/:sessionId/actions (Unified into TutorRuntime)
  const actionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/actions$/);
  if (method === 'POST' && actionMatch) {
    const sessionId = actionMatch[1];
    const body = await readJson<RunTutorActionRequest>(req);
    const requestId = `req-${randomUUID()}`;

    ctx.eventBus.publish(sessionId, 'agent.started', { requestId, action: body.action });

    const promptMap: Record<string, string> = {
      simpler: 'Explain this concept simpler with an intuitive analogy.',
      show_code: 'Show me Python implementation code for this concept.',
      visualize: 'Create a visual flow diagram for this concept.',
      softmax_unknown: 'I do not understand Softmax prerequisite.',
    };

    const promptMessage = promptMap[body.action] ?? `Execute action: ${body.action}`;

    ctx.tutorRuntime
      .runTurn({
        sessionId,
        message: promptMessage,
        requestId,
        onTextDelta: (delta) => {
          ctx.eventBus.publish(sessionId, 'agent.text.delta', { requestId, delta });
        },
      })
      .then((turnResult) => {
        ctx.eventBus.publish(sessionId, 'agent.completed', { requestId, message: turnResult.reply });
      })
      .catch((err: Error) => {
        ctx.eventBus.publish(sessionId, 'error', { message: err.message });
      });

    const resp: AcceptedResponse = {
      accepted: true,
      requestId,
    };
    json(res, 202, resp);
    return;
  }

  // 5. POST /api/lessons/:lessonId/blocks/:blockId/answer
  const answerMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/blocks\/([^/]+)\/answer$/);
  if (method === 'POST' && answerMatch) {
    const lessonId = answerMatch[1];
    const blockId = answerMatch[2];
    const body = await readJson<SubmitQuizAnswerRequest>(req);

    const lesson = ctx.lessonService.getLesson(lessonId);
    if (!lesson) {
      notFound(res);
      return;
    }

    try {
      const { assessment } = ctx.assessmentService.submitAnswer({
        sessionId: 'prototype',
        lessonId,
        blockId,
        answer: body.answer ?? '',
      });
      json(res, 200, { assessment });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'ASSESSMENT_FAILED' });
    }
    return;
  }

  notFound(res);
}
