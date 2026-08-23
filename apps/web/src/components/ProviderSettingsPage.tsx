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

  function openConnectModal(provider: ProviderInfo, preferredTab?: ModalTab) {
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
  }

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
    return (
      <div className="page-shell">
        <div className="loading-spinner">Loading AI Providers...</div>
      </div>
    );
  }

  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>AI Provider Control Plane</h1>
        <p>
          Credentials are stored locally by the Pi model runtime and are never written to the
          OpenTutor SQLite database.
        </p>
      </div>

      <section className="settings-grid">
        <div className="settings-card">
          <h2>Connected AI Providers</h2>
          <div className="provider-list">
            {providers.map((p) => {
              const hasOAuth = Boolean(p.auth?.oauth?.available);
              const hasApiKey = Boolean(p.auth?.apiKey?.available) || !p.auth;

              return (
                <div key={p.id} className="provider-item">
                  <div className="provider-info">
                    <span className="provider-name">{p.name}</span>
                    <span className={`provider-badge ${p.configured ? 'active' : 'inactive'}`}>
                      {p.configured ? 'Connected' : 'Not Connected'}
                    </span>
                  </div>
                  <div className="provider-actions" style={{ display: 'flex', gap: '8px' }}>
                    {p.configured ? (
                      <button
                        className="btn-secondary"
                        onClick={() => openConnectModal(p)}
                        title="Change credentials or re-authenticate"
                      >
                        Configured
                      </button>
                    ) : (
                      <>
                        {hasOAuth && (
                          <button
                            className="btn-primary"
                            onClick={() => openConnectModal(p, 'oauth')}
                          >
                            {p.auth?.oauth?.label ?? 'OAuth Login'}
                          </button>
                        )}
                        {hasApiKey && (
                          <button
                            className={hasOAuth ? 'btn-secondary' : 'btn-primary'}
                            onClick={() => openConnectModal(p, 'api_key')}
                          >
                            {p.auth?.apiKey?.label ?? 'API Key'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="settings-card">
          <h2>Default Model Selection</h2>
          <p className="hint-text">
            Select your default model for Socratic Tutor, Knowledge Compilation, and dynamic
            Lessons.
          </p>

          <form onSubmit={handleSaveModelPreferences} className="preferences-form">
            <label className="form-field">
              <span>Default Provider</span>
              <select
                value={prefs?.defaultProviderId ?? 'anthropic'}
                onChange={(e) => {
                  const newProv = e.target.value;
                  setPrefs((prev) => (prev ? { ...prev, defaultProviderId: newProv } : null));
                  loadModels(newProv);
                }}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>Default Model ID</span>
              <select
                value={prefs?.defaultModelId ?? ''}
                onChange={(e) =>
                  setPrefs((prev) => (prev ? { ...prev, defaultModelId: e.target.value } : null))
                }
              >
                {models.length > 0 ? (
                  models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))
                ) : (
                  <option value={prefs?.defaultModelId ?? 'claude-3-7-sonnet-20250219'}>
                    {prefs?.defaultModelId ?? 'Default Model'}
                  </option>
                )}
              </select>
            </label>

            <label className="form-field">
              <span>Thinking / Reasoning Level</span>
              <select
                value={prefs?.thinkingLevel ?? 'medium'}
                onChange={(e) =>
                  setPrefs((prev) => (prev ? { ...prev, thinkingLevel: e.target.value } : null))
                }
              >
                <option value="off">Off (Fastest)</option>
                <option value="low">Low</option>
                <option value="medium">Medium (Recommended)</option>
                <option value="high">High (Deep Socratic)</option>
              </select>
            </label>

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save AI Preferences'}
            </button>
          </form>
        </div>
      </section>

      {modalProvider && (
        <div className="modal-backdrop">
          <div className="modal-box" style={{ maxWidth: '500px', width: '90%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3 style={{ margin: 0 }}>Connect {modalProvider.name}</h3>
              <button
                className="btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={handleCloseModal}
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
                        <input
                          type="text"
                          value={promptInput}
                          onChange={(e) => setPromptInput(e.target.value)}
                          placeholder={authPrompt.placeholder || 'Enter response...'}
                          className="modal-input"
                          style={{ marginBottom: '10px' }}
                          autoFocus
                        />
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
