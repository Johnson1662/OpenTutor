import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  TUTOR_TOOL_NAMES,
  type DomainToolsExecutor,
} from '@opentutor/tutor-tools';
import { createOpenTutorResourceLoader } from './opentutor-resource-loader.ts';

export interface SessionModelResolverLike {
  resolveSessionModel(sessionId: string): Promise<{
    providerId?: string;
    modelId?: string;
    model?: Model<Api>;
    thinkingLevel?: ThinkingLevel;
  }>;
}

export interface TurnContextInfo {
  requestId: string;
  retrieval: {
    consumeStep: (tool: string, query?: string) => void;
  };
}

export interface PiSessionRegistryOptions {
  cwd?: string;
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  apiKey?: string;
  baseURL?: string;
  modelRuntime?: ModelRuntime;
  sessionModelResolver?: SessionModelResolverLike;
  getTurnContext?: (sessionId: string) => TurnContextInfo | undefined;
}

export class PiSessionRegistry {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly options: PiSessionRegistryOptions;

  constructor(toolsExecutor: DomainToolsExecutor, options: PiSessionRegistryOptions = {}) {
    this.toolsExecutor = toolsExecutor;
    this.options = options;
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  async getOrCreateSession(
    sessionId: string,
    onToolStart?: (toolCallId: string, toolName: string) => void,
    onToolEnd?: (toolCallId: string, toolName: string, success: boolean) => void,
    getTurnContext?: () => TurnContextInfo | undefined
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    let model = this.options.model;
    let thinkingLevel = this.options.thinkingLevel;

    if (this.options.sessionModelResolver) {
      const resolved = await this.options.sessionModelResolver.resolveSessionModel(sessionId);
      if (resolved.model) {
        model = resolved.model;
      }
      if (resolved.thinkingLevel) {
        thinkingLevel = resolved.thinkingLevel;
      }
    }

    const cwd = this.options.cwd ?? process.cwd();
    const turnContextResolver =
      getTurnContext ?? (() => this.options.getTurnContext?.(sessionId));

    const resourceLoader = await createOpenTutorResourceLoader({
      cwd,
      extensionOptions: {
        sessionId,
        executor: this.toolsExecutor,
        getTurnContext: turnContextResolver,
        onToolStart,
        onToolEnd,
      },
    });

    const settingsManager = SettingsManager.inMemory({
      retry: { enabled: true, maxRetries: 2 },
    });

    const result = await createAgentSession({
      cwd,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd),
      modelRuntime: this.options.modelRuntime,
      model,
      thinkingLevel,
      noTools: 'builtin',
      tools: Array.from(TUTOR_TOOL_NAMES),
    });

    const session = result.session;
    this.sessions.set(sessionId, session);
    return session;
  }

  async disposeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.dispose();
      } catch {
        // Safe disposal
      }
      this.sessions.delete(sessionId);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async clear(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.disposeSession(id)));
    this.sessions.clear();
  }
}
