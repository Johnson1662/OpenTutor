import { randomUUID } from 'node:crypto';
import type {
  CourseRepository,
  CourseRecord,
  CourseSourceRecord,
  CourseMapData,
  CourseEvidenceItem,
  SessionRepository,
  LessonRepository,
} from '@opentutor/database';
import type { LivingKnowledgeCompiler } from '@opentutor/knowledge-core';
import type { CourseCompiler } from '@opentutor/course-core';
import type { LessonGenerator } from '@opentutor/lesson-core';
import { FakeLessonGenerator } from '@opentutor/lesson-core';
import type { EventBus } from '../events/event-bus.ts';
import type { LearningSessionSnapshot } from '@opentutor/protocol';
import { CourseSourceService } from './course-source-service.ts';

export class CourseService {
  private readonly courseRepo: CourseRepository;
  private readonly sessionRepo: SessionRepository;
  private readonly lessonRepo: LessonRepository;
  private readonly knowledgeCompiler: LivingKnowledgeCompiler;
  private readonly courseCompiler: CourseCompiler;
  private readonly lessonGenerator: LessonGenerator;
  private readonly eventBus: EventBus;
  readonly courseSourceService: CourseSourceService;

  constructor(
    courseRepo: CourseRepository,
    sessionRepo: SessionRepository,
    lessonRepo: LessonRepository,
    knowledgeCompiler: LivingKnowledgeCompiler,
    courseCompiler: CourseCompiler,
    lessonGenerator?: LessonGenerator,
    eventBus?: EventBus,
    courseSourceService?: CourseSourceService
  ) {
    this.courseRepo = courseRepo;
    this.sessionRepo = sessionRepo;
    this.lessonRepo = lessonRepo;
    this.knowledgeCompiler = knowledgeCompiler;
    this.courseCompiler = courseCompiler;
    this.lessonGenerator = lessonGenerator ?? new FakeLessonGenerator();
    this.eventBus = eventBus!;
    this.courseSourceService =
      courseSourceService ??
      new CourseSourceService(
        courseRepo,
        knowledgeCompiler.ingestion,
        knowledgeCompiler.lifecycle
      );
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


  addSource(courseId: string, title: string, content: string): CourseSourceRecord {
    return this.courseSourceService.addSource(courseId, title, content);
  }

  listSources(courseId: string): CourseSourceRecord[] {
    return this.courseSourceService.listSources(courseId);
  }

  deleteSource(courseId: string, sourceId: string): boolean {
    const result = this.courseSourceService.deleteSource(courseId, sourceId);
    return result.detached;
  }

  getCourseMap(courseId: string): CourseMapData {
    return this.courseRepo.getCourseMap(courseId);
  }

  getCourseEvidence(courseId: string): CourseEvidenceItem[] {
    return this.courseRepo.getCourseEvidence(courseId);
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

    const existingSession = this.sessionRepo.findSessionByCourse(courseId, userId);
    // The seeded prototype is a demo fixture, not a course-owned learner session.
    const reusableSession = existingSession?.id === 'prototype' ? null : existingSession;
    const sessionId = reusableSession?.id ?? `session-${randomUUID()}`;
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
      const scopedLesson = {
        ...initialLesson,
        id: `${initialLesson.id}-${courseId}`,
      };

      this.lessonRepo.saveLesson(scopedLesson);

      const sessionPath = compiled.initialPath.map((node) => ({
        ...node,
        id: `${node.id}-${sessionId}`,
      }));

      this.sessionRepo.createSession({
        id: sessionId,
        courseId,
        userId,
        activeLessonId: scopedLesson.id,
        path: sessionPath,
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
    const existingSession = this.sessionRepo.findSessionByCourse(courseId, userId);
    // The seeded prototype is a demo fixture, not a course-owned learner session.
    const reusableSession = existingSession?.id === 'prototype' ? null : existingSession;
    const sessionId = reusableSession?.id ?? `session-${randomUUID()}`;
    const existing = reusableSession ? this.sessionRepo.getSnapshot(reusableSession.id) : null;
    if (existing) {
      return existing;
    }

    const courseMap = this.getCourseMap(courseId);
    const firstNode = courseMap.nodes[0];
    const knId = firstNode?.knowledgeNodeId ?? 'self-attention';
    const knTitle = firstNode?.title ?? 'Overview';

    const defaultLesson = {
      schemaVersion: '1.0' as const,
      id: `lesson-${courseId}-${randomUUID().slice(0, 8)}`,
      courseId,
      knowledgeNodeId: knId,
      title: knTitle,
      version: 1,
      blocks: [
        {
          id: 'blk-1',
          type: 'text' as const,
          variant: 'definition' as const,
          content: `先把 ${knTitle} 放回整体问题里：它是这条学习路径的第一个关键概念。`,
        },
        {
          id: 'blk-2',
          type: 'text' as const,
          variant: 'example' as const,
          content: `想象一个真实任务：你需要用 ${knTitle} 解释一个输入如何得到结果。`,
        },
        {
          id: 'blk-3',
          type: 'diagram' as const,
          diagramType: 'flow' as const,
          nodes: [
            { id: 'input', label: '输入' },
            { id: 'concept', label: knTitle },
            { id: 'output', label: '结果' },
          ],
          edges: [
            { from: 'input', to: 'concept', label: '观察' },
            { from: 'concept', to: 'output', label: '应用' },
          ],
        },
        {
          id: 'blk-4',
          type: 'code' as const,
          language: 'text',
          code: `输入 → ${knTitle} → 结果`,
          explanation: '先说清楚输入、概念和结果，再进入细节。',
        },
        {
          id: 'blk-5',
          type: 'quiz' as const,
          question: `你会怎样用一句话解释 ${knTitle} 在这条路径中的作用？`,
          answerSpec: {
            type: 'open' as const,
            rubric: {
              concepts: [knTitle, '输入', '结果'],
              referenceAnswer: `${knTitle} 把输入转化为可以观察或应用的结果。`,
            },
          },
        },
      ],
      status: 'active' as const,
    };

    const defaultPath = courseMap.nodes.map((n, i) => ({
      id: `path-node-${sessionId}-${n.knowledgeNodeId}`,
      knowledgeNodeId: n.knowledgeNodeId,
      title: n.title,
      type: 'main' as const,
      status: (i === 0 ? 'current' : 'upcoming') as any,
      position: n.position,
    }));

    this.lessonRepo.saveLesson(defaultLesson);

    this.sessionRepo.createSession({
      id: sessionId,
      courseId,
      userId,
      activeLessonId: defaultLesson.id,
      path: defaultPath.length > 0 ? defaultPath : [
        {
          id: `path-node-${sessionId}-self-attention`,
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
