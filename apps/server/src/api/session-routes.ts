import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AcceptedResponse, AdvanceLessonProgressRequest, RunTutorActionRequest } from '@opentutor/protocol';
import { json, readJson } from './http-utils.ts';
import type { SessionService } from '../services/session-service.ts';
import type { LearningProgressService } from '../services/learning-progress-service.ts';
import type { TutorRuntime } from '@opentutor/agent-runtime';
import type { TraceRepository } from '@opentutor/database';
import type { EventBus } from '../events/event-bus.ts';

export interface SessionRouteContext {
  sessionService: SessionService;
  learningProgressService?: LearningProgressService;
  tutorRuntime: TutorRuntime;
  traceRepo: TraceRepository;
  eventBus: EventBus;
}

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: SessionRouteContext
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // 1. GET /api/sessions/:id
  const getSessionMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (method === 'GET' && getSessionMatch) {
    const sessionId = getSessionMatch[1]!;
    const snapshot = ctx.sessionService.getSnapshot(sessionId);
    if (!snapshot) {
      json(res, 404, { error: 'SESSION_NOT_FOUND' }, req);
      return true;
    }
    json(res, 200, snapshot, req);
    return true;
  }

  const lessonProgressMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/lesson-progress$/);
  if (method === 'GET' && lessonProgressMatch) {
    const sessionId = lessonProgressMatch[1]!;
    if (!ctx.learningProgressService) {
      json(res, 503, { error: 'PROGRESS_UNAVAILABLE' }, req);
      return true;
    }
    try {
      const progress = ctx.learningProgressService.getProgress(
        sessionId,
        url.searchParams.get('lessonId') ?? undefined
      );
      json(res, 200, progress, req);
    } catch (err: any) {
      json(res, err.name === 'NotFoundError' ? 404 : 400, { error: err.name ?? 'PROGRESS_ERROR', message: err.message }, req);
    }
    return true;
  }

  const advanceProgressMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/lesson-progress\/advance$/);
  if (method === 'POST' && advanceProgressMatch) {
    const sessionId = advanceProgressMatch[1]!;
    if (!ctx.learningProgressService) {
      json(res, 503, { error: 'PROGRESS_UNAVAILABLE' }, req);
      return true;
    }
    let body: AdvanceLessonProgressRequest;
    try {
      body = await readJson<AdvanceLessonProgressRequest>(req);
    } catch {
      json(res, 400, { error: 'INVALID_PROGRESS_BODY' }, req);
      return true;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      json(res, 400, { error: 'INVALID_PROGRESS_BODY' }, req);
      return true;
    }
    const snapshot = ctx.sessionService.getSnapshot(sessionId);
    if (!snapshot) {
      json(res, 404, { error: 'SESSION_NOT_FOUND' }, req);
      return true;
    }
    if (body.lessonId !== undefined && typeof body.lessonId !== 'string') {
      json(res, 400, { error: 'INVALID_LESSON_ID' }, req);
      return true;
    }
    if (!('activeBlockId' in body)) {
      json(res, 400, { error: 'ACTIVE_BLOCK_ID_REQUIRED' }, req);
      return true;
    }
    const lessonId = body.lessonId ?? snapshot.lesson.id;
    const activeBlockId = body.activeBlockId;
    if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) {
      json(res, 400, { error: 'INVALID_PROGRESS_VERSION' }, req);
      return true;
    }
    if (activeBlockId !== null && typeof activeBlockId !== 'string') {
      json(res, 400, { error: 'INVALID_ACTIVE_BLOCK_ID' }, req);
      return true;
    }
    if (body.restart !== undefined && typeof body.restart !== 'boolean') {
      json(res, 400, { error: 'INVALID_RESTART_FLAG' }, req);
      return true;
    }
    try {
      const result = await ctx.learningProgressService.advance(
        sessionId,
        lessonId,
        body.version,
        activeBlockId,
        body.restart === true
      );
      json(res, 200, result, req);
    } catch (err: any) {
      const status =
        err.name === 'VersionConflictError' ||
        err.name === 'ProgressStateConflictError' ||
        err.message?.startsWith('LESSON_NOT_ACTIVE')
          ? 409
          : err.name === 'NotFoundError'
            ? 404
            : 400;
      json(res, status, { error: err.name ?? 'PROGRESS_ERROR', message: err.message ?? String(err) }, req);
    }
    return true;
  }

  // 2. POST /api/sessions/:id/actions
  const actionMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/actions$/);
  if (method === 'POST' && actionMatch) {
    const sessionId = actionMatch[1]!;
    if (!ctx.sessionService.getSnapshot(sessionId)) {
      json(res, 404, { error: 'SESSION_NOT_FOUND' }, req);
      return true;
    }
    let body: RunTutorActionRequest;
    try {
      body = await readJson<RunTutorActionRequest>(req);
    } catch {
      json(res, 400, { error: 'INVALID_ACTION_BODY' }, req);
      return true;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string' || !body.action.trim()) {
      json(res, 400, { error: 'INVALID_ACTION' }, req);
      return true;
    }
    const requestId = `req-${randomUUID()}`;

    ctx.eventBus.publish(sessionId, 'agent.started', {
      requestId,
      action: body.action,
    });

    // Run asynchronously via TutorRuntime
    ctx.tutorRuntime
      .runTurn({
        sessionId,
        requestId,
        action: body.action,
        activeStepContext: ctx.sessionService.getActiveStepContext(sessionId) ?? undefined,
      })
      .then((turnResult) => {
        ctx.eventBus.publish(sessionId, 'agent.completed', {
          requestId,
          message: turnResult.reply,
        });
      })
      .catch((err: any) => {
        console.error(`[SessionRoutes] Action turn failed for ${sessionId}:`, err);
        ctx.eventBus.publish(sessionId, 'error', {
          error: err.message ?? String(err),
        });
      });

    const accepted: AcceptedResponse = { accepted: true, requestId };
    json(res, 202, accepted, req);
    return true;
  }

  // 3. POST /api/sessions/:id/messages
  const messageMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/messages$/);
  if (method === 'POST' && messageMatch) {
    const sessionId = messageMatch[1]!;
    if (!ctx.sessionService.getSnapshot(sessionId)) {
      json(res, 404, { error: 'SESSION_NOT_FOUND' }, req);
      return true;
    }
    let body: { message: string };
    try {
      body = await readJson<{ message: string }>(req);
    } catch {
      json(res, 400, { error: 'INVALID_MESSAGE_BODY' }, req);
      return true;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.message !== 'string' || !body.message.trim()) {
      json(res, 400, { error: 'MESSAGE_REQUIRED' }, req);
      return true;
    }
    const requestId = `msg-${randomUUID()}`;

    ctx.eventBus.publish(sessionId, 'agent.started', {
      requestId,
    });

    ctx.tutorRuntime
      .runTurn({
        sessionId,
        requestId,
        message: body.message,
        activeStepContext: ctx.sessionService.getActiveStepContext(sessionId) ?? undefined,
      })
      .then((turnResult) => {
        ctx.eventBus.publish(sessionId, 'agent.completed', {
          requestId,
          message: turnResult.reply,
        });
      })
      .catch((err: any) => {
        console.error(`[SessionRoutes] Message turn failed for ${sessionId}:`, err);
        ctx.eventBus.publish(sessionId, 'error', {
          error: err.message ?? String(err),
        });
      });

    const accepted: AcceptedResponse = { accepted: true, requestId };
    json(res, 202, accepted, req);
    return true;
  }

  // 4. GET /api/sessions/:id/traces
  const tracesMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/traces$/);
  if (method === 'GET' && tracesMatch) {
    const sessionId = tracesMatch[1]!;
    if (!ctx.sessionService.getSnapshot(sessionId)) {
      json(res, 404, { error: 'SESSION_NOT_FOUND' }, req);
      return true;
    }
    const runs = ctx.traceRepo.getRuns(sessionId);
    const toolCalls = runs.flatMap((r) => ctx.traceRepo.getToolCalls(r.id));
    json(res, 200, { runs, toolCalls }, req);
    return true;
  }

  return false;
}
