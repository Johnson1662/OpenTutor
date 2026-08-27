import { useEffect, useState } from 'react';
import type { AssessmentResult, LearningEvent, LearningSessionSnapshot, QuizBlock } from '@opentutor/protocol';
import { getSession, submitQuizAnswer, subscribeToLearningEvents } from '../runtime/api.ts';

function readAssessment(data: unknown): AssessmentResult | undefined {
  if (typeof data !== 'object' || data === null || !('assessment' in data)) return undefined;
  const value = data.assessment;
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('id' in value) || !('knowledgeNodeId' in value) || !('lessonId' in value) || !('result' in value) || !('confidence' in value) || !('feedback' in value)) return undefined;
  if (
    typeof value.id !== 'string' ||
    typeof value.knowledgeNodeId !== 'string' ||
    typeof value.lessonId !== 'string' ||
    ('blockId' in value && value.blockId !== undefined && typeof value.blockId !== 'string') ||
    (value.result !== 'correct' && value.result !== 'partial' && value.result !== 'incorrect') ||
    typeof value.confidence !== 'number' ||
    typeof value.feedback !== 'string'
  ) return undefined;
  const blockId = 'blockId' in value && typeof value.blockId === 'string' ? value.blockId : undefined;
  return {
    id: value.id,
    knowledgeNodeId: value.knowledgeNodeId,
    lessonId: value.lessonId,
    blockId,
    result: value.result,
    confidence: value.confidence,
    feedback: value.feedback,
  };
}

function isQuizBlock(block: LearningSessionSnapshot['lesson']['blocks'][number]): block is QuizBlock {
  return block.type === 'quiz';
}

export function DiagnosticPage({
  sessionId,
  onNavigate,
  onFlash,
}: {
  sessionId: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<LearningSessionSnapshot | null>(null);
  const [answer, setAnswer] = useState('');
  const [assessment, setAssessment] = useState<AssessmentResult>();
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let closeSubscription: () => void = () => undefined;
    getSession(sessionId)
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        closeSubscription = subscribeToLearningEvents(
          sessionId,
          nextSnapshot.lastSeq,
          (event: LearningEvent) => {
            if (event.type === 'assessment.completed') {
              const nextAssessment = readAssessment(event.data);
              if (nextAssessment) setAssessment(nextAssessment);
            }
          },
          setConnected,
        );
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      });
    return () => {
      cancelled = true;
      closeSubscription();
    };
  }, [sessionId]);

  async function handleSubmit() {
    const quiz = snapshot?.lesson.blocks.find(isQuizBlock);
    if (!quiz || !snapshot || !answer.trim()) return;
    try {
      setBusy(true);
      await submitQuizAnswer(snapshot.lesson.id, quiz.id, answer, sessionId);
      onFlash('诊断答案已提交，正在更新学习状态。');
    } catch (submitError: any) {
      onFlash(`提交诊断失败：${submitError.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="page-shell"><div className="empty-state-card"><h2>诊断测验加载失败</h2><p>{error}</p><button className="btn-primary" onClick={() => onNavigate(`/learn/${sessionId}`)}>返回学习空间</button></div></div>;
  if (!snapshot) return <div className="page-shell"><div className="loading-spinner">正在准备诊断测验…</div></div>;

  const quiz = snapshot.lesson.blocks.find(isQuizBlock);
  const current = snapshot.path.find((node) => node.status === 'current');
  const options = quiz?.options || [];
  const step = snapshot.path.findIndex((node) => node.status === 'current');
  const completed = snapshot.path.filter((node) => node.status === 'completed').length;

  return (
    <main className="page-shell diagnostic-page">
      <header className="diagnostic-header">
        <div>
          <span className="page-eyebrow">先修知识检查 · {connected ? '已连接' : '连接中'}</span>
          <h1>诊断测验：{current?.title || snapshot.lesson.title}</h1>
          <p>用几道题确认当前节点的基础知识，再决定下一步学习路径。</p>
        </div>
        <div className="diagnostic-progress"><span>学习路径</span><strong>{Math.max(step + 1, 1)} / {Math.max(snapshot.path.length, 1)}</strong></div>
      </header>

      <div className="diagnostic-layout">
        <section className="diagnostic-main-card">
          <div className="diagnostic-steps" aria-label="诊断进度">
            {['概念识别', '基础理解', '路径更新'].map((label, index) => <span className={index === 0 ? 'active' : index < completed ? 'done' : ''} key={label}><b>{index < completed ? '✓' : index + 1}</b>{label}</span>)}
          </div>
          {quiz ? (
            <>
              <div className="diagnostic-question"><span>1. 快速检查</span><h2>{quiz.question}</h2></div>
              {options.length ? <div className="diagnostic-options">{options.map((option) => <label className={`diagnostic-option ${answer === option.id ? 'selected' : ''}`} key={option.id}><input type="radio" name={quiz.id} value={option.id} checked={answer === option.id} onChange={() => setAnswer(option.id)} /><span>{option.text}</span></label>)}</div> : <textarea className="diagnostic-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="写下你的理解…" rows={5} />}
              <div className="diagnostic-actions"><button className="btn-primary" disabled={busy || !answer.trim()} onClick={handleSubmit}>{busy ? '提交中…' : '提交答案'}</button><button className="btn-secondary" onClick={() => onNavigate(`/learn/${sessionId}`)}>暂时跳过</button></div>
              {assessment && <div className={`diagnostic-result ${assessment.result === 'correct' ? 'success' : ''}`}><strong>{assessment.result === 'correct' ? '基础知识已确认' : '还需要补充基础'}</strong><p>{assessment.feedback}</p></div>}
            </>
          ) : <div className="diagnostic-empty"><h2>当前节点暂无诊断题</h2><p>返回学习空间继续学习，系统会在发现前置知识缺口时生成诊断题。</p><button className="btn-primary" onClick={() => onNavigate(`/learn/${sessionId}`)}>返回学习空间</button></div>}
        </section>

        <aside className="diagnostic-side-card">
          <span className="page-eyebrow">诊断结果概览</span>
          <div className="diagnostic-status-row"><b>▣</b><span><strong>基础判断</strong><small>{assessment ? assessment.result : '等待提交'}</small></span></div>
          <div className="diagnostic-status-row"><b>△</b><span><strong>薄弱知识</strong><small>{current?.title || '等待识别'}</small></span></div>
          <div className="diagnostic-status-row"><b>↗</b><span><strong>建议动作</strong><small>{assessment?.result === 'correct' ? '返回当前课程' : '补充先修知识'}</small></span></div>
          <div className="diagnostic-side-footer">已完成 {completed} 个课程节点</div>
        </aside>
      </div>

      <section className="diagnostic-bottom-card">
        <div><span className="page-eyebrow">提交后</span><h2>学习路径会同步更新</h2><p>诊断结果会写入当前知识节点，并通过 Session 事件更新路线。</p></div>
        <button className="btn-secondary" onClick={() => onNavigate(`/courses/${snapshot.courseId || 'transformer'}/path`)}>查看学习路径 →</button>
      </section>
    </main>
  );
}
