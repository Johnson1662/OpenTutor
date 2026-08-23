import type {
  LearningPathNode,
  LearningPathPatch,
  Lesson,
  LessonPatch,
} from '@opentutor/protocol';

export interface DomainServicesContext {
  lessonService: {
    getLesson(lessonId: string): Lesson | null;
    applyPatches(
      sessionId: string,
      lessonId: string,
      baseVersion: number,
      patches: LessonPatch[]
    ): { lesson: Lesson; newVersion: number };
  };
  sessionService: {
    getSnapshot(sessionId: string): { path: LearningPathNode[]; pathVersion: number } | null;
    applyPathPatches(
      sessionId: string,
      baseVersion: number,
      patches: LearningPathPatch[]
    ): { path: LearningPathNode[]; newVersion: number };
    insertDetour?(
      sessionId: string,
      baseVersion: number,
      detour: { id: string; knowledgeNodeId: string; title: string; note?: string }
    ): { path: LearningPathNode[]; newVersion: number };
    completeCurrentNode?(
      sessionId: string,
      baseVersion: number
    ): { path: LearningPathNode[]; newVersion: number };
  };
  knowledgeService?: {
    searchKnowledge?(query: string, limit?: number): unknown[];
    readArtifact?(knowledgeNodeId: string): unknown;
    sourceSearch?(query: string, limit?: number): unknown[];
    sourceRead?(chunkId: string): unknown;
    getNeighbors?(knowledgeNodeId: string, direction?: string): unknown[];
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

        case 'path_insert_detour': {
          const sid = String(args.sessionId || sessionId);
          const baseVersion = Number(args.baseVersion);
          const knowledgeNodeId = String(args.knowledgeNodeId);
          const title = String(args.title);
          const note = args.note ? String(args.note) : undefined;
          const detourId = `detour-${knowledgeNodeId}-${Date.now()}`;

          if (typeof this.services.sessionService.insertDetour === 'function') {
            const result = this.services.sessionService.insertDetour(sid, baseVersion, {
              id: detourId,
              knowledgeNodeId,
              title,
              note,
            });
            return { success: true, data: result };
          }

          // Fallback via path_patch
          const snapshot = this.services.sessionService.getSnapshot(sid);
          const activeNode = snapshot?.path.find((n) => n.status === 'current');
          const patches: LearningPathPatch[] = [];
          if (activeNode) {
            patches.push({ op: 'update_node', nodeId: activeNode.id, changes: { status: 'upcoming' } });
            patches.push({
              op: 'insert_node',
              before: activeNode.id,
              node: {
                id: detourId,
                knowledgeNodeId,
                title,
                type: 'detour',
                status: 'current',
                position: activeNode.position,
                note,
              },
            });
          }
          const result = this.services.sessionService.applyPathPatches(sid, baseVersion, patches);
          return { success: true, data: result };
        }

        case 'path_advance': {
          const sid = String(args.sessionId || sessionId);
          const baseVersion = Number(args.baseVersion);
          if (typeof this.services.sessionService.completeCurrentNode === 'function') {
            const result = this.services.sessionService.completeCurrentNode(sid, baseVersion);
            return { success: true, data: result };
          }
          return { success: true, data: { advanced: true } };
        }

        case 'knowledge_search': {
          const query = String(args.query);
          const limit = Number(args.limit ?? 5);
          if (!this.services.knowledgeService?.searchKnowledge) {
            return { success: false, error: 'Knowledge service not available' };
          }
          const results = this.services.knowledgeService.searchKnowledge(query, limit);
          return { success: true, data: results };
        }

        case 'artifact_read': {
          const nodeId = String(args.knowledgeNodeId);
          if (!this.services.knowledgeService?.readArtifact) {
            return { success: false, error: 'Knowledge service not available' };
          }
          const artifact = this.services.knowledgeService.readArtifact(nodeId);
          if (!artifact) {
            return { success: false, error: `Artifact not found for node: ${nodeId}` };
          }
          return { success: true, data: artifact };
        }

        case 'source_search': {
          const query = String(args.query);
          const limit = Number(args.limit ?? 3);
          if (!this.services.knowledgeService?.sourceSearch) {
            return { success: false, error: 'Source search service not available' };
          }
          const results = this.services.knowledgeService.sourceSearch(query, limit);
          return { success: true, data: results };
        }

        case 'source_read': {
          const chunkId = String(args.chunkId);
          if (!this.services.knowledgeService?.sourceRead) {
            return { success: false, error: 'Source read service not available' };
          }
          const chunk = this.services.knowledgeService.sourceRead(chunkId);
          if (!chunk) {
            return { success: false, error: `Document chunk not found: ${chunkId}` };
          }
          return { success: true, data: chunk };
        }

        case 'graph_neighbors': {
          const nodeId = String(args.knowledgeNodeId);
          const direction = String(args.direction ?? 'all');
          if (!this.services.knowledgeService?.getNeighbors) {
            return { success: false, error: 'Graph neighbors service not available' };
          }
          const edges = this.services.knowledgeService.getNeighbors(nodeId, direction);
          return { success: true, data: edges };
        }

        default:
          return { success: false, error: `Unknown or unauthorized tool: ${toolName}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
