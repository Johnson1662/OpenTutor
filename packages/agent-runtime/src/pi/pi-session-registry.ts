import { createAgentSession, type AgentSession, type ToolDefinition, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { DomainToolsExecutor } from '@opentutor/agent-tools';
import { SOCRATIC_TUTOR_SYSTEM_PROMPT } from '../prompt.ts';
import { createTutorTools, TUTOR_ALLOWED_TOOLS, validateTutorToolAllowlist } from './pi-tool-adapter.ts';

export interface PiSessionRegistryOptions {
  cwd?: string;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  apiKey?: string;
  baseURL?: string;
  modelRuntime?: ModelRuntime;
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
    onToolEnd?: (toolCallId: string, toolName: string, success: boolean) => void
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const tutorTools = createTutorTools(sessionId, this.toolsExecutor, onToolStart, onToolEnd);
    validateTutorToolAllowlist(tutorTools);

    const { session } = await createAgentSession({
      cwd: this.options.cwd ?? process.cwd(),
      modelRuntime: this.options.modelRuntime,
      model: this.options.model,
      thinkingLevel: this.options.thinkingLevel,
      noTools: 'builtin',
      customTools: tutorTools as unknown as ToolDefinition[],
      tools: Array.from(TUTOR_ALLOWED_TOOLS),
    });

    session.agent.state.systemPrompt = SOCRATIC_TUTOR_SYSTEM_PROMPT;
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

  clear(): void {
    for (const [id] of this.sessions) {
      this.disposeSession(id);
    }
    this.sessions.clear();
  }
}
