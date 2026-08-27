import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, notFound, resolveCorsOrigin } from './http-utils.ts';
import { handleAiRoutes, type AiRouteContext } from './ai-routes.ts';
import { handleAuthRoutes, type AuthRouteContext } from './auth-routes.ts';
import { handleCourseRoutes, type CourseRouteContext } from './course-routes.ts';
import { handleSessionRoutes, type SessionRouteContext } from './session-routes.ts';
import { handleAssessmentRoutes, type AssessmentRouteContext } from './assessment-routes.ts';
import { handleEventRoutes, type EventRouteContext } from './event-routes.ts';

import type { KnowledgeService } from '../services/knowledge-service.ts';
import type { LearningProgressService } from '../services/learning-progress-service.ts';
import type { DiagnosticLearningCoordinator } from '../services/diagnostic-learning-coordinator.ts';
export type RouteContext = AiRouteContext &
  AuthRouteContext &
  CourseRouteContext &
  SessionRouteContext &
  AssessmentRouteContext &
  EventRouteContext & {
    knowledgeService?: KnowledgeService;
    learningProgressService?: LearningProgressService;
    diagnosticCoordinator?: DiagnosticLearningCoordinator;
  };

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const origin = resolveCorsOrigin(req);

  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID',
      'Access-Control-Allow-Credentials': origin === '*' ? 'false' : 'true',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // 2. Health check
  if (req.method === 'GET' && url.pathname === '/healthz') {
    json(res, 200, { ok: true }, req);
    return;
  }

  // 3. Dispatch through domain route handlers
  if (await handleAiRoutes(req, res, url, ctx)) return;
  if (await handleAuthRoutes(req, res, url, ctx)) return;
  if (await handleCourseRoutes(req, res, url, ctx)) return;
  if (await handleSessionRoutes(req, res, url, ctx)) return;
  if (await handleAssessmentRoutes(req, res, url, ctx)) return;
  if (await handleEventRoutes(req, res, url, ctx)) return;

  // 4. Default 404
  notFound(res, req);
}
