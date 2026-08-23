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
    const body = await readJson<{ baseVersion: number; patches: LessonPatch[] }>(req);
    try {
      const updated = ctx.lessonService.applyPatches(
        'prototype',
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
      json(res, 400, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  return false;
}
