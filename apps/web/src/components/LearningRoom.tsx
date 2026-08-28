import { useEffect, useRef, useState } from 'react';
import type {
  AssessmentCompletedEventData,
  AssessmentResult,
  AgentCompletedEventData,
  LearningEvent,
  LearningSessionSnapshot,
  LessonActivatedEventData,
  LessonPatchEventData,
  LessonProgressEventData,
  LessonUpdatedEventData,
  PathPatchEventData,
  LessonStepProgress,
} from '@opentutor/protocol';
import { applyLessonPatches, applyPathPatches } from '../runtime/patch.ts';
import { isNewLearningEvent } from '../runtime/events.ts';
import {
  advanceLessonProgress,
  getLessonProgress,
  getSession,
  sendTutorMessage,
  submitQuizAnswer,
  subscribeToLearningEvents,
} from '../runtime/api.ts';
import { LessonCanvas } from './LessonCanvas.tsx';

const contextActions = [
  { label: '讲简单一点', message: '请把当前步骤讲得更简单，只保留一个小例子。' },
  { label: '给一个代码例子', message: '请针对当前步骤补一个最小、可读的代码例子。' },
  { label: '画关系图', message: '请用一个简单关系图解释当前步骤，不要展开新主题。' },
  { label: '我卡住了', message: '我卡住了，请先给我一个小探针问题，不要直接告诉答案。' },
];
const reinforcementPrompt = '当前已有学习步骤已经完成，但我还没有掌握这个知识点。请根据我的学习和评估结果，为当前知识点新增一个最有价值的补充教学或检查步骤。主要内容通过 lesson_patch 加入 Canvas，只用一句话回复我。';

function shortText(value: string) {
  const clean = value.replace(/\s+/gu, ' ').trim();
  return clean.length > 80 ? clean.slice(0, 80) + '…' : clean;
}

export function LearningRoom({
  sessionId,
  onNavigate,
  onFlash,
  onConnectionChange,
}: {
  sessionId: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<LearningSessionSnapshot | null>(null);
  const [progress, setProgress] = useState<LessonStepProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastUser, setLastUser] = useState('');
  const [lastAgent, setLastAgent] = useState('');
  const [submittedBlockId, setSubmittedBlockId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<AssessmentResult>();
  const lastSeqRef = useRef(0);
  const refreshRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    async function bootstrap() {
      try {
        const loaded = await getSession(sessionId);
        let nextSnapshot = loaded;
        let nextProgress = loaded.lessonProgress;
        if (!nextProgress) {
          try {
            nextProgress = await getLessonProgress(sessionId, loaded.lesson.id);
            nextSnapshot = { ...loaded, lessonProgress: nextProgress };
          } catch {
            // Older synthetic sessions can lack a persisted lesson row.
          }
        }
        if (disposed) return;
        setSnapshot(nextSnapshot);
        setProgress(nextProgress ?? null);
        lastSeqRef.current = nextSnapshot.lastSeq;
        const close = subscribeToLearningEvents(sessionId, lastSeqRef.current, handleEvent, (status) => {
          setConnected(status);
          onConnectionChange?.(status);
        });
        if (disposed) close();
        else unsubscribe = close;
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    function handleEvent(event: LearningEvent) {
      if (!isNewLearningEvent(lastSeqRef.current, event.seq)) return;
      lastSeqRef.current = event.seq;
      if (event.type === 'agent.started') setBusy(true);
      if (event.type === 'agent.completed') {
        const data = event.data as AgentCompletedEventData;
        setBusy(false);
        setLastAgent(shortText(data.message));
      }
      if (event.type === 'lesson.progress') {
        const data = event.data as LessonProgressEventData;
        setProgress((current) => current && current.lessonId !== data.lessonId ? current : current && current.version >= data.version ? current : data);
        setSnapshot((current) => current && current.lesson.id === data.lessonId && (!current.lessonProgress || current.lessonProgress.version < data.version) ? { ...current, lessonProgress: data } : current);
      }
      if (event.type === 'lesson.activated') {
        const data = event.data as LessonActivatedEventData;
        setBusy(false);
        const refreshId = ++refreshRef.current;
        void getSession(sessionId).then((fresh) => {
          if (refreshId !== refreshRef.current) return;
          setSnapshot(fresh);
          setProgress(fresh.lessonProgress ?? null);
          setSubmittedBlockId(null);
        }).catch(() => {
          setSnapshot((current) => current ? { ...current, lesson: data.lesson } : current);
          setProgress(null);
        });
      }
      if (event.type === 'lesson.patch') {
        const data = event.data as LessonPatchEventData;
        setSnapshot((current) => current && current.lesson.id === data.lessonId ? { ...current, lesson: applyLessonPatches(current.lesson, data.patches, data.version) } : current);
      }
      if (event.type === 'lesson.updated') {
        const data = event.data as LessonUpdatedEventData;
        setSnapshot((current) => current && current.lesson.id === data.lessonId && data.version > current.lesson.version ? { ...current, lesson: { ...current.lesson, ...data.changes, version: data.version } } : current);
      }
      if (event.type === 'path.patch') {
        const data = event.data as PathPatchEventData;
        setSnapshot((current) => current && data.version > current.pathVersion ? { ...current, path: applyPathPatches(current.path, data.patches), pathVersion: data.version } : current);
      }
      if (event.type === 'assessment.completed') {
        setAssessment((event.data as AssessmentCompletedEventData).assessment);
      }
      if (event.type === 'knowledge.updated') {
        const data = event.data as { status?: string };
        setLastAgent(shortText('知识状态已更新：' + (data.status || '学习中')));
      }
      if (event.type === 'error') {
        setBusy(false);
        onFlash('助教处理失败：' + ((event.data as { error?: string })?.error || '请重试'));
      }
    }

    bootstrap();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [sessionId]);

  const lesson = snapshot?.lesson;
  const path = snapshot?.path ?? [];
  const currentNode = path.find((node) => node.status === 'current');
  const activeBlock = lesson && progress?.activeBlockId ? lesson.blocks.find((block) => block.id === progress.activeBlockId) : undefined;
  const currentIndex = Math.max(0, path.findIndex((node) => node.status === 'current'));
  const completedNodes = path.filter((node) => node.status === 'completed').length;
  const routeProgress = path.length ? Math.round(completedNodes / path.length * 100) : 0;
  const courseId = snapshot?.courseId || lesson?.courseId;
  const canAdvance = Boolean(progress && progress.activeBlockId && activeBlock && activeBlock.id === progress.activeBlockId);
  const needsReinforcement = progress?.activeBlockId === null && Boolean(currentNode);

  async function refreshSnapshot() {
    const fresh = await getSession(sessionId);
    setSnapshot(fresh);
    setProgress(fresh.lessonProgress ?? null);
    setSubmittedBlockId(null);
  }

  async function tutor(messageToSend: string) {
    const trimmed = messageToSend.trim();
    if (!trimmed || busy || advancing) return;
    setMessage('');
    setLastUser(shortText(trimmed));
    setBusy(true);
    try {
      await sendTutorMessage(trimmed, sessionId);
    } catch (cause) {
      setBusy(false);
      onFlash(cause instanceof Error ? cause.message : '消息发送失败');
    }
  }

  async function submitAnswer(blockId: string, answer: string) {
    if (!lesson || busy || advancing) return;
    setBusy(true);
    try {
      await submitQuizAnswer(lesson.id, blockId, answer, sessionId);
      setSubmittedBlockId(blockId);
      setBusy(false);
      setLastUser(shortText('提交了当前步骤的回答'));
    } catch (cause) {
      setBusy(false);
      onFlash(cause instanceof Error ? cause.message : '答案提交失败');
    }
  }

  async function advance() {
    if (!snapshot || !lesson || !progress || !canAdvance || advancing) return;
    const requestRefreshId = refreshRef.current;
    setAdvancing(true);
    setBusy(true);
    try {
      const result = await advanceLessonProgress(sessionId, {
        lessonId: lesson.id,
        activeBlockId: progress.activeBlockId,
        version: progress.version,
      });
      if (requestRefreshId !== refreshRef.current) return;
      setSnapshot(result.snapshot);
      setProgress(result.snapshot.lessonProgress ?? result.progress);
      setSubmittedBlockId(null);
      setAssessment(undefined);
      setBusy(false);
    } catch (cause) {
      setBusy(false);
      try {
        await refreshSnapshot();
        onFlash('学习进度有更新，已重新读取当前步骤。');
      } catch {
        onFlash(cause instanceof Error ? cause.message : '无法保存学习进度');
      }
    } finally {
      setAdvancing(false);
    }
  }

  if (error) return <main className="player-error"><span className="eyebrow">Learning session</span><h1>学习空间暂时打不开</h1><p>{error}</p><button type="button" className="btn-primary" onClick={() => onNavigate('/courses')}>返回我的学习</button></main>;
  if (!snapshot || !lesson) return <main className="player-loading"><span className="loading-spinner" />正在打开学习空间…</main>;

  return <main className="player-page">
    <header className="player-header">
      <button type="button" className="player-back" onClick={() => onNavigate(courseId ? '/courses/' + courseId + '?tab=route' : '/courses')} aria-label="返回课程路径">←</button>
      <div className="player-course"><span>{currentNode?.title || lesson.title}</span><strong>{lesson.title}</strong></div>
      <div className="player-progress"><div className="progress-line"><i style={{ width: routeProgress + '%' }} /></div><small>路径 {currentIndex + 1} / {path.length || '—'}</small></div>
      <span className={'connection-state ' + (connected ? 'online' : '')}><i />{connected ? '同步中' : '连接中'}</span>
      <div className="player-menu-wrap"><button type="button" className="player-menu-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label="打开课程菜单">•••</button>{menuOpen && <div className="player-menu"><button type="button" onClick={() => onNavigate(courseId ? '/courses/' + courseId + '?tab=route' : '/courses')}>课程路径</button><button type="button" onClick={() => onNavigate(courseId ? '/courses/' + courseId + '?tab=knowledge' : '/courses')}>知识关系</button><button type="button" onClick={() => onNavigate(courseId ? '/courses/' + courseId + '?tab=materials' : '/courses')}>课程资料</button></div>}</div>
    </header>

    <section className="player-content">
      <LessonCanvas lesson={lesson} activeBlock={activeBlock} assessment={assessment?.blockId === activeBlock?.id ? assessment : undefined} busy={busy} submitted={submittedBlockId === activeBlock?.id} canAdvance={canAdvance} onQuizSubmit={submitAnswer} onAdvance={() => void advance()} />
      <div className="player-feedback" aria-live="polite">{lastUser && <p><small>你</small>{lastUser}</p>}{lastAgent && <p><small>OpenTutor</small>{lastAgent}</p>}</div>
      {needsReinforcement ? <div className="player-complete"><p>这一轮内容已经完成，但这个知识点还需要再巩固一下。</p><button type="button" className="btn-primary" disabled={busy || advancing} onClick={() => void tutor(reinforcementPrompt)}>再巩固一下</button></div> : !activeBlock && <button type="button" className="btn-primary player-complete" onClick={() => onNavigate(courseId ? '/courses/' + courseId + '?tab=route' : '/courses')}>返回课程路径 <span aria-hidden="true">→</span></button>}
    </section>

    <section className="player-assist" aria-label="学习帮助">
      <div className="context-actions">{contextActions.map((item) => <button type="button" key={item.label} disabled={busy || advancing} onClick={() => void tutor(item.message)}>{item.label}</button>)}</div>
      <form className="player-composer" onSubmit={(event) => { event.preventDefault(); void tutor(message); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={1} placeholder="告诉助教你卡在哪里…" disabled={busy || advancing} /><button type="submit" className="btn-primary" disabled={busy || advancing || !message.trim()}>发送</button></form>
    </section>
  </main>;
}
