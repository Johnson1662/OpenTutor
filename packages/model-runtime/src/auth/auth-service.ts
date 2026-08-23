import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { AuthFlowSession } from './auth-flow-session.ts';

export interface AuthServiceOptions {
  sessionTtlMs?: number;
}

export class AuthService {
  private readonly runtime: ModelRuntime;
  private readonly sessionTtlMs: number;
  private readonly activeSessions = new Map<string, AuthFlowSession>();
  private readonly terminalSessions = new Map<string, { session: AuthFlowSession; expiresAt: number }>();

  constructor(runtime: ModelRuntime, options: AuthServiceOptions = {}) {
    this.runtime = runtime;
    this.sessionTtlMs = options.sessionTtlMs ?? 60_000;
  }

  startAuthSession(providerId: string, authType: 'api_key' | 'oauth'): AuthFlowSession {
    this.cleanupExpiredSessions();

    const session = new AuthFlowSession(providerId, authType);
    this.activeSessions.set(session.id, session);

    const interaction = {
      signal: session.signal,
      notify: (event: { type: string; url?: string; userCode?: string; verificationUri?: string; message?: string }) => {
        if (event.type === 'auth_url' && event.url) {
          session.emit('auth.url', { url: event.url });
        } else if (event.type === 'device_code' && event.userCode) {
          session.emit('auth.device_code', {
            userCode: event.userCode,
            verificationUri: event.verificationUri,
          });
        } else if (event.type === 'progress' && event.message) {
          session.emit('auth.progress', { message: event.message });
        }
      },
      prompt: async (req: {
        type: 'text' | 'secret' | 'select' | 'manual_code';
        message: string;
        choices?: Array<{ id: string; label: string }>;
      }) => {
        return await session.prompt(req);
      },
    };

    // Run login in background
    this.runtime
      .login(providerId, authType, interaction)
      .then(() => {
        session.complete();
        this.markSessionTerminal(session);
      })
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        session.fail(errorMsg);
        this.markSessionTerminal(session);
      });

    return session;
  }

  async loginWithApiKey(providerId: string, apiKey: string): Promise<void> {
    const interaction = {
      signal: AbortSignal.timeout(30000),
      notify: () => { },
      prompt: async () => apiKey,
    };

    await this.runtime.login(providerId, 'api_key', interaction);
  }

  getSession(sessionId: string): AuthFlowSession | undefined {
    this.cleanupExpiredSessions();
    const active = this.activeSessions.get(sessionId);
    if (active) return active;

    const terminal = this.terminalSessions.get(sessionId);
    if (terminal && terminal.expiresAt > Date.now()) {
      return terminal.session;
    }
    return undefined;
  }

  respond(sessionId: string, promptId: string, value: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }
    return session.respond(promptId, value);
  }

  cancel(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      const term = this.terminalSessions.get(sessionId);
      if (term) {
        term.session.cancel();
        return true;
      }
      return false;
    }

    session.cancel();
    this.markSessionTerminal(session);
    return true;
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  getTerminalSessionCount(): number {
    this.cleanupExpiredSessions();
    return this.terminalSessions.size;
  }

  private markSessionTerminal(session: AuthFlowSession): void {
    this.activeSessions.delete(session.id);
    this.terminalSessions.set(session.id, {
      session,
      expiresAt: Date.now() + this.sessionTtlMs,
    });
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, entry] of this.terminalSessions) {
      if (entry.expiresAt <= now) {
        this.terminalSessions.delete(id);
      }
    }
  }
}
