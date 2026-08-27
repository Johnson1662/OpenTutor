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
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      json(res, 400, { error: 'SESSION_ID_REQUIRED' }, req);
      return true;
    }
    let body: SubmitQuizAnswerRequest;
    try {
      body = await readJson<SubmitQuizAnswerRequest>(req);
    } catch {
      json(res, 400, { error: 'INVALID_ANSWER_BODY' }, req);
      return true;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.answer !== 'string') {
      json(res, 400, { error: 'ANSWER_REQUIRED' }, req);
      return true;
    }

    try {
      if (ctx.diagnosticCoordinator) {
        const coordResult = await ctx.diagnosticCoordinator.submitAnswer({
          sessionId,
          lessonId,
          blockId,
          answer: body.answer,
        });
        json(res, 200, coordResult, req);
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
      const error = err.message ?? String(err);
      if (error === 'QUIZ_ANSWER_SPEC_MISSING') {
        json(res, 400, { error, message: '题目缺少 answerSpec，无法判分' }, req);
      } else {
        json(res, 400, { error }, req);
      }
    }
    return true;
  }

  return false;
}
