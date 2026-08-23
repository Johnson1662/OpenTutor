import { useEffect, useState } from 'react';
import {
  listProviders,
  getAiPreferences,
  updateAiPreferences,
  startAuthSession,
  type ProviderInfo,
  type UserAiPreferences,
} from '../runtime/api.ts';

export function ProviderSettingsPage({ onFlash }: { onFlash: (msg: string) => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [prefs, setPrefs] = useState<UserAiPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKeyModal, setApiKeyModal] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [provList, userPrefs] = await Promise.all([
        listProviders(),
        getAiPreferences(),
      ]);
      setProviders(provList);
      setPrefs(userPrefs);
    } catch (err: any) {
      onFlash(`Error loading AI settings: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectApiKey(providerId: string) {
    if (!apiKeyInput.trim()) return;
    try {
      setSaving(true);
      await startAuthSession(providerId, 'api_key');
      onFlash(`Connected ${providerId} API key successfully!`);
      setApiKeyModal(null);
      setApiKeyInput('');
      await loadData();
    } catch (err: any) {
      onFlash(`Connection error: ${err.message}`);
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
    } catch (err: any) {
      onFlash(`Failed to save preferences: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="page-shell"><div className="loading-spinner">Loading AI Providers...</div></div>;
  }

  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>AI Provider Control Plane</h1>
        <p>Connect and configure your AI models. Credentials remain secure and locally encrypted.</p>
      </div>

      <section className="settings-grid">
        <div className="settings-card">
          <h2>Connected AI Providers</h2>
          <div className="provider-list">
            {providers.map((p) => (
              <div key={p.id} className="provider-item">
                <div className="provider-info">
                  <span className="provider-name">{p.name}</span>
                  <span className={`provider-badge ${p.configured ? 'active' : 'inactive'}`}>
                    {p.configured ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
                <div className="provider-actions">
                  {p.configured ? (
                    <button className="btn-secondary" onClick={() => onFlash(`${p.name} is ready for learning sessions.`)}>
                      Configured
                    </button>
                  ) : (
                    <button className="btn-primary" onClick={() => setApiKeyModal(p.id)}>
                      Connect API Key
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-card">
          <h2>Default Model Selection</h2>
          <p className="hint-text">Select the default model for Tutor, Knowledge Compilation, and dynamic Lessons.</p>

          <form onSubmit={handleSaveModelPreferences} className="preferences-form">
            <label className="form-field">
              <span>Default Provider</span>
              <select
                value={prefs?.defaultProviderId ?? 'anthropic'}
                onChange={(e) => setPrefs((prev) => prev ? { ...prev, defaultProviderId: e.target.value } : null)}
              >
                <option value="anthropic">Anthropic Claude</option>
                <option value="openai-codex">OpenAI / ChatGPT</option>
                <option value="google">Google Gemini</option>
              </select>
            </label>

            <label className="form-field">
              <span>Default Model ID</span>
              <select
                value={prefs?.defaultModelId ?? 'claude-3-7-sonnet-20250219'}
                onChange={(e) => setPrefs((prev) => prev ? { ...prev, defaultModelId: e.target.value } : null)}
              >
                <option value="claude-3-7-sonnet-20250219">Claude 3.7 Sonnet (Hybrid Reasoning)</option>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="gpt-4o">GPT-4o (Omni)</option>
                <option value="o3-mini">o3-mini (High Reasoning)</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              </select>
            </label>

            <label className="form-field">
              <span>Thinking / Reasoning Level</span>
              <select
                value={prefs?.thinkingLevel ?? 'medium'}
                onChange={(e) => setPrefs((prev) => prev ? { ...prev, thinkingLevel: e.target.value } : null)}
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

      {apiKeyModal && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <h3>Connect {apiKeyModal} API Key</h3>
            <p>Paste your secret key below to enable real AI knowledge compilation and Socratic tutoring:</p>
            <input
              type="password"
              placeholder="sk-..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="modal-input"
            />
            <div className="modal-buttons">
              <button className="btn-secondary" onClick={() => setApiKeyModal(null)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => handleConnectApiKey(apiKeyModal)}
                disabled={saving || !apiKeyInput.trim()}
              >
                {saving ? 'Connecting...' : 'Save Key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
