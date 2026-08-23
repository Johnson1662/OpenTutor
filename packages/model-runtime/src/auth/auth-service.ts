import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { AuthFlowSession } from './auth-flow-session.ts';

export class AuthService {
  private readonly runtime: ModelRuntime;
  private readonly activeSessions = new Map<string, AuthFlowSession>();

  constructor(runtime: ModelRuntime) {
    this.runtime = runtime;
  }

  startAuthSession(providerId: string, authType: 'api_key' | 'oauth'): AuthFlowSession {
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
      })
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        session.fail(errorMsg);
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
    return this.activeSessions.get(sessionId);
  }

  respond(sessionId: string, promptId: string, value: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return false;
    }
    return session.respond(promptId, value);
  }

  cancel(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.cancel();
    this.activeSessions.delete(sessionId);
    return true;
  }
}
