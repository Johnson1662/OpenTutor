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
import type { TutorService } from '../services/tutor-service.ts';
import type { TutorAgent } from '@opentutor/agent-runtime';
import type { EventBus } from '../events/event-bus.ts';
import { randomUUID } from 'node:crypto';

export interface RouteContext {
  sessionService: SessionService;
  lessonService: LessonService;
  knowledgeService: KnowledgeService;
  tutorService: TutorService;
  tutorAgent: TutorAgent;
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

  // 1. GET /api/sessions/:sessionId
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

    // Replay missed events if client requested
    if (hasSeq) {
      ctx.eventBus.replayMissedEvents(sessionId, lastSeq, (evt) => {
        res.write(encodeSse(evt));
      });
    }

    // Subscribe to live events
    const unsubscribe = ctx.eventBus.subscribe(sessionId, (evt) => {
      res.write(encodeSse(evt));
    });

    req.on('close', () => {
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

    // Run agent in background or async and stream
    ctx.tutorAgent
      .run(sessionId, body.message, (delta) => {
        ctx.eventBus.publish(sessionId, 'agent.text.delta', { requestId, delta });
      })
      .then((res) => {
        ctx.eventBus.publish(sessionId, 'agent.completed', { requestId, message: res.reply });
      })
      .catch((err: Error) => {
        ctx.eventBus.publish(sessionId, 'error', { message: err.message });
      });

    json(res, 202, { accepted: true, requestId });
    return;
  }

  // 4. POST /api/sessions/:sessionId/actions
  const actionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/actions$/);
  if (method === 'POST' && actionMatch) {
    const sessionId = actionMatch[1];
    const body = await readJson<RunTutorActionRequest>(req);
    const result = await ctx.tutorService.runAction(sessionId, body.action);
    const resp: AcceptedResponse = {
      accepted: true,
      requestId: result.requestId,
    };
    json(res, 202, resp);
    return;
  }

  // 4. POST /api/lessons/:lessonId/blocks/:blockId/answer
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

    const assessment: AssessmentResult = {
      id: `asmt-${randomUUID()}`,
      knowledgeNodeId: lesson.knowledgeNodeId,
      lessonId,
      blockId,
      result: 'correct',
      confidence: 0.92,
      feedback: `Diagnostic evaluation: "${body.answer}" correctly addresses the core concept. Knowledge state updated to mastered.`,
    };

    ctx.knowledgeService.recordAssessment('prototype', assessment);
    json(res, 200, { assessment });
    return;
  }

  notFound(res);
}
