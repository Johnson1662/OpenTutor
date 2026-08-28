import { useEffect, useState, type FormEvent } from 'react';
import {
  listProviders,
  listProviderModels,
  getAiPreferences,
  updateAiPreferences,
  loginWithApiKey,
  addCustomProvider,
  type ProviderInfo,
  type CustomProviderModelInput,
  type UserAiPreferences,
} from '../runtime/api.ts';

interface ProviderPreset {
  label: string;
  baseUrl: string;
  api: string;
  models: string;
}

const PRESETS: ProviderPreset[] = [
  {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    models: 'deepseek-chat | DeepSeek-V3\ndeepseek-reasoner | DeepSeek-R1',
  },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    models: 'anthropic/claude-3.7-sonnet | Claude 3.7 Sonnet\ndeepseek/deepseek-r1 | DeepSeek R1',
  },
  {
    label: '本地 OpenAI-compatible',
    baseUrl: 'http://localhost:11434/v1',
    api: 'openai-completions',
    models: '',
  },
];

const LEARNING_LANGUAGE_KEY = 'opentutor.learningLanguage';

function readLearningLanguage(): 'zh' | 'en' {
  return localStorage.getItem(LEARNING_LANGUAGE_KEY) === 'en' ? 'en' : 'zh';
}

export function ProviderSettingsPage({
  onFlash,
}: {
  onFlash: (msg: string) => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [prefs, setPrefs] = useState<UserAiPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [learningLanguage, setLearningLanguage] = useState<'zh' | 'en'>(readLearningLanguage);

  // API key connect
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Collapsed custom provider form
  const [addOpen, setAddOpen] = useState(false);
  const [npId, setNpId] = useState('');
  const [npName, setNpName] = useState('');
  const [npBaseUrl, setNpBaseUrl] = useState('');
  const [npApiKey, setNpApiKey] = useState('');
  const [npModels, setNpModels] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [provList, userPrefs] = await Promise.all([listProviders(), getAiPreferences()]);
      setProviders(provList);
      setPrefs(userPrefs);
      if (userPrefs.defaultProviderId) {
        await loadModels(userPrefs.defaultProviderId);
      }
    } catch (err: unknown) {
      onFlash('加载设置失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  async function loadModels(providerId: string) {
    try {
      setModels(await listProviderModels(providerId));
    } catch {
      setModels([]);
    }
  }

  async function connectProvider(providerId: string) {
    try {
      setConnecting(true);
      await loginWithApiKey(providerId, apiKey.trim());
      setApiKey('');
      setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, configured: true } : provider));
      onFlash('连接成功');
      // Auto-persist first model as default when no valid default exists.
      const modelList = await listProviderModels(providerId);
      const hasValidDefault =
        prefs?.defaultModelId && modelList.some((m) => m.id === prefs.defaultModelId);
      if (!hasValidDefault && modelList.length > 0) {
        const updated = await updateAiPreferences({
          defaultProviderId: providerId,
          defaultModelId: modelList[0]!.id,
          thinkingLevel: 'medium',
        });
        setPrefs(updated);
        setModels(modelList);
        onFlash(`已自动选择默认模型：${modelList[0]!.name || modelList[0]!.id}`);
      } else {
        await loadData();
      }
    } catch (err: unknown) {
      onFlash('连接失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setConnecting(false);
    }
  }

  async function handleConnectClick() {
    const providerId = prefs?.defaultProviderId;
    if (!providerId || !apiKey.trim()) return;
    await connectProvider(providerId);
  }

  async function handleProviderChange(providerId: string) {
    setPrefs((prev) => (prev ? { ...prev, defaultProviderId: providerId, defaultModelId: undefined } : prev));
    await loadModels(providerId);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    try {
      setSaving(true);
      await updateAiPreferences(prefs);
      onFlash('已保存');
    } catch (err: unknown) {
      onFlash('保存失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddProvider(e: FormEvent) {
    e.preventDefault();
    const parsedModels: CustomProviderModelInput[] = npModels
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, name] = line.split('|').map((part) => part.trim());
        return { id: id ?? '', ...(name ? { name } : {}) };
      });
    try {
      setSaving(true);
      const provider = await addCustomProvider({
        id: npId.trim().toLowerCase(),
        name: npName.trim() || undefined,
        baseUrl: npBaseUrl.trim(),
        apiKey: npApiKey.trim() || undefined,
        api: 'openai-completions',
        models: parsedModels,
      });
      setProviders((current) => [...current.filter((item) => item.id !== provider.id), provider]);
      onFlash(`已添加「${provider.name}」`);
      setAddOpen(false);
      // Auto-default to its first model.
      if (parsedModels.length > 0) {
        const updated = await updateAiPreferences({
          defaultProviderId: provider.id,
          defaultModelId: parsedModels[0]!.id,
          thinkingLevel: 'medium',
        });
        setPrefs(updated);
        setModels(parsedModels.map((m) => ({ id: m.id, name: m.name ?? m.id })));
      } else {
        await loadData();
      }
      setNpId('');
      setNpName('');
      setNpBaseUrl('');
      setNpApiKey('');
      setNpModels('');
    } catch (err: unknown) {
      onFlash('添加失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  function applyPreset(preset: ProviderPreset) {
    setNpBaseUrl(preset.baseUrl);
    setNpModels(preset.models);
    if (!npId) setNpId(preset.label.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  }

  if (loading) {
    return (
      <main className="page-shell settings-page-v3">
        <div className="loading-block">正在读取设置…</div>
      </main>
    );
  }

  const selectedProvider = providers.find((p) => p.id === prefs?.defaultProviderId);
  const connected = selectedProvider?.configured ?? false;

  return (
    <main className="page-shell settings-page-v3">
      <header className="page-heading">
        <div>
          <h1>设置</h1>
        </div>
      </header>

      <form className="settings-card" onSubmit={handleSave}>
        <h2 className="settings-section">AI 模型</h2>
        <label className="settings-field">
          <span>服务商</span>
          <select
            value={prefs?.defaultProviderId ?? ''}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            <option value="" disabled>
              选择服务商…
            </option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.custom ? '（自定义）' : ''}
                {p.configured ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          <span>API Key / 连接状态</span>
          <div className="connect-row">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={connected ? '输入新的 API Key（可选）' : 'sk-…'}
              disabled={!prefs?.defaultProviderId || connecting}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={!prefs?.defaultProviderId || !apiKey.trim() || connecting}
              onClick={() => handleConnectClick()}
            >
              {connecting ? '连接中…' : connected ? '更新' : '连接'}
            </button>
          </div>
          {connected && <span className="status-pill">已连接</span>}
        </label>

        <label className="settings-field">
          <span>模型</span>
          <select
            value={prefs?.defaultModelId ?? ''}
            onChange={(e) => setPrefs((prev) => (prev ? { ...prev, defaultModelId: e.target.value } : prev))}
            disabled={!prefs?.defaultProviderId}
          >
            {models.length > 0 ? (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))
            ) : (
              <option value={prefs?.defaultModelId ?? ''}>
                {prefs?.defaultModelId || '（请先连接服务商）'}
              </option>
            )}
          </select>
        </label>

        <h2 className="settings-section">学习偏好</h2>
        <label className="settings-field">
          <span>课程语言</span>
          <select
            value={learningLanguage}
            onChange={(e) => {
              const language = e.target.value as 'zh' | 'en';
              setLearningLanguage(language);
              localStorage.setItem(LEARNING_LANGUAGE_KEY, language);
              onFlash(language === 'zh' ? '新课程默认使用中文。' : 'New courses will default to English.');
            }}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>

        <div className="settings-actions">
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || !prefs?.defaultModelId}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>

      <section className="settings-add-section">
        <button
          type="button"
          className="text-action"
          onClick={() => setAddOpen(!addOpen)}
          aria-expanded={addOpen}
        >
          {addOpen ? '▾' : '▸'} 添加 OpenAI-compatible 服务商
        </button>

        {addOpen && (
          <form className="settings-card settings-add-card" onSubmit={handleAddProvider}>
            <div className="preset-row">
              {PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  className="preset-chip"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="settings-two-col">
              <label className="settings-field">
                <span>ID *</span>
                <input value={npId} onChange={(e) => setNpId(e.target.value)} placeholder="my-provider" required />
              </label>
              <label className="settings-field">
                <span>名称</span>
                <input value={npName} onChange={(e) => setNpName(e.target.value)} placeholder="我的服务商" />
              </label>
            </div>
            <label className="settings-field">
              <span>Base URL *</span>
              <input
                value={npBaseUrl}
                onChange={(e) => setNpBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1"
                required
              />
            </label>
            <label className="settings-field">
              <span>API Key（可选）</span>
              <input
                type="password"
                value={npApiKey}
                onChange={(e) => setNpApiKey(e.target.value)}
                placeholder="本地模型可留空"
              />
            </label>
            <label className="settings-field">
              <span>模型（每行一个：<code>model-id | 显示名</code>）*</span>
              <textarea
                value={npModels}
                onChange={(e) => setNpModels(e.target.value)}
                rows={3}
                placeholder={'deepseek-chat | DeepSeek-V3'}
                required
              />
            </label>
            <div className="settings-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? '添加中…' : '添加'}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
