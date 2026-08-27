import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LessonPatch } from '@opentutor/protocol';
import { json, readJson } from './http-utils.ts';
import type { LessonService } from '../services/lesson-service.ts';

export interface LessonRouteContext {
  lessonService: LessonService;
}

export async function handleLessonRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: LessonRouteContext
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // 1. GET /api/lessons/:id
  const getLessonMatch = path.match(/^\/api\/lessons\/([a-zA-Z0-9_-]+)$/);
  if (method === 'GET' && getLessonMatch) {
    const lessonId = getLessonMatch[1]!;
    const lesson = ctx.lessonService.getLesson(lessonId);
    if (!lesson) {
      json(res, 404, { error: 'LESSON_NOT_FOUND' }, req);
      return true;
    }
    json(res, 200, lesson, req);
    return true;
  }

  // 2. PATCH /api/lessons/:id
  if (method === 'PATCH' && getLessonMatch) {
    const lessonId = getLessonMatch[1]!;
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      json(res, 400, { error: 'SESSION_ID_REQUIRED' }, req);
      return true;
    }
    let body: { baseVersion: number; patches: LessonPatch[] };
    try {
      body = await readJson<{ baseVersion: number; patches: LessonPatch[] }>(req);
    } catch {
      json(res, 400, { error: 'INVALID_PATCH_BODY' }, req);
      return true;
    }
    try {
      const updated = ctx.lessonService.applyPatches(
        sessionId,
        lessonId,
        body.baseVersion,
        body.patches
      );
      json(res, 200, updated, req);
    } catch (err: any) {
      if (err.name === 'VersionConflictError') {
        json(res, 409, { error: 'VERSION_CONFLICT', message: err.message }, req);
        return true;
      }
      if (err.message?.startsWith('SESSION_NOT_FOUND')) {
        json(res, 404, { error: 'SESSION_NOT_FOUND', message: err.message }, req);
        return true;
      }
      if (err.name === 'ActiveBlockRemovalError' || err.message?.startsWith('LESSON_NOT_ACTIVE')) {
        json(res, 409, { error: err.name ?? 'LESSON_NOT_ACTIVE', message: err.message }, req);
        return true;
      }
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  return false;
}
