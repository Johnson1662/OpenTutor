import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SubmitQuizAnswerRequest } from '@opentutor/protocol';
import { json, readJson } from './http-utils.ts';
import type { AssessmentService } from '../services/assessment-service.ts';
import type { DiagnosticLearningCoordinator } from '../services/diagnostic-learning-coordinator.ts';

export interface AssessmentRouteContext {
  assessmentService: AssessmentService;
  diagnosticCoordinator?: DiagnosticLearningCoordinator;
}

export async function handleAssessmentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: AssessmentRouteContext
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // POST /api/lessons/:lessonId/blocks/:blockId/answer
  const answerMatch = path.match(/^\/api\/lessons\/([a-zA-Z0-9_-]+)\/blocks\/([a-zA-Z0-9_-]+)\/answer$/);
  if (method === 'POST' && answerMatch) {
    const lessonId = answerMatch[1]!;
    const blockId = answerMatch[2]!;
    const body = await readJson<SubmitQuizAnswerRequest>(req);
    const sessionId = url.searchParams.get('sessionId') ?? (lessonId.includes('softmax') ? 'prototype' : 'prototype');

    try {
      if (ctx.diagnosticCoordinator) {
        const coordResult = await ctx.diagnosticCoordinator.submitAnswer({
          sessionId,
          lessonId,
          blockId,
          answer: body.answer,
        });
        json(res, 200, { assessment: coordResult.assessment }, req);
      } else {
        const result = ctx.assessmentService.submitAnswer({
          sessionId,
          lessonId,
          blockId,
          answer: body.answer,
        });
        json(res, 200, result, req);
      }
    } catch (err: any) {
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  return false;
}
