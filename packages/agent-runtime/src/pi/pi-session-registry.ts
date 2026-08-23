import { createAgentSession, type AgentSession, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { DomainToolsExecutor } from '@opentutor/agent-tools';
import { SOCRATIC_TUTOR_SYSTEM_PROMPT } from '../prompt.ts';
import { createTutorTools, TUTOR_ALLOWED_TOOLS, validateTutorToolAllowlist } from './pi-tool-adapter.ts';

export interface PiSessionRegistryOptions {
  cwd?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

export class PiSessionRegistry {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly toolsExecutor: DomainToolsExecutor;
  private readonly options: PiSessionRegistryOptions;

  constructor(toolsExecutor: DomainToolsExecutor, options: PiSessionRegistryOptions = {}) {
    this.toolsExecutor = toolsExecutor;
    this.options = options;
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
