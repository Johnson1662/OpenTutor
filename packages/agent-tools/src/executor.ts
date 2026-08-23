import type {
  AssessmentResult,
  LearningPathPatch,
  Lesson,
  LessonPatch,
} from '@opentutor/protocol';

export interface DomainServicesContext {
  lessonService: {
    getLesson(lessonId: string): Lesson | null;
    applyPatches(sessionId: string, lessonId: string, baseVersion: number, patches: LessonPatch[]): { lesson: Lesson; newVersion: number };
  };
  sessionService: {
    getSnapshot(sessionId: string): { path: unknown[]; pathVersion: number } | null;
    applyPathPatches(sessionId: string, baseVersion: number, patches: LearningPathPatch[]): { path: unknown[]; newVersion: number };
  };
  knowledgeService: {
    recordAssessment(sessionId: string, assessment: AssessmentResult): void;
  };
}

export class DomainToolsExecutor {
  private readonly services: DomainServicesContext;

  constructor(services: DomainServicesContext) {
    this.services = services;
  }

  async executeTool(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      switch (toolName) {
        case 'lesson_get': {
          const lessonId = String(args.lessonId);
          const lesson = this.services.lessonService.getLesson(lessonId);
          if (!lesson) return { success: false, error: `Lesson not found: ${lessonId}` };
          return { success: true, data: lesson };
        }

        case 'lesson_patch': {
          const lessonId = String(args.lessonId);
          const baseVersion = Number(args.baseVersion);
          const patches = args.patches as LessonPatch[];
          if (!Array.isArray(patches)) {
            return { success: false, error: 'patches must be an array' };
          }
          const result = this.services.lessonService.applyPatches(sessionId, lessonId, baseVersion, patches);
          return { success: true, data: result };
        }

        case 'path_get': {
          const sid = String(args.sessionId || sessionId);
          const snapshot = this.services.sessionService.getSnapshot(sid);
          if (!snapshot) return { success: false, error: `Session not found: ${sid}` };
          return { success: true, data: { path: snapshot.path, version: snapshot.pathVersion } };
        }

        case 'path_patch': {
          const sid = String(args.sessionId || sessionId);
          const baseVersion = Number(args.baseVersion);
          const patches = args.patches as LearningPathPatch[];
          if (!Array.isArray(patches)) {
            return { success: false, error: 'patches must be an array' };
          }
          const result = this.services.sessionService.applyPathPatches(sid, baseVersion, patches);
          return { success: true, data: result };
        }

        case 'assessment_record': {
          const assessment: AssessmentResult = {
            id: `asmt-${Date.now()}`,
            knowledgeNodeId: String(args.knowledgeNodeId),
            lessonId: String(args.lessonId),
            blockId: args.blockId ? String(args.blockId) : undefined,
            result: args.result as AssessmentResult['result'],
            confidence: Number(args.confidence),
            feedback: String(args.feedback),
          };
          this.services.knowledgeService.recordAssessment(sessionId, assessment);
          return { success: true, data: { recorded: true, assessment } };
        }

        case 'knowledge_get': {
          const nodeId = String(args.nodeId);
          return {
            success: true,
            data: {
              id: nodeId,
              description: `Canonical concept entity for ${nodeId}`,
            },
          };
        }

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
