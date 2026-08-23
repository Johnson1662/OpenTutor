import { useState } from 'react';
import type { TutorAction } from '@opentutor/protocol';

export function TutorPanel({
  busy,
  connected,
  messages,
  onAction,
  onSendMessage,
}: {
  busy: boolean;
  connected: boolean;
  messages: string[];
  onAction: (action: TutorAction) => void;
  onSendMessage: (message: string) => void;
}) {
  const [input, setInput] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    onSendMessage(trimmed);
    setInput('');
  }

  return (
    <aside className="tutor-panel">
      <div>
        <div className="section-label">Tutor <span className={connected ? 'connection online' : 'connection'}>{connected ? 'Live' : 'Offline'}</span></div>
        <h2>Adjust this lesson</h2>
        <div className="quick-actions">
          <button disabled={busy} onClick={() => onAction('simpler')}>Simpler</button>
          <button disabled={busy} onClick={() => onAction('show_code')}>Show code</button>
          <button disabled={busy} onClick={() => onAction('visualize')}>Visualize</button>
          <button disabled={busy} onClick={() => onAction('softmax_unknown')}>I don't understand Softmax</button>
        </div>
      </div>

      <div className="tutor-thread">
        {messages.map((message, i) => <div className="tutor-message" key={`${i}-${message}`}>{message}</div>)}
        {busy && <div className="tutor-message muted">AI Tutor is reasoning and updating lesson…</div>}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question or request adjustments (e.g. 'Show me code', 'Explain simpler')..."
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
