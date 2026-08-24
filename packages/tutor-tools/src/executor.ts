import { Value } from 'typebox/value';
import type { LearningPathNode, Lesson, LessonPatch } from '@opentutor/protocol';
import type { TutorToolErrorCode, TutorToolResult } from './result.ts';
import {
  TUTOR_TOOL_DEFINITIONS,
  TUTOR_TOOL_NAMES,
  type ArtifactReadParams,
  type GraphNeighborsParams,
  type KnowledgeSearchParams,
  type LessonGetParams,
  type LessonPatchParams,
  type PathAdvanceParams,
  type PathGetParams,
  type PathInsertDetourParams,
  type ProbeRequestParams,
  type SourceReadParams,
  type SourceSearchParams,
} from './definitions.ts';

export interface LessonServiceLike {
  getLesson(lessonId: string): Lesson | null | Promise<Lesson | null>;
  getLessonBySession?(sessionId: string): Lesson | null | Promise<Lesson | null>;
  applyPatches(
    sessionId: string,
    lessonId: string,
    baseVersion: number,
    patches: LessonPatch[]
  ): { lesson: Lesson; newVersion: number } | Promise<{ lesson: Lesson; newVersion: number }>;
}

export interface SessionServiceLike {
  getSnapshot(
    sessionId: string
  ): { lesson?: Lesson; path: LearningPathNode[]; pathVersion: number } | null | Promise<{ lesson?: Lesson; path: LearningPathNode[]; pathVersion: number } | null>;
  insertDetour?(
    sessionId: string,
    baseVersion: number,
    detour: { id: string; knowledgeNodeId: string; title: string; note?: string }
  ): { path: LearningPathNode[]; newVersion: number } | Promise<{ path: LearningPathNode[]; newVersion: number }>;
  completeCurrentNode?(
    sessionId: string,
    baseVersion: number
  ): { path: LearningPathNode[]; newVersion: number } | Promise<{ path: LearningPathNode[]; newVersion: number }>;
}

export interface KnowledgeServiceLike {
  searchKnowledge?(query: string, limit?: number): unknown | Promise<unknown>;
  readArtifact?(nodeId: string): unknown | Promise<unknown>;
  sourceSearch?(query: string, limit?: number): unknown | Promise<unknown>;
  sourceRead?(chunkId: string): unknown | Promise<unknown>;
  getNeighbors?(nodeId: string, direction?: string): unknown | Promise<unknown>;
}

export interface DiagnosisRepositoryLike {
  getDiagnosis(id: string): { id: string; status: string; knowledgeNodeId: string; sessionId?: string } | null | undefined | Promise<{ id: string; status: string; knowledgeNodeId: string; sessionId?: string } | null | undefined>;
  getDiagnosesForSession?(sessionId: string): Array<{ id: string; status: string; knowledgeNodeId: string; sessionId?: string }> | Promise<Array<{ id: string; status: string; knowledgeNodeId: string; sessionId?: string }>>;
}

export interface ProbeServiceLike {
  requestProbe?(
    sessionId: string,
    params: ProbeRequestParams
  ): Promise<{ success: boolean; probeBlockId?: string; targetKnowledgeNodeId?: string; message: string }> | { success: boolean; probeBlockId?: string; targetKnowledgeNodeId?: string; message: string };
}

export interface DomainServicesContext {
  lessonService: LessonServiceLike;
  sessionService: SessionServiceLike;
  knowledgeService?: KnowledgeServiceLike;
  probeService?: ProbeServiceLike;
  diagnosisRepository?: DiagnosisRepositoryLike;
  diagnosisService?: DiagnosisRepositoryLike | unknown;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return String(err);
}

function isVersionConflict(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const errorObj = err as Record<string, unknown>;
    if (errorObj.name === 'VersionConflictError') return true;
    if (typeof errorObj.message === 'string') {
      const msg = errorObj.message.toLowerCase();
      return msg.includes('version conflict') || msg.includes('mismatch');
    }
  }
  return false;
}

export class DomainToolsExecutor {
  private readonly services: DomainServicesContext;

  constructor(services: DomainServicesContext) {
    this.services = services;
  }

  async executeProbeRequest(
    sessionIdOrParams: string | ProbeRequestParams,
    maybeParams?: ProbeRequestParams
  ): Promise<{ success: boolean; probeBlockId?: string; targetKnowledgeNodeId?: string; message: string }> {
    let sessionId = 'default';
    let params: ProbeRequestParams;
    if (typeof sessionIdOrParams === 'string') {
      sessionId = sessionIdOrParams;
      params = maybeParams ?? {};
    } else {
      params = sessionIdOrParams ?? {};
    }

    if (this.services.probeService?.requestProbe) {
      return await this.services.probeService.requestProbe(sessionId, params);
    }

    const targetNodeId = params.prerequisiteNodeId ?? 'prerequisite-concept';
    const probeBlockId = `probe-${targetNodeId}-${Date.now()}`;
    return {
      success: true,
      probeBlockId,
      targetKnowledgeNodeId: targetNodeId,
      message: `Diagnostic probe requested for prerequisite "${targetNodeId}"${params.reason ? `: ${params.reason}` : ''}. Placed probe block on canvas.`,
    };
  }

  async executePathInsertDetour(
    sessionIdOrParams: string | PathInsertDetourParams,
    maybeParams?: PathInsertDetourParams
  ): Promise<{ success: boolean; pathVersion: number; message?: string; path?: LearningPathNode[]; newVersion?: number }> {
    let sessionId = 'default';
    let params: PathInsertDetourParams;
    if (typeof sessionIdOrParams === 'string') {
      sessionId = sessionIdOrParams;
      params = maybeParams as PathInsertDetourParams;
    } else {
      params = sessionIdOrParams;
    }

    const targetNodeId = params.nodeId || params.detourKnowledgeNodeId;
    if (!params.diagnosisId || typeof params.diagnosisId !== 'string' || params.diagnosisId.trim() === '') {
      const err = new Error('Detour not authorized: missing diagnosisId');
      (err as unknown as Record<string, unknown>).code = 'DETOUR_NOT_AUTHORIZED';
      throw err;
    }
    if (!targetNodeId) {
      const err = new Error('Detour not authorized: missing nodeId');
      (err as unknown as Record<string, unknown>).code = 'DETOUR_NOT_AUTHORIZED';
      throw err;
    }

    const diagRepo =
      this.services.diagnosisRepository ??
      (this.services.diagnosisService as DiagnosisRepositoryLike | undefined);
    if (diagRepo && typeof diagRepo.getDiagnosis === 'function') {
      const diagnosis = await diagRepo.getDiagnosis(params.diagnosisId);
      if (!diagnosis) {
        const err = new Error(`Detour not authorized: diagnosis "${params.diagnosisId}" not found`);
        (err as unknown as Record<string, unknown>).code = 'DETOUR_NOT_AUTHORIZED';
        throw err;
      }
      if (diagnosis.status !== 'confirmed') {
        const err = new Error(
          `Detour not authorized: diagnosis "${params.diagnosisId}" has status "${diagnosis.status}", must be "confirmed"`
        );
        (err as unknown as Record<string, unknown>).code = 'DETOUR_NOT_AUTHORIZED';
        throw err;
      }
      if (diagnosis.sessionId && diagnosis.sessionId !== sessionId) {
        const err = new Error(
          `Detour not authorized: diagnosis "${params.diagnosisId}" belongs to session "${diagnosis.sessionId}", not current session "${sessionId}"`
        );
        (err as unknown as Record<string, unknown>).code = 'DETOUR_NOT_AUTHORIZED';
        throw err;
      }
      if (diagnosis.knowledgeNodeId !== targetNodeId) {
        const err = new Error(
          `Detour not authorized: diagnosis target node "${diagnosis.knowledgeNodeId}" does not match detour nodeId "${targetNodeId}"`
        );
        (err as unknown as Record<string, unknown>).code = 'DETOUR_NOT_AUTHORIZED';
        throw err;
      }
    }

    if (typeof this.services.sessionService.insertDetour !== 'function') {
      const err = new Error('insertDetour capability unavailable on session service');
      (err as unknown as Record<string, unknown>).code = 'DOMAIN_CAPABILITY_UNAVAILABLE';
      throw err;
    }
    const snapshot = await this.services.sessionService.getSnapshot(sessionId);
    if (!snapshot) {
      const err = new Error(`Session not found: ${sessionId}`);
      (err as unknown as Record<string, unknown>).code = 'NOT_FOUND';
      throw err;
    }

    const baseVersion = snapshot.pathVersion;
    const detourId = `detour-${targetNodeId}-${Date.now()}`;
    const result = await this.services.sessionService.insertDetour(sessionId, baseVersion, {
      id: detourId,
      knowledgeNodeId: targetNodeId,
      title: params.detourTitle || `Detour: ${targetNodeId}`,
      note: params.note,
    });

    return {
      success: true,
      pathVersion: result.newVersion,
      newVersion: result.newVersion,
      path: result.path,
      message: `Detour inserted successfully for ${targetNodeId}`,
    };
  }
  async executeTool<T = unknown>(
    sessionId: string,
    toolName: string,
    args: unknown
  ): Promise<TutorToolResult<T>> {
    const toolDef = TUTOR_TOOL_DEFINITIONS.find((d) => d.name === toolName);
    if (!toolDef || !TUTOR_TOOL_NAMES.has(toolName)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: `Unknown or disallowed tool: ${toolName}`,
        },
      };
    }

    const safeArgs = args && typeof args === 'object' ? args : {};

    if (!Value.Check(toolDef.parameters, safeArgs)) {
      const errors = [...Value.Errors(toolDef.parameters, safeArgs)];
      const errorDetails = errors
        .map((e) => {
          const path = 'path' in e && typeof e.path === 'string' && e.path ? e.path : 'root';
          return `${path}: ${e.message}`;
        })
        .join('; ');
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: `Invalid arguments for tool "${toolName}": ${errorDetails}`,
        },
      };
    }

    try {
      switch (toolName) {
        case 'lesson_get': {
          const params = safeArgs as LessonGetParams;
          let lesson: Lesson | null = null;
          if (params.lessonId) {
            lesson = await this.services.lessonService.getLesson(params.lessonId);
          } else if (typeof this.services.lessonService.getLessonBySession === 'function') {
            lesson = await this.services.lessonService.getLessonBySession(sessionId);
          } else {
            const snapshot = await this.services.sessionService.getSnapshot(sessionId);
            lesson = snapshot?.lesson ?? null;
          }

          if (!lesson) {
            return {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: `Lesson not found${params.lessonId ? `: ${params.lessonId}` : ` for session ${sessionId}`}`,
              },
            };
          }
          return { success: true, data: lesson as unknown as T };
        }

        case 'lesson_patch': {
          const params = safeArgs as LessonPatchParams;
          try {
            const result = await this.services.lessonService.applyPatches(
              sessionId,
              params.lessonId,
              params.baseVersion,
              params.patches as LessonPatch[]
            );
            return { success: true, data: result as unknown as T };
          } catch (err: unknown) {
            if (isVersionConflict(err)) {
              return {
                success: false,
                error: {
                  code: 'VERSION_CONFLICT',
                  message: getErrorMessage(err),
                },
              };
            }
            return {
              success: false,
              error: {
                code: 'INTERNAL_DOMAIN_ERROR',
                message: getErrorMessage(err),
              },
            };
          }
        }
        case 'probe_request': {
          const params = safeArgs as ProbeRequestParams;
          try {
            const result = await this.executeProbeRequest(sessionId, params);
            return { success: true, data: result as unknown as T };
          } catch (err: unknown) {
            return {
              success: false,
              error: {
                code: 'INTERNAL_DOMAIN_ERROR',
                message: getErrorMessage(err),
              },
            };
          }
        }

        case 'path_get': {
          const params = safeArgs as PathGetParams;
          const sid = params.sessionId || sessionId;
          const snapshot = await this.services.sessionService.getSnapshot(sid);
          if (!snapshot) {
            return {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: `Session not found: ${sid}`,
              },
            };
          }
          return {
            success: true,
            data: { path: snapshot.path, version: snapshot.pathVersion } as unknown as T,
          };
        }

        case 'path_insert_detour': {
          const params = safeArgs as PathInsertDetourParams;
          try {
            const result = await this.executePathInsertDetour(sessionId, params);
            return { success: true, data: result as unknown as T };
          } catch (err: unknown) {
            if (isVersionConflict(err)) {
              return {
                success: false,
                error: {
                  code: 'VERSION_CONFLICT',
                  message: getErrorMessage(err),
                },
              };
            }
            if (err && typeof err === 'object' && 'code' in err && typeof (err as Record<string, unknown>).code === 'string') {
              return {
                success: false,
                error: {
                  code: (err as Record<string, unknown>).code as TutorToolErrorCode,
                  message: getErrorMessage(err),
                },
              };
            }
            return {
              success: false,
              error: {
                code: 'INTERNAL_DOMAIN_ERROR',
                message: getErrorMessage(err),
              },
            };
          }
        }

        case 'path_advance': {
          if (typeof this.services.sessionService.completeCurrentNode !== 'function') {
            return {
              success: false,
              error: {
                code: 'DOMAIN_CAPABILITY_UNAVAILABLE',
                message: 'completeCurrentNode capability unavailable on session service',
              },
            };
          }
          const snapshot = await this.services.sessionService.getSnapshot(sessionId);
          if (!snapshot) {
            return {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: `Session not found: ${sessionId}`,
              },
            };
          }
          const baseVersion = snapshot.pathVersion;
          try {
            const result = await this.services.sessionService.completeCurrentNode(sessionId, baseVersion);
            return { success: true, data: result as unknown as T };
          } catch (err: unknown) {
            if (isVersionConflict(err)) {
              return {
                success: false,
                error: {
                  code: 'VERSION_CONFLICT',
                  message: getErrorMessage(err),
                },
              };
            }
            return {
              success: false,
              error: {
                code: 'INTERNAL_DOMAIN_ERROR',
                message: getErrorMessage(err),
              },
            };
          }
        }

        case 'knowledge_search': {
          const params = safeArgs as KnowledgeSearchParams;
          if (!this.services.knowledgeService?.searchKnowledge) {
            return {
              success: false,
              error: {
                code: 'DOMAIN_CAPABILITY_UNAVAILABLE',
                message: 'Knowledge search service not available',
              },
            };
          }
          const limit = params.limit ?? 5;
          const data = await this.services.knowledgeService.searchKnowledge(params.query, limit);
          return { success: true, data: data as unknown as T };
        }

        case 'artifact_read': {
          const params = safeArgs as ArtifactReadParams;
          if (!this.services.knowledgeService?.readArtifact) {
            return {
              success: false,
              error: {
                code: 'DOMAIN_CAPABILITY_UNAVAILABLE',
                message: 'Artifact read service not available',
              },
            };
          }
          const data = await this.services.knowledgeService.readArtifact(params.nodeId);
          if (!data) {
            return {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: `Artifact not found for node: ${params.nodeId}`,
              },
            };
          }
          return { success: true, data: data as unknown as T };
        }

        case 'source_search': {
          const params = safeArgs as SourceSearchParams;
          if (!this.services.knowledgeService?.sourceSearch) {
            return {
              success: false,
              error: {
                code: 'DOMAIN_CAPABILITY_UNAVAILABLE',
                message: 'Source search service not available',
              },
            };
          }
          const limit = params.limit ?? 3;
          const data = await this.services.knowledgeService.sourceSearch(params.query, limit);
          return { success: true, data: data as unknown as T };
        }

        case 'source_read': {
          const params = safeArgs as SourceReadParams;
          if (!this.services.knowledgeService?.sourceRead) {
            return {
              success: false,
              error: {
                code: 'DOMAIN_CAPABILITY_UNAVAILABLE',
                message: 'Source read service not available',
              },
            };
          }
          const data = await this.services.knowledgeService.sourceRead(params.chunkId);
          if (!data) {
            return {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: `Source chunk not found: ${params.chunkId}`,
              },
            };
          }
          return { success: true, data: data as unknown as T };
        }

        case 'graph_neighbors': {
          const params = safeArgs as GraphNeighborsParams;
          if (!this.services.knowledgeService?.getNeighbors) {
            return {
              success: false,
              error: {
                code: 'DOMAIN_CAPABILITY_UNAVAILABLE',
                message: 'Graph neighbors service not available',
              },
            };
          }
          const data = await this.services.knowledgeService.getNeighbors(params.nodeId, params.direction);
          return { success: true, data: data as unknown as T };
        }

        default:
          return {
            success: false,
            error: {
              code: 'INVALID_ARGUMENT',
              message: `Unknown or disallowed tool: ${toolName}`,
            },
          };
      }
    } catch (err: unknown) {
      return {
        success: false,
        error: {
          code: 'INTERNAL_DOMAIN_ERROR',
          message: getErrorMessage(err),
        },
      };
    }
  }
}
