import type { TutorAction } from '@opentutor/protocol';

export function TutorPanel({
  busy,
  connected,
  messages,
  onAction,
}: {
  busy: boolean;
  connected: boolean;
  messages: string[];
  onAction: (action: TutorAction) => void;
}) {
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
        {busy && <div className="tutor-message muted">Server is updating the lesson…</div>}
      </div>

      <div className="composer">
        <input placeholder="Natural-language Tutor comes with Pi integration…" disabled />
      </div>
    </aside>
  );
}
