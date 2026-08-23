import { randomUUID } from 'node:crypto';
import type {
  CourseRepository,
  CourseRecord,
  CourseSourceRecord,
  CourseMapData,
  SessionRepository,
  LessonRepository,
} from '@opentutor/database';
import type { LivingKnowledgeCompiler } from '@opentutor/knowledge-core';
import type { CourseCompiler } from '@opentutor/course-core';
import type { LessonGenerator } from '@opentutor/lesson-core';
import { FakeLessonGenerator } from '@opentutor/lesson-core';
import type { EventBus } from '../events/event-bus.ts';
import type { LearningSessionSnapshot } from '@opentutor/protocol';

export class CourseService {
  private readonly courseRepo: CourseRepository;
  private readonly sessionRepo: SessionRepository;
  private readonly lessonRepo: LessonRepository;
  private readonly knowledgeCompiler: LivingKnowledgeCompiler;
  private readonly courseCompiler: CourseCompiler;
  private readonly lessonGenerator: LessonGenerator;
  private readonly eventBus: EventBus;

  constructor(
    courseRepo: CourseRepository,
    sessionRepo: SessionRepository,
    lessonRepo: LessonRepository,
    knowledgeCompiler: LivingKnowledgeCompiler,
    courseCompiler: CourseCompiler,
    lessonGenerator?: LessonGenerator,
    eventBus?: EventBus
  ) {
    this.courseRepo = courseRepo;
    this.sessionRepo = sessionRepo;
    this.lessonRepo = lessonRepo;
    this.knowledgeCompiler = knowledgeCompiler;
    this.courseCompiler = courseCompiler;
    this.lessonGenerator = lessonGenerator ?? new FakeLessonGenerator();
    this.eventBus = eventBus!;
  }

  createCourse(params: { id?: string; title: string; description?: string }): CourseRecord {
    const id = params.id || `course-${randomUUID().slice(0, 8)}`;
    return this.courseRepo.createCourse({
      id,
      title: params.title,
      description: params.description,
      compileStatus: 'draft',
    });
  }

  getCourse(id: string): CourseRecord | null {
    return this.courseRepo.getCourse(id);
  }

  listCourses(): CourseRecord[] {
    return this.courseRepo.listCourses();
  }

  updateCourse(id: string, changes: Partial<CourseRecord>): CourseRecord | null {
    return this.courseRepo.updateCourse(id, changes);
  }

  addSource(courseId: string, title: string, content: string): CourseSourceRecord {
    return this.courseRepo.addCourseSource(courseId, title, content);
  }

  listSources(courseId: string): CourseSourceRecord[] {
    return this.courseRepo.listCourseSources(courseId);
  }

  deleteSource(courseId: string, sourceId: string): boolean {
    this.courseRepo.deleteCourseSource(courseId, sourceId);
    this.knowledgeCompiler.lifecycle.deleteDocument(sourceId);
    return true;
  }

  getCourseMap(courseId: string): CourseMapData {
    return this.courseRepo.getCourseMap(courseId);
  }

  async compileCourse(
    courseId: string,
    learningGoal: string,
    userId: string = 'default-user'
  ): Promise<{
    course: CourseRecord;
    snapshot: LearningSessionSnapshot;
  }> {
    const course = this.courseRepo.getCourse(courseId);
    if (!course) {
      throw new Error(`Course not found: ${courseId}`);
    }

    const sessionId = courseId === 'transformer' ? 'prototype' : `session-${courseId}`;
    const now = new Date().toISOString();

    // 1. Ensure learning session exists before appending events
    try {
      this.sessionRepo.createSession({
        id: sessionId,
        courseId,
        userId,
        path: [],
      });
    } catch {
      // Session already exists
    }

    // 2. Mark status compiling and emit started event
    this.courseRepo.updateCourse(courseId, { compileStatus: 'compiling' });
    this.eventBus.publish(sessionId, 'agent.started', {
      requestId: `compile-${courseId}`,
      action: undefined,
    });

    try {
      // 3. Ingest all course sources into Living Knowledge
      const sources = this.courseRepo.listCourseSources(courseId);
      for (const src of sources) {
        await this.knowledgeCompiler.ingestAndCompile({
          id: src.documentId,
          title: src.title,
          content: src.content,
        });
      }

      // 4. Compile Course Graph & Initial Path
      const compiled = await this.courseCompiler.compileCourse({
        courseId,
        title: course.title,
        learningGoal,
        userId,
      });

      // 5. Ensure learning session and initial active lesson exist via LessonGenerator
      const firstNode = compiled.initialPath.find((n) => n.status === 'current') ?? compiled.initialPath[0];
      const knowledgeNodeId = firstNode?.knowledgeNodeId ?? 'self-attention';
      const lessonTitle = firstNode?.title ?? course.title;

      let artifact = this.knowledgeCompiler.artifacts.getLatestArtifact(knowledgeNodeId);
      if (!artifact) {
        const art = await this.knowledgeCompiler.artifacts.compile(knowledgeNodeId, lessonTitle);
        artifact = art.content;
      }

      const initialLesson = await this.lessonGenerator.generate({
        courseId,
        knowledgeNodeId,
        artifact,
        learningGoal,
      });

      // Save lesson via lessonRepo
      try {
        this.lessonRepo.saveLesson(initialLesson);
      } catch {
        // Safe update
      }

      this.sessionRepo.createSession({
        id: sessionId,
        courseId,
        userId,
        activeLessonId: initialLesson.id,
        path: compiled.initialPath,
      });

      // 6. Mark ready and complete event
      const updatedCourse = this.courseRepo.updateCourse(courseId, {
        compileStatus: 'ready',
        compiledAt: now,
        compileError: undefined,
      })!;

      this.eventBus.publish(sessionId, 'agent.completed', {
        requestId: `compile-${courseId}`,
        message: `Course compiled successfully with ${compiled.courseGraph.nodes.length} concepts.`,
      });

      const snapshot = this.sessionRepo.getSnapshot(sessionId)!;
      return {
        course: updatedCourse,
        snapshot,
      };
    } catch (err: any) {
      this.courseRepo.updateCourse(courseId, {
        compileStatus: 'failed',
        compileError: err.message ?? String(err),
      });
      this.eventBus.publish(sessionId, 'error', {
        error: err.message ?? String(err),
      });
      throw err;
    }
  }

  getOrCreateSessionForCourse(courseId: string, userId: string = 'default-user'): LearningSessionSnapshot {
    const sessionId = courseId === 'transformer' ? 'prototype' : `session-${courseId}`;
    const existing = this.sessionRepo.getSnapshot(sessionId);
    if (existing) {
      return existing;
    }

    const courseMap = this.getCourseMap(courseId);
    const firstNode = courseMap.nodes[0];
    const knId = firstNode?.knowledgeNodeId ?? 'self-attention';
    const knTitle = firstNode?.title ?? 'Overview';

    const defaultLesson = {
      schemaVersion: '1.0' as const,
      id: `lesson-${knId}`,
      courseId,
      knowledgeNodeId: knId,
      title: knTitle,
      version: 1,
      blocks: [
        {
          id: 'blk-1',
          type: 'text' as const,
          variant: 'paragraph' as const,
          content: `Welcome to ${knTitle}.`,
        },
      ],
      status: 'active' as const,
    };

    const defaultPath = courseMap.nodes.map((n, i) => ({
      id: `path-node-${n.knowledgeNodeId}`,
      knowledgeNodeId: n.knowledgeNodeId,
      title: n.title,
      type: 'main' as const,
      status: (i === 0 ? 'current' : 'upcoming') as any,
      position: n.position,
    }));

    this.sessionRepo.createSession({
      id: sessionId,
      courseId,
      userId,
      activeLessonId: `lesson-${knId}`,
      path: defaultPath.length > 0 ? defaultPath : [
        {
          id: 'path-node-self-attention',
          knowledgeNodeId: 'self-attention',
          title: 'Self Attention',
          type: 'main',
          status: 'current',
          position: 1,
        },
      ],
    });

    return this.sessionRepo.getSnapshot(sessionId)!;
  }
}
