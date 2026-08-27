import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LearningEvent } from '@opentutor/protocol';
import { json, writeSseHeaders, encodeSse } from './http-utils.ts';
import type { EventBus } from '../events/event-bus.ts';

export interface EventRouteContext {
  eventBus: EventBus;
}

export async function handleEventRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: EventRouteContext
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // 1. GET /api/sessions/:id/events
  const sessionEventsMatch = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/events$/);
  if (method === 'GET' && sessionEventsMatch) {
    const sessionId = sessionEventsMatch[1]!;
    writeSseHeaders(res, req);

    const lastEventIdHeader = req.headers['last-event-id'];
    const queryLastSeq = url.searchParams.get('lastSeq');
    let lastSeq = -1;

    if (typeof lastEventIdHeader === 'string') {
      lastSeq = Number(lastEventIdHeader);
    } else if (queryLastSeq !== null) {
      lastSeq = Number(queryLastSeq);
    }

    const replayAfterSeq = Number.isFinite(lastSeq) && lastSeq >= 0 ? lastSeq : -1;
    let lastSentSeq = replayAfterSeq;
    let replaying = true;
    const pending: LearningEvent[] = [];
    const send = (event: LearningEvent) => {
      if (event.seq <= lastSentSeq) return;
      lastSentSeq = event.seq;
      res.write(encodeSse(event));
    };
    const emit = (event: LearningEvent) => {
      if (replaying) pending.push(event);
      else send(event);
    };
    const unsubscribe = ctx.eventBus.subscribe(sessionId, emit);
    if (replayAfterSeq >= 0) {
      ctx.eventBus.replayMissedEvents(sessionId, replayAfterSeq, send);
    }
    replaying = false;
    pending.sort((left, right) => left.seq - right.seq).forEach(send);

    req.on('close', () => {
      unsubscribe();
    });

    return true;
  }

  // 2. GET /api/courses/:id/events
  const courseEventsMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)\/events$/);
  if (method === 'GET' && courseEventsMatch) {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      json(res, 400, { error: 'SESSION_ID_REQUIRED' }, req);
      return true;
    }
    writeSseHeaders(res, req);

    const lastEventIdHeader = req.headers['last-event-id'];
    const queryLastSeq = url.searchParams.get('lastSeq');
    let lastSeq = -1;
    if (typeof lastEventIdHeader === 'string') {
      lastSeq = Number(lastEventIdHeader);
    } else if (queryLastSeq !== null) {
      lastSeq = Number(queryLastSeq);
    }
    const replayAfterSeq = Number.isFinite(lastSeq) && lastSeq >= 0 ? lastSeq : -1;
    let lastSentSeq = replayAfterSeq;
    let replaying = true;
    const pending: LearningEvent[] = [];
    const send = (event: LearningEvent) => {
      if (event.seq <= lastSentSeq) return;
      lastSentSeq = event.seq;
      res.write(encodeSse(event));
    };
    const emit = (event: LearningEvent) => {
      if (replaying) pending.push(event);
      else send(event);
    };
    const unsubscribe = ctx.eventBus.subscribe(sessionId, emit);
    if (replayAfterSeq >= 0) {
      ctx.eventBus.replayMissedEvents(sessionId, replayAfterSeq, send);
    }
    replaying = false;
    pending.sort((left, right) => left.seq - right.seq).forEach(send);

    req.on('close', () => {
      unsubscribe();
    });

    return true;
  }

  return false;
}
