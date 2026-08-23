import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export interface ProviderAuthMethod {
  available: boolean;
  label?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  auth: {
    apiKey?: ProviderAuthMethod;
    oauth?: ProviderAuthMethod;
  };
}

export interface ProviderStatus {
  id: string;
  configured: boolean;
  authType?: string;
  authSource?: string;
  modelCount: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  reasoning: boolean;
  input: string[];
  contextWindow?: number;
}

export class ProviderService {
  private readonly runtime: ModelRuntime;

  constructor(runtime: ModelRuntime) {
    this.runtime = runtime;
  }

  listProviders(): ProviderInfo[] {
    const rawProviders = this.runtime.getProviders();

    return rawProviders.map((p) => {
      const auth = p.auth ?? {};
      const hasApiKey = Boolean(auth.apiKey);
      const hasOAuth = Boolean(auth.oauth);
      const configured = this.runtime.hasConfiguredAuth(p.id);

      return {
        id: p.id,
        name: p.name ?? p.id,
        configured,
        auth: {
          apiKey: hasApiKey
            ? { available: true, label: `${p.name ?? p.id} API key` }
            : undefined,
          oauth: hasOAuth
            ? { available: true, label: `${p.name ?? p.id} OAuth` }
            : undefined,
        },
      };
    });
  }

  async getProviderStatus(providerId: string): Promise<ProviderStatus> {
    const authStatus = this.runtime.getProviderAuthStatus(providerId);
    const configured = this.runtime.hasConfiguredAuth(providerId);
    let modelCount = 0;

    try {
      const models = await this.runtime.getAvailable(providerId);
      modelCount = models.length;
    } catch {
      modelCount = this.runtime.getModels(providerId).length;
    }

    const authSource = 'source' in authStatus && typeof authStatus.source === 'string' ? authStatus.source : undefined;

    return {
      id: providerId,
      configured,
      authSource,
      modelCount,
    };
  }

  async listModels(providerId: string): Promise<ModelInfo[]> {
    let rawModels;
    try {
      rawModels = await this.runtime.getAvailable(providerId);
    } catch {
      rawModels = this.runtime.getModels(providerId);
    }

    return rawModels.map((m) => {
      const input: string[] = ['text'];
      if (m.input?.includes('image')) {
        input.push('image');
      }

      return {
        id: m.id,
        name: m.name ?? m.id,
        providerId: m.provider,
        reasoning: m.reasoning ?? false,
        input,
        contextWindow: m.contextWindow,
      };
    });
  }

  async refreshProvider(providerId: string, timeoutMs: number = 15000): Promise<void> {
    await this.runtime.refresh({
      providers: [providerId],
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async logout(providerId: string): Promise<void> {
    await this.runtime.logout(providerId);
  }
}
