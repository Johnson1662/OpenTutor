import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readJson } from './http-utils.ts';
import type { CourseService } from '../services/course-service.ts';

export interface CourseRouteContext {
  courseService: CourseService;
}

export async function handleCourseRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: CourseRouteContext
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  // 1. POST /api/courses
  if (method === 'POST' && path === '/api/courses') {
    const body = await readJson<{ id?: string; title: string; description?: string }>(req);
    const course = ctx.courseService.createCourse(body);
    json(res, 201, { course }, req);
    return true;
  }

  // 2. GET /api/courses
  if (method === 'GET' && path === '/api/courses') {
    const courses = ctx.courseService.listCourses();
    json(res, 200, { courses }, req);
    return true;
  }

  // 3. GET /api/courses/:id
  const getCourseMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)$/);
  if (method === 'GET' && getCourseMatch) {
    const courseId = getCourseMatch[1]!;
    const course = ctx.courseService.getCourse(courseId);
    if (!course) {
      json(res, 404, { error: 'COURSE_NOT_FOUND' }, req);
      return true;
    }
    json(res, 200, { course }, req);
    return true;
  }

  // 4. PATCH /api/courses/:id
  if (method === 'PATCH' && getCourseMatch) {
    const courseId = getCourseMatch[1]!;
    const body = await readJson<{ title?: string; description?: string }>(req);
    const updated = ctx.courseService.updateCourse(courseId, body);
    if (!updated) {
      json(res, 404, { error: 'COURSE_NOT_FOUND' }, req);
      return true;
    }
    json(res, 200, { course: updated }, req);
    return true;
  }

  // 5. POST /api/courses/:id/sources
  const sourcesMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)\/sources$/);
  if (method === 'POST' && sourcesMatch) {
    const courseId = sourcesMatch[1]!;
    const body = await readJson<{ title: string; content: string }>(req);
    const source = ctx.courseService.addSource(courseId, body.title, body.content);
    json(res, 201, { source }, req);
    return true;
  }

  // 6. GET /api/courses/:id/sources
  if (method === 'GET' && sourcesMatch) {
    const courseId = sourcesMatch[1]!;
    const sources = ctx.courseService.listSources(courseId);
    json(res, 200, { sources }, req);
    return true;
  }

  // 7. DELETE /api/courses/:id/sources/:sourceId
  const deleteSourceMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)\/sources\/([a-zA-Z0-9_-]+)$/);
  if (method === 'DELETE' && deleteSourceMatch) {
    const courseId = deleteSourceMatch[1]!;
    const sourceId = deleteSourceMatch[2]!;
    const deleted = ctx.courseService.deleteSource(courseId, sourceId);
    json(res, 200, { ok: deleted }, req);
    return true;
  }

  // 8. POST /api/courses/:id/compile
  const compileMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)\/compile$/);
  if (method === 'POST' && compileMatch) {
    const courseId = compileMatch[1]!;
    const body = await readJson<{ learningGoal?: string; userId?: string }>(req).catch(() => ({}));
    const learningGoal = (body as any).learningGoal || 'Master the concepts in this course from scratch.';
    const userId = (body as any).userId || 'default-user';

    try {
      const result = await ctx.courseService.compileCourse(courseId, learningGoal, userId);
      json(res, 200, result, req);
    } catch (err: any) {
      json(res, 500, { error: err.message ?? String(err) }, req);
    }
    return true;
  }

  // 9. GET /api/courses/:id/map
  const mapMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)\/map$/);
  if (method === 'GET' && mapMatch) {
    const courseId = mapMatch[1]!;
    const courseMap = ctx.courseService.getCourseMap(courseId);
    json(res, 200, { map: courseMap }, req);
    return true;
  }

  // 10. POST /api/courses/:id/sessions
  const sessionMatch = path.match(/^\/api\/courses\/([a-zA-Z0-9_-]+)\/sessions$/);
  if (method === 'POST' && sessionMatch) {
    const courseId = sessionMatch[1]!;
    const body = await readJson<{ userId?: string }>(req).catch(() => ({}));
    const userId = (body as any).userId || 'default-user';
    const snapshot = ctx.courseService.getOrCreateSessionForCourse(courseId, userId);
    json(res, 200, { snapshot }, req);
    return true;
  }

  return false;
}
