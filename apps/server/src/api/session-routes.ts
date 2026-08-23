import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AcceptedResponse, RunTutorActionRequest } from '@opentutor/protocol';
import { json, readJson } from './http-utils.ts';
import type { SessionService } from '../services/session-service.ts';
import type { TutorRuntime } from '@opentutor/agent-runtime';
import type { TraceRepository } from '@opentutor/database';
import type { EventBus } from '../events/event-bus.ts';

export interface SessionRouteContext {
  sessionService: SessionService;
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

  // 2. POST /api/sessions/:id/actions
  const actionMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/actions$/);
  if (method === 'POST' && actionMatch) {
    const sessionId = actionMatch[1]!;
    const body = await readJson<RunTutorActionRequest>(req);
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
    const body = await readJson<{ message: string }>(req);
    const requestId = `msg-${randomUUID()}`;

    ctx.eventBus.publish(sessionId, 'agent.started', {
      requestId,
    });

    ctx.tutorRuntime
      .runTurn({
        sessionId,
        requestId,
        message: body.message,
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
    const runs = ctx.traceRepo.getRuns(sessionId);
    const toolCalls = runs.flatMap((r) => ctx.traceRepo.getToolCalls(r.id));
    json(res, 200, { runs, toolCalls }, req);
    return true;
  }

  return false;
}
