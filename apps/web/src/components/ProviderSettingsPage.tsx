import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  listProviders,
  listProviderModels,
  getAiPreferences,
  updateAiPreferences,
  loginWithApiKey,
  addCustomProvider,
  removeCustomProvider,
  startAuthSession,
  cancelAuthSession,
  respondAuthSession,
  subscribeToAuthEvents,
  type ProviderInfo,
  type CustomProviderModelInput,
  type UserAiPreferences,
  type AuthUrlEventData,
  type AuthDeviceCodeEventData,
  type AuthPromptEventData,
  type AuthProgressEventData,
  type AuthFailedEventData,
} from '../runtime/api.ts';

type ModalTab = 'api_key' | 'oauth';
type AuthSessionStatus =
  | 'idle'
  | 'starting'
  | 'waiting_url'
  | 'waiting_device_code'
  | 'prompt'
  | 'in_progress'
  | 'completed'
  | 'failed';

interface ProviderPreset {
  name: string;
  id: string;
  displayName: string;
  baseUrl: string;
  api: string;
  models: string;
}

const PRESETS: ProviderPreset[] = [
  {
    name: 'DeepSeek 官方',
    id: 'deepseek-api',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    models: 'deepseek-chat | DeepSeek-V3\ndeepseek-reasoner | DeepSeek-R1',
  },
  {
    name: '硅基流动 (SiliconFlow)',
    id: 'siliconflow',
    displayName: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    api: 'openai-completions',
    models: 'deepseek-ai/DeepSeek-V3 | DeepSeek V3\ndeepseek-ai/DeepSeek-R1 | DeepSeek R1\nQwen/Qwen2.5-72B-Instruct | Qwen 2.5 72B',
  },
  {
    name: 'Ollama (本地)',
    id: 'ollama-local',
    displayName: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1',
    api: 'openai-completions',
    models: 'deepseek-r1:14b | DeepSeek R1 14B\nqwen2.5:14b | Qwen 2.5 14B\nllama3.3:70b | Llama 3.3 70B',
  },
  {
    name: 'OpenRouter',
    id: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    models: 'anthropic/claude-3.7-sonnet | Claude 3.7 Sonnet\ndeepseek/deepseek-r1 | DeepSeek R1\ngoogle/gemini-2.5-pro | Gemini 2.5 Pro',
  },
  {
    name: 'Moonshot (Kimi)',
    id: 'moonshot',
    displayName: 'Moonshot AI',
    baseUrl: 'https://api.moonshot.cn/v1',
    api: 'openai-completions',
    models: 'moonshot-v1-8k | Kimi 8K\nmoonshot-v1-32k | Kimi 32K\nmoonshot-v1-128k | Kimi 128K',
  },
];

const THINKING_LEVELS = [
  { id: 'off', label: '快速响应', desc: '关闭显式思维链，响应极速' },
  { id: 'low', label: '轻量思考', desc: '基础分析，适合简单概念' },
  { id: 'medium', label: '标准深入', desc: 'Socratic 启发式标准推理（推荐）' },
  { id: 'high', label: '深度探究', desc: '多轮深度反思与详细概念拆解' },
] as const;

export function ProviderSettingsPage({ onFlash }: { onFlash: (msg: string) => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [prefs, setPrefs] = useState<UserAiPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Connect Modal State
  const [modalProvider, setModalProvider] = useState<ProviderInfo | null>(null);
  const [activeTab, setActiveTab] = useState<ModalTab>('api_key');
  const [apiKeyInput, setApiKeyInput] = useState('');

  // Add Custom Provider Modal State
  const [addOpen, setAddOpen] = useState(false);
  const [npId, setNpId] = useState('');
  const [npName, setNpName] = useState('');
  const [npBaseUrl, setNpBaseUrl] = useState('');
  const [npApi, setNpApi] = useState('openai-completions');
  const [npApiKey, setNpApiKey] = useState('');
  const [npModels, setNpModels] = useState('');

  // OAuth Session State
  const [authSessionId, setAuthSessionId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthSessionStatus>('idle');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<AuthDeviceCodeEventData | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptEventData | null>(null);
  const [promptInput, setPromptInput] = useState('');
  const [authProgressMsg, setAuthProgressMsg] = useState<string | null>(null);
  const [authErrorMsg, setAuthErrorMsg] = useState<string | null>(null);

  const authUnsubscribeRef = useRef<(() => void) | null>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);
  const modalBoxRef = useRef<HTMLDivElement | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    loadData();
    return () => {
      if (authUnsubscribeRef.current) {
        authUnsubscribeRef.current();
      }
    };
  }, []);

  useEffect(() => {
    if (prefs?.defaultProviderId) {
      loadModels(prefs.defaultProviderId);
    }
  }, [prefs?.defaultProviderId]);

  async function loadData() {
    try {
      setLoading(true);
      const [provList, userPrefs] = await Promise.all([
        listProviders(),
        getAiPreferences(),
      ]);
      setProviders(provList);
      setPrefs(userPrefs);
      if (userPrefs.defaultProviderId) {
        await loadModels(userPrefs.defaultProviderId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlash(`加载设置失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadModels(providerId: string) {
    try {
      const modelList = await listProviderModels(providerId);
      setModels(modelList);
    } catch {
      setModels([]);
    }
  }

  function resetOAuthState() {
    if (authUnsubscribeRef.current) {
      authUnsubscribeRef.current();
      authUnsubscribeRef.current = null;
    }
    setAuthSessionId(null);
    setAuthStatus('idle');
    setAuthUrl(null);
    setDeviceCode(null);
    setAuthPrompt(null);
    setPromptInput('');
    setAuthProgressMsg(null);
    setAuthErrorMsg(null);
  }

  function openConnectModal(provider: ProviderInfo, preferredTab?: ModalTab, trigger?: HTMLElement) {
    modalTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setModalProvider(provider);
    setApiKeyInput('');
    resetOAuthState();

    const hasOAuth = Boolean(provider.auth?.oauth?.available);
    const hasApiKey = Boolean(provider.auth?.apiKey?.available) || !provider.auth;

    if (preferredTab) {
      setActiveTab(preferredTab);
    } else if (hasApiKey) {
      setActiveTab('api_key');
    } else if (hasOAuth) {
      setActiveTab('oauth');
    }
  }

  function handleCloseModal() {
    if (authSessionId && authStatus === 'in_progress') {
      void cancelAuthSession(authSessionId).catch(() => {});
    }
    resetOAuthState();
    setModalProvider(null);
    setTimeout(() => modalTriggerRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!modalProvider && !addOpen) return;

    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (modalProvider) handleCloseModal();
        if (addOpen) setAddOpen(false);
        return;
      }
    };

    document.addEventListener('keydown', handleModalKeyDown);
    return () => document.removeEventListener('keydown', handleModalKeyDown);
  }, [modalProvider, addOpen]);

  async function handleConnectApiKey(providerId: string) {
    if (!apiKeyInput.trim()) return;
    try {
      setSaving(true);
      await loginWithApiKey(providerId, apiKeyInput.trim());
      onFlash(`服务商「${modalProvider?.name || providerId}」连接成功！`);
      handleCloseModal();
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlash(`连接失败: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleStartOAuth(providerId: string) {
    try {
      resetOAuthState();
      setAuthStatus('starting');
      setAuthProgressMsg('正在初始化 OAuth 会话...');

      const { authSessionId: newSessionId } = await startAuthSession(providerId, 'oauth');
      setAuthSessionId(newSessionId);
      setAuthStatus('in_progress');

      const unsubscribe = subscribeToAuthEvents(
        newSessionId,
        (event) => {
          if (event.type === 'auth.url') {
            const data = event.data as AuthUrlEventData;
            setAuthUrl(data.url);
            setAuthStatus('waiting_url');
            try {
              window.open(data.url, '_blank');
            } catch {
              // popup blocker fallback
            }
          } else if (event.type === 'auth.device_code') {
            const data = event.data as AuthDeviceCodeEventData;
            setDeviceCode(data);
            setAuthStatus('waiting_device_code');
          } else if (event.type === 'auth.prompt') {
            const data = event.data as AuthPromptEventData;
            setAuthPrompt(data);
            setAuthStatus('prompt');
          } else if (event.type === 'auth.progress') {
            const data = event.data as AuthProgressEventData;
            setAuthProgressMsg(data.message);
          } else if (event.type === 'auth.completed') {
            setAuthStatus('completed');
            setAuthProgressMsg('认证已成功完成！');
            onFlash(`服务商「${providerId}」OAuth 连接成功！`);
            loadData();
            setTimeout(() => {
              handleCloseModal();
            }, 1200);
          } else if (event.type === 'auth.failed') {
            const data = event.data as AuthFailedEventData;
            setAuthStatus('failed');
            setAuthErrorMsg(data?.error || '认证流程失败');
          } else if (event.type === 'auth.cancelled') {
            setAuthStatus('idle');
            setAuthProgressMsg('认证已取消');
          }
        },
        () => {
          setAuthStatus('failed');
          setAuthErrorMsg('认证事件流连接丢失');
        }
      );

      authUnsubscribeRef.current = unsubscribe;
    } catch (err: unknown) {
      setAuthStatus('failed');
      const msg = err instanceof Error ? err.message : String(err);
      setAuthErrorMsg(msg);
    }
  }

  async function handleCancelOAuth() {
    if (authSessionId) {
      try {
        await cancelAuthSession(authSessionId);
      } catch {
        // ignore
      }
    }
    resetOAuthState();
  }

  async function handlePromptSubmit(e: FormEvent) {
    e.preventDefault();
    if (!authSessionId || !authPrompt || !promptInput.trim()) return;

    try {
      setSaving(true);
      await respondAuthSession(authSessionId, authPrompt.promptId, promptInput.trim());
      setAuthPrompt(null);
      setPromptInput('');
      setAuthStatus('in_progress');
      setAuthProgressMsg('凭据已提交，等待服务器验证...');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlash(`提交响应失败: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveModelPreferences(e: FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    try {
      setSaving(true);
      await updateAiPreferences(prefs);
      onFlash('AI 模型首选项已保存（对后续学习会话实时生效）');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlash(`保存失败: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  function applyPreset(preset: ProviderPreset) {
    setNpId(preset.id);
    setNpName(preset.displayName);
    setNpBaseUrl(preset.baseUrl);
    setNpApi(preset.api);
    setNpModels(preset.models);
  }

  function parseModels(text: string): CustomProviderModelInput[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, name] = line.split('|').map((part) => part.trim());
        return { id: id ?? '', ...(name ? { name } : {}) };
      });
  }

  async function handleAddProvider(e: FormEvent) {
    e.preventDefault();
    const parsedModels = parseModels(npModels);
    try {
      setSaving(true);
      const provider = await addCustomProvider({
        id: npId.trim().toLowerCase(),
        name: npName.trim() || undefined,
        baseUrl: npBaseUrl.trim(),
        apiKey: npApiKey.trim() || undefined,
        api: npApi,
        models: parsedModels,
      });
      onFlash(`自定义服务商「${provider.name}」已添加并可用`);
      setAddOpen(false);
      setNpId('');
      setNpName('');
      setNpBaseUrl('');
      setNpApiKey('');
      setNpModels('');
      await loadData();
      setPrefs((prev) => (prev ? { ...prev, defaultProviderId: provider.id, defaultModelId: parsedModels[0]?.id } : prev));
    } catch (err: unknown) {
      onFlash(`添加失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveProvider(providerId: string, providerName: string) {
    if (!window.confirm(`确定要移除自定义服务商「${providerName}」吗？`)) return;
    try {
      setSaving(true);
      await removeCustomProvider(providerId);
      onFlash(`已移除服务商「${providerName}」`);
      await loadData();
      setPrefs((prev) =>
        prev?.defaultProviderId === providerId
          ? { ...prev, defaultProviderId: providers[0]?.id, defaultModelId: undefined }
          : prev
      );
    } catch (err: unknown) {
      onFlash(`移除失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestProvider(providerId: string) {
    try {
      setTestingId(providerId);
      const mList = await listProviderModels(providerId);
      if (mList.length > 0) {
        onFlash(`服务商连通性测试成功！发现 ${mList.length} 个可用模型。`);
      } else {
        onFlash('连接测试完成，该服务商当前未返回模型列表。');
      }
    } catch (err: unknown) {
      onFlash(`测试连接失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingId(null);
    }
  }

  if (loading) {
    return (
      <div className="page-shell">
        <div className="loading-block">
          <div className="loading-spinner" />
          <p style={{ marginTop: '16px', color: 'var(--muted)' }}>正在同步 AI 模型服务商与首选项...</p>
        </div>
      </div>
    );
  }

  const selectedProvider = providers.find((p) => p.id === prefs?.defaultProviderId) || providers[0];
  const configuredCount = providers.filter((p) => p.configured).length;
  const isSelectedCustom = Boolean(selectedProvider?.custom);

  return (
    <main className="page-shell settings-v2">
      {/* 1. Header */}
      <header className="settings-v2-header">
        <div className="settings-v2-heading">
          <span className="eyebrow">配置中心 · Model & Runtime</span>
          <h1>AI 模型与服务商设置</h1>
          <p>
            配置用于课程知识编译、课件动态生成及苏格拉底辅导的 AI 服务商。所有 API 密钥仅在本地安全持久化。
          </p>
        </div>
      </header>

      {/* 2. Top Bento Grid: Active Model & Overview */}
      <div className="settings-bento-grid">
        {/* Left Card: Active Configuration */}
        <form className="settings-hero-card" onSubmit={handleSaveModelPreferences}>
          <div className="card-top-bar">
            <div>
              <span className="card-kicker">当前学习首选项</span>
              <h2>默认模型与思考偏好</h2>
            </div>
            {selectedProvider && (
              <span className={`status-tag ${selectedProvider.configured ? 'connected' : 'disconnected'}`}>
                <span className="status-dot" aria-hidden="true" />
                {selectedProvider.configured ? '已连接就绪' : '待配置密钥'}
              </span>
            )}
          </div>

          <div className="form-fields-grid">
            <label className="settings-field">
              <span className="field-title">服务商 (Provider)</span>
              <select
                value={prefs?.defaultProviderId ?? selectedProvider?.id ?? ''}
                onChange={(e) => {
                  const provId = e.target.value;
                  setPrefs((prev) => (prev ? { ...prev, defaultProviderId: provId } : prev));
                  loadModels(provId);
                }}
                disabled={!providers.length}
              >
                {providers.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name} {p.custom ? '(自定义)' : ''} {p.configured ? '✓' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span className="field-title">默认模型 (Model)</span>
              <select
                value={prefs?.defaultModelId ?? ''}
                onChange={(e) => setPrefs((prev) => (prev ? { ...prev, defaultModelId: e.target.value } : prev))}
                disabled={!selectedProvider}
              >
                {models.length ? (
                  models.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name || m.id}
                    </option>
                  ))
                ) : (
                  <option value={prefs?.defaultModelId ?? ''}>
                    {prefs?.defaultModelId || '默认推理模型'}
                  </option>
                )}
              </select>
            </label>
          </div>

          {/* Thinking Level Segmented Control */}
          <div className="thinking-level-section">
            <span className="field-title">AI 思考深度 (Thinking Level)</span>
            <div className="thinking-pills">
              {THINKING_LEVELS.map((level) => {
                const active = (prefs?.thinkingLevel ?? 'medium') === level.id;
                return (
                  <button
                    type="button"
                    key={level.id}
                    className={`thinking-pill ${active ? 'active' : ''}`}
                    onClick={() => setPrefs((prev) => (prev ? { ...prev, thinkingLevel: level.id } : prev))}
                  >
                    <span className="pill-label">{level.label}</span>
                    <small className="pill-desc">{level.desc}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="settings-hero-actions">
            <div className="hero-action-left">
              {selectedProvider && !selectedProvider.configured && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={(e) => openConnectModal(selectedProvider, 'api_key', e.currentTarget)}
                >
                  立即配置「{selectedProvider.name}」凭据 ↗
                </button>
              )}
            </div>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存默认配置'}
            </button>
          </div>
        </form>

        {/* Right Card: Overview & Quick Facts */}
        <div className="settings-overview-card">
          <span className="card-kicker">运行时概览</span>
          <h3>系统状态</h3>

          <div className="overview-stats">
            <div className="stat-box">
              <span className="stat-number">{configuredCount}</span>
              <span className="stat-label">已配置服务商</span>
            </div>
            <div className="stat-box">
              <span className="stat-number">{providers.length}</span>
              <span className="stat-label">总注册服务商</span>
            </div>
          </div>

          <div className="overview-meta-list">
            <div className="meta-row">
              <span className="meta-k">存储位置</span>
              <code className="meta-v">~/.opentutor/pi/models.json</code>
            </div>
            <div className="meta-row">
              <span className="meta-k">加密机制</span>
              <span className="meta-v">设备级本地凭据隔离</span>
            </div>
            <div className="meta-row">
              <span className="meta-k">协议版本</span>
              <span className="meta-v">OpenTutor Protocol v0.7</span>
            </div>
          </div>

          <div className="quick-add-box">
            <button
              type="button"
              className="btn-secondary btn-full"
              onClick={() => setAddOpen(true)}
            >
              ＋ 添加自定义 Provider / 本地模型
            </button>
          </div>
        </div>
      </div>

      {/* 3. Provider Roster Grid */}
      <section className="provider-roster-section">
        <div className="roster-header">
          <div>
            <span className="eyebrow">服务商目录</span>
            <h2>全部可用服务商 ({providers.length})</h2>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setAddOpen(true)}>
            ＋ 添加自定义服务商
          </button>
        </div>

        <div className="provider-card-grid">
          {providers.map((p) => {
            const isSelected = p.id === prefs?.defaultProviderId;
            const hasOAuth = Boolean(p.auth?.oauth?.available);
            const hasApiKey = Boolean(p.auth?.apiKey?.available) || !p.auth;

            return (
              <div key={p.id} className={`provider-box ${isSelected ? 'is-selected' : ''}`}>
                <div className="provider-box-header">
                  <div className="provider-badge-icon">
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="provider-title-group">
                    <h3>{p.name}</h3>
                    <div className="provider-tag-row">
                      {p.custom ? (
                        <span className="tag-pill tag-custom">自定义</span>
                      ) : (
                        <span className="tag-pill tag-builtin">官方内置</span>
                      )}
                      <span className={`tag-pill ${p.configured ? 'tag-connected' : 'tag-disconnected'}`}>
                        {p.configured ? '● 已就绪' : '○ 未配置'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="provider-box-body">
                  <div className="auth-methods-info">
                    <span className="info-label">支持方式：</span>
                    {hasApiKey && <span className="auth-pill">API Key</span>}
                    {hasOAuth && <span className="auth-pill">OAuth</span>}
                    {p.custom && <span className="auth-pill">兼容端点</span>}
                  </div>
                </div>

                <div className="provider-box-footer">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={(e) => openConnectModal(p, hasApiKey ? 'api_key' : 'oauth', e.currentTarget)}
                  >
                    {p.configured ? '重新配置' : '配置密钥'}
                  </button>

                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={testingId === p.id}
                    onClick={() => handleTestProvider(p.id)}
                    title="测试该服务商的连通性"
                  >
                    {testingId === p.id ? '测试中…' : '测试'}
                  </button>

                  {p.custom && (
                    <button
                      type="button"
                      className="btn-danger-ghost btn-sm"
                      onClick={() => handleRemoveProvider(p.id, p.name)}
                      title="删除此自定义服务商"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Modal: Connect / Configure Built-in & Existing Provider */}
      {modalProvider && (
        <div className="modal-backdrop">
          <div
            ref={modalBoxRef}
            className="modal-box-v2"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-modal-title"
          >
            <div className="modal-header-v2">
              <div>
                <span className="card-kicker">服务商连接</span>
                <h3 id="connect-modal-title">配置 {modalProvider.name}</h3>
              </div>
              <button
                ref={modalCloseRef}
                className="modal-close-btn"
                onClick={handleCloseModal}
                aria-label="关闭对话框"
              >
                ✕
              </button>
            </div>

            {/* Tabs switcher */}
            {modalProvider.auth?.oauth?.available && (modalProvider.auth?.apiKey?.available ?? true) && (
              <div className="modal-tab-bar">
                <button
                  type="button"
                  className={`modal-tab ${activeTab === 'api_key' ? 'active' : ''}`}
                  onClick={() => {
                    resetOAuthState();
                    setActiveTab('api_key');
                  }}
                >
                  API Key 密钥接入
                </button>
                <button
                  type="button"
                  className={`modal-tab ${activeTab === 'oauth' ? 'active' : ''}`}
                  onClick={() => {
                    resetOAuthState();
                    setActiveTab('oauth');
                  }}
                >
                  OAuth 网页登录
                </button>
              </div>
            )}

            {/* TAB: API KEY */}
            {activeTab === 'api_key' && (
              <div className="modal-body-v2">
                <p className="modal-intro">
                  输入用于调用模型推理的 API Secret Key。密钥仅保存在本地设备，不会上传或写入业务数据库。
                </p>

                <label className="modal-field">
                  <span className="field-title">API 密钥 (API Key)</span>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="modal-input-v2"
                    autoFocus
                  />
                </label>

                <div className="modal-actions-v2">
                  <button type="button" className="btn-secondary" onClick={handleCloseModal}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleConnectApiKey(modalProvider.id)}
                    disabled={saving || !apiKeyInput.trim()}
                  >
                    {saving ? '保存中…' : '保存并验证'}
                  </button>
                </div>
              </div>
            )}

            {/* TAB: OAUTH */}
            {activeTab === 'oauth' && (
              <div className="modal-body-v2">
                {authStatus === 'idle' && (
                  <div>
                    <p className="modal-intro">
                      通过浏览器网页授权或设备代码直接连接服务商订阅，无需手动提取与复制 API Key。
                    </p>
                    <div className="modal-actions-v2">
                      <button type="button" className="btn-secondary" onClick={handleCloseModal}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleStartOAuth(modalProvider.id)}
                      >
                        启动网页授权 ↗
                      </button>
                    </div>
                  </div>
                )}

                {authStatus !== 'idle' && (
                  <div className="oauth-flow-box">
                    {authProgressMsg && <div className="oauth-progress-msg">{authProgressMsg}</div>}

                    {authUrl && (
                      <div className="oauth-url-card">
                        <p style={{ fontWeight: 600, margin: '0 0 6px 0' }}>已在新窗口开启授权页面</p>
                        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 10px 0' }}>
                          如未自动弹出，请点击下方链接完成登录：
                        </p>
                        <a
                          href={authUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-primary btn-sm"
                          style={{ display: 'inline-block', textDecoration: 'none' }}
                        >
                          打开网页授权页面 ↗
                        </a>
                      </div>
                    )}

                    {deviceCode && (
                      <div className="device-code-card">
                        <span className="code-label">在授权页面输入以下配对验证码：</span>
                        <span className="code-val">{deviceCode.userCode}</span>
                        {deviceCode.verificationUri && (
                          <a
                            href={deviceCode.verificationUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary btn-sm"
                            style={{ display: 'inline-block', textDecoration: 'none' }}
                          >
                            打开验证页面 ({deviceCode.verificationUri}) ↗
                          </a>
                        )}
                      </div>
                    )}

                    {authPrompt && (
                      <form onSubmit={handlePromptSubmit} className="auth-prompt-form">
                        <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px' }}>
                          {authPrompt.message}
                        </label>
                        {authPrompt.promptType === 'select' && authPrompt.choices && authPrompt.choices.length > 0 ? (
                          <select
                            value={promptInput}
                            onChange={(e) => setPromptInput(e.target.value)}
                            className="modal-input-v2"
                            style={{ marginBottom: '10px' }}
                            autoFocus
                          >
                            <option value="" disabled>
                              请选择...
                            </option>
                            {authPrompt.choices.map((c) => {
                              const val = c.value ?? c.id ?? c.label;
                              return (
                                <option key={val} value={val}>
                                  {c.label}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <input
                            type={authPrompt.promptType === 'secret' ? 'password' : 'text'}
                            value={promptInput}
                            onChange={(e) => setPromptInput(e.target.value)}
                            placeholder={
                              authPrompt.promptType === 'manual_code'
                                ? '请输入授权回填码'
                                : authPrompt.placeholder || '请输入响应内容...'
                            }
                            className="modal-input-v2"
                            style={{ marginBottom: '10px' }}
                            autoFocus
                          />
                        )}
                        <button
                          type="submit"
                          className="btn-primary"
                          disabled={saving || !promptInput.trim()}
                          style={{ width: '100%' }}
                        >
                          {saving ? '提交中…' : '提交验证'}
                        </button>
                      </form>
                    )}

                    {authErrorMsg && <div className="oauth-error-box">错误: {authErrorMsg}</div>}

                    <div className="modal-actions-v2" style={{ marginTop: '12px' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleCancelOAuth}
                        disabled={authStatus === 'completed'}
                      >
                        取消授权
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Modal: Add Custom Provider */}
      {addOpen && (
        <div className="modal-backdrop">
          <div
            className="modal-box-v2 modal-box-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-provider-title"
          >
            <div className="modal-header-v2">
              <div>
                <span className="card-kicker">自定义端点</span>
                <h3 id="add-provider-title">添加自定义 AI 服务商</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setAddOpen(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddProvider} className="modal-body-v2">
              {/* Presets Toolbar */}
              <div className="presets-bar">
                <span className="presets-label">常用模板快捷填入：</span>
                <div className="presets-chips">
                  {PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.name}
                      className="preset-chip"
                      onClick={() => applyPreset(preset)}
                      title={`快捷填充 ${preset.name} 配置`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-fields-2col">
                <label className="modal-field">
                  <span className="field-title">Provider ID（英文字母/数字/连字符）*</span>
                  <input
                    className="modal-input-v2"
                    value={npId}
                    onChange={(e) => setNpId(e.target.value)}
                    placeholder="如 deepseek-api 或 local-ollama"
                    required
                    autoFocus
                  />
                </label>

                <label className="modal-field">
                  <span className="field-title">显示名称 (Display Name)</span>
                  <input
                    className="modal-input-v2"
                    value={npName}
                    onChange={(e) => setNpName(e.target.value)}
                    placeholder="如 DeepSeek 官方"
                  />
                </label>
              </div>

              <div className="form-fields-2col">
                <label className="modal-field">
                  <span className="field-title">Base URL（端点地址）*</span>
                  <input
                    className="modal-input-v2"
                    value={npBaseUrl}
                    onChange={(e) => setNpBaseUrl(e.target.value)}
                    placeholder="https://api.deepseek.com/v1"
                    required
                  />
                </label>

                <label className="modal-field">
                  <span className="field-title">接口协议类型</span>
                  <select
                    className="modal-input-v2"
                    value={npApi}
                    onChange={(e) => setNpApi(e.target.value)}
                  >
                    <option value="openai-completions">OpenAI Chat Completions（最通用）</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic-messages">Anthropic Messages</option>
                  </select>
                </label>
              </div>

              <label className="modal-field">
                <span className="field-title">API Key (密钥，可选，保存在本地)</span>
                <input
                  className="modal-input-v2"
                  type="password"
                  value={npApiKey}
                  onChange={(e) => setNpApiKey(e.target.value)}
                  placeholder="sk-... (本地模型如 Ollama 可留空)"
                />
              </label>

              <label className="modal-field">
                <span className="field-title">
                  可用模型列表 (每行一个，格式：<code>model-id</code> 或 <code>model-id | 显示名称</code>)*
                </span>
                <textarea
                  className="modal-input-v2 modal-textarea"
                  value={npModels}
                  onChange={(e) => setNpModels(e.target.value)}
                  placeholder={"deepseek-chat | DeepSeek-V3\ndeepseek-reasoner | DeepSeek-R1"}
                  rows={4}
                  required
                />
              </label>

              <div className="modal-actions-v2">
                <button type="button" className="btn-secondary" onClick={() => setAddOpen(false)}>
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? '正在添加…' : '添加并连接'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
