import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeSseHeaders, encodeSse } from './http-utils.ts';
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

    if (!Number.isNaN(lastSeq) && lastSeq >= 0) {
      const missed = ctx.eventBus.getEventsSince(sessionId, lastSeq);
      for (const event of missed) {
        res.write(encodeSse(event));
      }
    }

    const unsubscribe = ctx.eventBus.subscribe(sessionId, (event) => {
      res.write(encodeSse(event));
    });

    req.on('close', () => {
      unsubscribe();
    });

    return true;
  }

  // 2. GET /api/courses/:id/events
  const courseEventsMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)\/events$/);
  if (method === 'GET' && courseEventsMatch) {
    const courseId = courseEventsMatch[1]!;
    const sessionId = courseId === 'transformer' ? 'prototype' : `session-${courseId}`;
    writeSseHeaders(res, req);

    const unsubscribe = ctx.eventBus.subscribe(sessionId, (event) => {
      res.write(encodeSse(event));
    });

    req.on('close', () => {
      unsubscribe();
    });

    return true;
  }

  return false;
}
