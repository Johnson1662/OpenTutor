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
        <div className="section-label">AI 学习助教 <span className={connected ? 'connection online' : 'connection'}>{connected ? '在线' : '连接中'}</span></div>
        <h2>需要一点帮助？</h2>
        <div className="quick-actions">
          <button disabled={busy} onClick={() => onAction('simpler')}>讲得简单一点</button>
          <button disabled={busy} onClick={() => onAction('show_code')}>给我看代码</button>
          <button disabled={busy} onClick={() => onAction('visualize')}>画个图</button>
          <button disabled={busy} onClick={() => onAction('softmax_unknown')}>我不懂 Softmax</button>
        </div>
      </div>

      <div className="tutor-thread">
        {messages.map((message, i) => <div className="tutor-message" key={`${i}-${message}`}>{message}</div>)}
        {busy && <div className="tutor-message muted">AI 助教正在思考并更新课程…</div>}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="提问，或告诉 AI 助教如何调整课程…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>发送</button>
      </form>
    </aside>
  );
}
