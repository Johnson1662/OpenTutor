import { randomUUID } from 'node:crypto';

export type AuthEventType =
  | 'auth.url'
  | 'auth.device_code'
  | 'auth.prompt'
  | 'auth.progress'
  | 'auth.completed'
  | 'auth.failed'
  | 'auth.cancelled';

export interface AuthEvent {
  id: string;
  type: AuthEventType;
  authSessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface PromptRequest {
  promptId: string;
  promptType: 'text' | 'secret' | 'select' | 'manual_code';
  message: string;
  choices?: Array<{ id: string; label: string }>;
}

export class AuthFlowSession {
  readonly id: string;
  readonly providerId: string;
  readonly authType: 'api_key' | 'oauth';
  readonly abortController: AbortController;
  private readonly events: AuthEvent[] = [];
  private readonly listeners: Array<(event: AuthEvent) => void> = [];
  private readonly pendingPrompts = new Map<
    string,
    { resolve: (value: string) => void; reject: (err: Error) => void }
  >();
  private sessionStatus: 'active' | 'completed' | 'failed' | 'cancelled' = 'active';

  constructor(providerId: string, authType: 'api_key' | 'oauth') {
    this.id = `auth-${randomUUID()}`;
    this.providerId = providerId;
    this.authType = authType;
    this.abortController = new AbortController();
  }

  get status(): 'active' | 'completed' | 'failed' | 'cancelled' {
    return this.sessionStatus;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  subscribe(listener: (event: AuthEvent) => void): () => void {
    this.listeners.push(listener);
    // Replay existing events for newly attached listener
    for (const evt of this.events) {
      listener(evt);
    }
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  emit(type: AuthEventType, data: Record<string, unknown> = {}): void {
    const event: AuthEvent = {
      id: randomUUID(),
      type,
      authSessionId: this.id,
      timestamp: new Date().toISOString(),
      data,
    };
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Suppress listener error
      }
    }
  }

  async prompt(request: {
    type: 'text' | 'secret' | 'select' | 'manual_code';
    message: string;
    choices?: Array<{ id: string; label: string }>;
  }): Promise<string> {
    if (this.signal.aborted) {
      throw new Error('Auth session aborted');
    }

    const promptId = `prompt-${randomUUID()}`;
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    this.pendingPrompts.set(promptId, { resolve, reject });

    this.emit('auth.prompt', {
      promptId,
      promptType: request.type,
      message: request.message,
      choices: request.choices,
    });

    return await promise;
  }

  respond(promptId: string, value: string): boolean {
    const pending = this.pendingPrompts.get(promptId);
    if (!pending) {
      return false;
    }
    this.pendingPrompts.delete(promptId);
    pending.resolve(value);
    return true;
  }

  complete(): void {
    if (this.sessionStatus !== 'active') return;
    this.sessionStatus = 'completed';
    this.emit('auth.completed');
    for (const [, p] of this.pendingPrompts) {
      p.reject(new Error('Auth completed without answering prompt'));
    }
    this.pendingPrompts.clear();
  }

  fail(error: string): void {
    if (this.sessionStatus !== 'active') return;
    this.sessionStatus = 'failed';
    this.emit('auth.failed', { error });
    for (const [, p] of this.pendingPrompts) {
      p.reject(new Error(error));
    }
    this.pendingPrompts.clear();
  }

  cancel(): void {
    if (this.sessionStatus !== 'active') return;
    this.sessionStatus = 'cancelled';
    this.abortController.abort();
    this.emit('auth.cancelled');
    for (const [, p] of this.pendingPrompts) {
      p.reject(new Error('Auth session cancelled'));
    }
    this.pendingPrompts.clear();
  }
}
