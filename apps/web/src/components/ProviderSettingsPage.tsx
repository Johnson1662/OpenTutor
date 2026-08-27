import { useEffect, useRef, useState } from 'react';
import {
  listProviders,
  listProviderModels,
  getAiPreferences,
  updateAiPreferences,
  loginWithApiKey,
  startAuthSession,
  cancelAuthSession,
  respondAuthSession,
  subscribeToAuthEvents,
  type ProviderInfo,
  type UserAiPreferences,
  type AuthUrlEventData,
  type AuthDeviceCodeEventData,
  type AuthPromptEventData,
  type AuthProgressEventData,
  type AuthFailedEventData,
} from '../runtime/api.ts';

type ModalTab = 'oauth' | 'api_key';
type AuthSessionStatus =
  | 'idle'
  | 'starting'
  | 'waiting_url'
  | 'waiting_device_code'
  | 'prompt'
  | 'in_progress'
  | 'completed'
  | 'failed';

export function ProviderSettingsPage({ onFlash }: { onFlash: (msg: string) => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [prefs, setPrefs] = useState<UserAiPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modal State
  const [modalProvider, setModalProvider] = useState<ProviderInfo | null>(null);
  const [activeTab, setActiveTab] = useState<ModalTab>('api_key');
  const [apiKeyInput, setApiKeyInput] = useState('');

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
  const modalBoxRef = useRef<HTMLDivElement | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement | null>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);

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
      onFlash(`Error loading AI settings: ${msg}`);
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

  function openConnectModal(provider: ProviderInfo, preferredTab?: ModalTab, trigger?: HTMLElement) {
    modalTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setModalProvider(provider);
    setApiKeyInput('');
    resetOAuthState();

    const hasOAuth = Boolean(provider.auth?.oauth?.available);
    const hasApiKey = Boolean(provider.auth?.apiKey?.available) || !provider.auth;

    if (preferredTab) {
      setActiveTab(preferredTab);
    } else if (hasOAuth && !hasApiKey) {
      setActiveTab('oauth');
    } else {
      setActiveTab('api_key');
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

  async function handleCloseModal() {
    if (authSessionId && (authStatus === 'starting' || authStatus === 'waiting_url' || authStatus === 'waiting_device_code' || authStatus === 'prompt' || authStatus === 'in_progress')) {
      try {
        await cancelAuthSession(authSessionId);
      } catch {
        // ignore cancellation error on modal close
      }
    }
    resetOAuthState();
    setModalProvider(null);
    setTimeout(() => modalTriggerRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!modalProvider) return;

    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void handleCloseModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        modalBoxRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
        ) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleModalKeyDown);
    requestAnimationFrame(() => modalCloseRef.current?.focus());
    return () => document.removeEventListener('keydown', handleModalKeyDown);
  }, [modalProvider]);

  async function handleConnectApiKey(providerId: string) {
    if (!apiKeyInput.trim()) return;
    try {
      setSaving(true);
      await loginWithApiKey(providerId, apiKeyInput.trim());
      onFlash(`Connected ${providerId} API key successfully!`);
      handleCloseModal();
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlash(`Connection error: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleStartOAuth(providerId: string) {
    try {
      resetOAuthState();
      setAuthStatus('starting');
      setAuthProgressMsg('Starting OAuth session...');

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
              // popup blocker might prevent window.open; link shown in UI
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
            setAuthProgressMsg('Authentication completed successfully!');
            onFlash(`Connected ${providerId} OAuth successfully!`);
            loadData();
            setTimeout(() => {
              handleCloseModal();
            }, 1200);
          } else if (event.type === 'auth.failed') {
            const data = event.data as AuthFailedEventData;
            setAuthStatus('failed');
            setAuthErrorMsg(data?.error || 'Authentication failed');
          } else if (event.type === 'auth.cancelled') {
            setAuthStatus('idle');
            setAuthProgressMsg('Authentication was cancelled');
          }
        },
        () => {
          setAuthStatus('failed');
          setAuthErrorMsg('Connection to auth event stream lost');
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

  async function handlePromptSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authSessionId || !authPrompt || !promptInput.trim()) return;

    try {
      setSaving(true);
      await respondAuthSession(authSessionId, authPrompt.promptId, promptInput.trim());
      setAuthPrompt(null);
      setPromptInput('');
      setAuthStatus('in_progress');
      setAuthProgressMsg('Response submitted, waiting for verification...');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlash(`Error submitting response: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveModelPreferences(e: React.FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    try {
      setSaving(true);
      await updateAiPreferences(prefs);
      onFlash('AI Model preferences saved! (Applies to new learning sessions)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onFlash(`Failed to save preferences: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="page-shell"><div className="loading-spinner">正在加载 AI 设置…</div></div>;
  }

  const selectedProvider = providers.find((provider) => provider.id === prefs?.defaultProviderId) || providers[0];
  const hasOAuth = Boolean(selectedProvider?.auth?.oauth?.available);
  const hasApiKey = Boolean(selectedProvider?.auth?.apiKey?.available) || !selectedProvider?.auth;

  return (
    <main className="page-shell settings-page">
      <header className="settings-header">
        <div><span className="page-eyebrow">账户与偏好</span><h1>设置</h1><p>配置账号、AI 模型和学习偏好</p></div>
      </header>

      <div className="settings-layout">
        <aside className="settings-nav" aria-label="设置分类">
          <span>♙ 账号信息</span>
          <span className="active">◇ AI 模型</span>
          <span>☷ 学习偏好</span>
          <span>♧ 通知设置</span>
        </aside>

        <form className="settings-content" onSubmit={handleSaveModelPreferences}>
          <section className="settings-model-card">
            <div className="settings-card-heading"><div><span className="page-eyebrow">模型配置</span><h2>AI 模型</h2></div>{selectedProvider && <span className={selectedProvider.configured ? 'settings-connected' : 'settings-disconnected'}>{selectedProvider.configured ? '已连接' : '未连接'}</span>}</div>
            <div className="settings-model-grid">
              <label className="form-field"><span>模型服务商</span><select value={prefs?.defaultProviderId ?? selectedProvider?.id ?? ''} onChange={(event) => { const providerId = event.target.value; setPrefs((previous) => previous ? { ...previous, defaultProviderId: providerId } : previous); loadModels(providerId); }} disabled={!providers.length}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label>
              <label className="form-field"><span>模型</span><select value={prefs?.defaultModelId ?? ''} onChange={(event) => setPrefs((previous) => previous ? { ...previous, defaultModelId: event.target.value } : previous)} disabled={!selectedProvider}>{models.length ? models.map((model) => <option value={model.id} key={model.id}>{model.name || model.id}</option>) : <option value={prefs?.defaultModelId ?? ''}>{prefs?.defaultModelId || '默认模型'}</option>}</select></label>
            </div>
            <div className="settings-auth-block"><span className="settings-field-label">认证方式</span><div className="settings-auth-tabs"><button type="button" className={hasApiKey ? 'active' : ''} disabled={!selectedProvider || !hasApiKey} onClick={(event) => selectedProvider && openConnectModal(selectedProvider, 'api_key', event.currentTarget)}>API Key</button><button type="button" className={!hasApiKey && hasOAuth ? 'active' : ''} disabled={!selectedProvider || !hasOAuth} onClick={(event) => selectedProvider && openConnectModal(selectedProvider, 'oauth', event.currentTarget)}>OAuth / 订阅登录</button></div></div>
            <div className="credential-row"><div><span className="settings-field-label">API Key</span><p>密钥仅保存在本地设备，OpenTutor 不会写入数据库。</p></div><button type="button" className="credential-display" disabled={!selectedProvider || !hasApiKey} onClick={(event) => selectedProvider && openConnectModal(selectedProvider, 'api_key', event.currentTarget)}>{selectedProvider?.configured ? '••••••••••••••••' : '点击配置 API Key'}<span aria-hidden="true">⌁</span></button></div>
            <div className="settings-model-actions"><span>当前状态：<strong className={selectedProvider?.configured ? 'settings-connected' : 'settings-disconnected'}>{selectedProvider?.configured ? '已连接 ✓' : '未连接'}</strong></span><div><button type="button" className="btn-secondary" disabled={!selectedProvider || !hasApiKey} onClick={(event) => selectedProvider && openConnectModal(selectedProvider, 'api_key', event.currentTarget)}>测试连接</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? '保存中…' : '保存设置'}</button></div></div>
            {selectedProvider?.configured && <div className="connection-success"><span className="success-mark">✓</span><div><strong>连接成功</strong><small>模型服务可用，响应正常。</small></div><button type="button" className="btn-secondary btn-sm" onClick={(event) => openConnectModal(selectedProvider, hasOAuth ? 'oauth' : 'api_key', event.currentTarget)}>重新测试</button></div>}
          </section>

          <section className="settings-preferences-card"><div className="settings-card-heading"><div><span className="page-eyebrow">学习体验</span><h2>学习偏好</h2></div></div><div className="preference-grid"><label className="preference-row"><span>默认难度 <small>ⓘ</small></span><select value={prefs?.thinkingLevel ?? 'medium'} onChange={(event) => setPrefs((previous) => previous ? { ...previous, thinkingLevel: event.target.value } : previous)}><option value="off">快速</option><option value="low">简单</option><option value="medium">中等</option><option value="high">深入</option></select></label><label className="preference-row"><span>默认服务商 <small>ⓘ</small></span><strong>{selectedProvider?.name || '未选择'}</strong></label><label className="preference-row"><span>课程编译模式 <small>ⓘ</small></span><strong>知识图谱 + 证据</strong></label><label className="preference-row"><span>诊断题来源 <small>ⓘ</small></span><strong>当前学习节点</strong></label></div></section>
        </form>
      </div>
      {modalProvider && (
        <div className="modal-backdrop">
          <div
            ref={modalBoxRef}
            className="modal-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-modal-title"
            style={{ maxWidth: '500px', width: '90%' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3 id="connect-modal-title" style={{ margin: 0 }}>Connect {modalProvider.name}</h3>
              <button
                ref={modalCloseRef}
                className="btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={handleCloseModal}
                aria-label="Close connection dialog"
              >
                ✕
              </button>
            </div>

            {/* Tabs if both auth methods are available */}
            {modalProvider.auth?.oauth?.available && (modalProvider.auth?.apiKey?.available ?? true) && (
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  borderBottom: '1px solid #e7e6e2',
                  marginBottom: '16px',
                }}
              >
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'oauth' ? 'active' : ''}`}
                  onClick={() => {
                    resetOAuthState();
                    setActiveTab('oauth');
                  }}
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                >
                  OAuth / Web Login
                </button>
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'api_key' ? 'active' : ''}`}
                  onClick={() => {
                    resetOAuthState();
                    setActiveTab('api_key');
                  }}
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                >
                  API Key
                </button>
              </div>
            )}

            {/* TAB: API KEY */}
            {activeTab === 'api_key' && (
              <div>
                <p>
                  Paste your API secret key below to enable real AI knowledge compilation and
                  Socratic tutoring:
                </p>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="modal-input"
                  autoFocus
                />
                <div className="modal-buttons">
                  <button className="btn-secondary" onClick={handleCloseModal}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => handleConnectApiKey(modalProvider.id)}
                    disabled={saving || !apiKeyInput.trim()}
                  >
                    {saving ? 'Connecting...' : 'Save & Connect'}
                  </button>
                </div>
              </div>
            )}

            {/* TAB: OAUTH */}
            {activeTab === 'oauth' && (
              <div>
                {authStatus === 'idle' && (
                  <div>
                    <p>
                      Connect your account using OAuth browser authorization or device code. No
                      manual API key required.
                    </p>
                    <div className="modal-buttons">
                      <button className="btn-secondary" onClick={handleCloseModal}>
                        Cancel
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => handleStartOAuth(modalProvider.id)}
                      >
                        Start OAuth Login
                      </button>
                    </div>
                  </div>
                )}

                {authStatus !== 'idle' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {authProgressMsg && (
                      <div
                        style={{
                          padding: '10px 12px',
                          background: '#f4f4f1',
                          borderRadius: '6px',
                          fontSize: '13px',
                          color: '#444',
                        }}
                      >
                        {authProgressMsg}
                      </div>
                    )}

                    {authUrl && (
                      <div
                        style={{
                          padding: '12px',
                          background: '#eaf3ed',
                          borderRadius: '6px',
                          fontSize: '13px',
                        }}
                      >
                        <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>
                          Authorization Window Opened
                        </p>
                        <p style={{ margin: '0 0 10px 0', fontSize: '12px' }}>
                          If the browser window did not open automatically, please click below:
                        </p>
                        <a
                          href={authUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-primary"
                          style={{
                            display: 'inline-block',
                            textDecoration: 'none',
                            fontSize: '12px',
                            padding: '6px 12px',
                          }}
                        >
                          Open Authorization Page ↗
                        </a>
                      </div>
                    )}

                    {deviceCode && (
                      <div
                        style={{
                          padding: '14px',
                          background: '#fafaf8',
                          border: '1px solid #e7e6e2',
                          borderRadius: '6px',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '12px', color: '#6e6d68', marginBottom: '6px' }}>
                          Enter this code on the authorization page:
                        </div>
                        <div
                          style={{
                            fontSize: '22px',
                            fontWeight: 700,
                            letterSpacing: '2px',
                            fontFamily: 'monospace',
                            color: '#1f1f1d',
                            marginBottom: '10px',
                          }}
                        >
                          {deviceCode.userCode}
                        </div>
                        {deviceCode.verificationUri && (
                          <a
                            href={deviceCode.verificationUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-primary"
                            style={{
                              display: 'inline-block',
                              textDecoration: 'none',
                              fontSize: '12px',
                              padding: '6px 12px',
                            }}
                          >
                            Open Verification Page ({deviceCode.verificationUri}) ↗
                          </a>
                        )}
                      </div>
                    )}

                    {authPrompt && (
                      <form
                        onSubmit={handlePromptSubmit}
                        style={{
                          padding: '12px',
                          background: '#fff',
                          border: '1px solid #e7e6e2',
                          borderRadius: '6px',
                        }}
                      >
                        <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px' }}>
                          {authPrompt.message}
                        </label>
                        {authPrompt.promptType === 'select' && authPrompt.choices && authPrompt.choices.length > 0 ? (
                          <select
                            value={promptInput}
                            onChange={(e) => setPromptInput(e.target.value)}
                            className="modal-input"
                            style={{ marginBottom: '10px' }}
                            autoFocus
                          >
                            <option value="" disabled>Select an option...</option>
                            {authPrompt.choices.map((c) => {
                              const val = c.value ?? c.id ?? c.label;
                              return <option key={val} value={val}>{c.label}</option>;
                            })}
                          </select>
                        ) : (
                          <input
                            type={authPrompt.promptType === 'secret' ? 'password' : 'text'}
                            value={promptInput}
                            onChange={(e) => setPromptInput(e.target.value)}
                            placeholder={
                              authPrompt.promptType === 'manual_code'
                                ? 'Enter authorization code'
                                : (authPrompt.placeholder || 'Enter response...')
                            }
                            className="modal-input"
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
                          {saving ? 'Submitting...' : 'Submit'}
                        </button>
                      </form>
                    )}

                    {authErrorMsg && (
                      <div
                        style={{
                          padding: '10px 12px',
                          background: '#fdeeed',
                          color: '#b3261e',
                          borderRadius: '6px',
                          fontSize: '13px',
                        }}
                      >
                        Error: {authErrorMsg}
                      </div>
                    )}

                    <div className="modal-buttons" style={{ marginTop: '12px' }}>
                      <button
                        className="btn-secondary"
                        onClick={handleCancelOAuth}
                        disabled={authStatus === 'completed'}
                      >
                        Cancel Authorization
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
