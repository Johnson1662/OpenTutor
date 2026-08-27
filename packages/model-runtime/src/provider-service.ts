import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { resolveModelsJsonPath, type OpenTutorModelRuntimeOptions } from './model-runtime.ts';

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

export interface CustomProviderModelInput {
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface CustomProviderInput {
  id: string;
  name?: string;
  baseUrl: string;
  apiKey?: string;
  /** Wire API; defaults to 'openai-completions' (any OpenAI-compatible endpoint). */
  api?: string;
  models: CustomProviderModelInput[];
}

export class ProviderService {
  private readonly runtime: ModelRuntime;
  private readonly modelsPath: string | null;

  constructor(runtime: ModelRuntime, options: OpenTutorModelRuntimeOptions = {}) {
    this.runtime = runtime;
    this.modelsPath = resolveModelsJsonPath(options);
  }

  listProviders(): ProviderInfo[] {
    const rawProviders = this.runtime.getProviders();
    const customIds = this.readCustomIdsSync();

    return rawProviders.map((p) => {
      const auth = p.auth ?? {};
      const hasApiKey = Boolean(auth.apiKey);
      const hasOAuth = Boolean(auth.oauth);
      const configured = this.runtime.hasConfiguredAuth(p.id);

      return {
        id: p.id,
        name: p.name ?? p.id,
        configured,
        custom: customIds.includes(p.id),
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

  /** Register a custom provider: persisted to pi models.json and usable immediately. */
  async addCustomProvider(input: CustomProviderInput): Promise<ProviderInfo> {
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(input.id)) {
      throw new Error('Provider ID 必须是 2-49 位小写字母/数字/连字符');
    }
    if (!/^https?:\/\//.test(input.baseUrl)) throw new Error('Base URL 必须以 http:// 或 https:// 开头');
    if (input.models.length === 0) throw new Error('至少需要一个模型 ID');
    if (input.models.some((m) => !m.id.trim())) throw new Error('模型 ID 不能为空');
    if (this.runtime.getProvider(input.id)) throw new Error(`Provider '${input.id}' 已存在`);

    const api = input.api?.trim() || 'openai-completions';
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
    const name = input.name?.trim() || input.id;
    const models = input.models.map((m) => ({
      id: m.id.trim(),
      name: m.name?.trim() || m.id.trim(),
      reasoning: m.reasoning ?? false,
      input: ['text' as const],
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 8192,
    }));

    if (this.modelsPath) {
      const config = await this.readModelsConfig();
      config.providers[input.id] = {
        name,
        baseUrl,
        api,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        models: models.map(({ id, name: modelName, reasoning, input: modelInput, contextWindow, maxTokens }) => ({
          id,
          name: modelName,
          reasoning,
          input: modelInput,
          contextWindow,
          maxTokens,
        })),
      };
      await mkdir(dirname(this.modelsPath), { recursive: true });
      await writeFile(this.modelsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }

    this.runtime.registerProvider(input.id, {
      name,
      baseUrl,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      models: models.map((m) => ({ ...m, api, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
    } as Parameters<ModelRuntime['registerProvider']>[1]);

    const provider = this.listProviders().find((p) => p.id === input.id);
    if (!provider) throw new Error('Provider 注册后未出现在列表中');
    return provider;
  }

  /** Remove a custom provider from models.json and the runtime. */
  async removeCustomProvider(providerId: string): Promise<void> {
    if (!this.modelsPath) throw new Error('内存模式下无法移除 Provider');
    const config = await this.readModelsConfig();
    if (!config.providers[providerId]) throw new Error(`'${providerId}' 不是自定义 Provider`);
    delete config.providers[providerId];
    await writeFile(this.modelsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    this.runtime.unregisterProvider(providerId);
  }

  private async readModelsConfig(): Promise<{ providers: Record<string, Record<string, unknown>> }> {
    if (!this.modelsPath) return { providers: {} };
    let raw: string;
    try {
      raw = await readFile(this.modelsPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { providers: {} };
      throw new Error(`读取 models.json 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const parsed = JSON.parse(raw) as { providers?: Record<string, Record<string, unknown>> };
      return { providers: parsed.providers ?? {} };
    } catch (err) {
      throw new Error(`解析 models.json 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private readCustomIdsSync(): string[] {
    if (!this.modelsPath) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.modelsPath, 'utf-8')) as { providers?: Record<string, unknown> };
      return Object.keys(parsed.providers ?? {});
    } catch {
      return [];
    }
  }
}
