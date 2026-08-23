import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssessmentCompletedEventData,
  AssessmentResult,
  AgentCompletedEventData,
  LearningEvent,
  LearningPathNode,
  Lesson,
  LessonPatchEventData,
  LessonUpdatedEventData,
  PathPatchEventData,
  TutorAction,
} from '@opentutor/protocol';
import { applyLessonPatches, applyPathPatches } from './runtime/patch';
import { getPrototypeSession, runTutorAction, submitQuizAnswer, subscribeToLearningEvents } from './runtime/api';
import { LearningPathPanel } from './components/LearningPathPanel';
import { LessonCanvas } from './components/LessonCanvas';
import { TutorPanel } from './components/TutorPanel';

export function App() {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [path, setPath] = useState<LearningPathNode[]>([]);
  const [pathVersion, setPathVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<string[]>(['This prototype is now driven by the OpenTutor Server over SSE.']);
  const [assessment, setAssessment] = useState<AssessmentResult>();
  const [toast, setToast] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    getPrototypeSession()
      .then((snapshot) => {
        if (disposed) return;
        setLesson(snapshot.lesson);
        setPath(snapshot.path);
        setPathVersion(snapshot.pathVersion);
        lastSeqRef.current = snapshot.lastSeq;
        unsubscribe = subscribeToLearningEvents(snapshot.lastSeq, handleEvent, setConnected);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));

    function handleEvent(event: LearningEvent) {
      if (event.seq <= lastSeqRef.current) return;
      lastSeqRef.current = event.seq;

      if (event.type === 'agent.started') {
        setBusy(true);
      } else if (event.type === 'agent.completed') {
        const data = event.data as AgentCompletedEventData;
        setBusy(false);
        setMessages((current) => [...current, data.message]);
      } else if (event.type === 'lesson.patch') {
        const data = event.data as LessonPatchEventData;
        setLesson((current) => {
          if (!current || current.id !== data.lessonId) return current;
          if (current.version !== data.baseVersion) {
            void refreshSnapshot();
            return current;
          }
          return { ...applyLessonPatches(current, data.patches), version: data.version };
        });
        flash('Lesson updated');
      } else if (event.type === 'lesson.updated') {
        const data = event.data as LessonUpdatedEventData;
        setLesson((current) => current && current.id === data.lessonId ? { ...current, ...data.changes } : current);
      } else if (event.type === 'path.patch') {
        const data = event.data as PathPatchEventData;
        setPathVersion((currentVersion) => {
          if (currentVersion !== data.baseVersion) {
            void refreshSnapshot();
            return currentVersion;
          }
          setPath((current) => applyPathPatches(current, data.patches));
          return data.version;
        });
        flash('Learning path updated');
      } else if (event.type === 'assessment.completed') {
        const data = event.data as AssessmentCompletedEventData;
        setAssessment(data.assessment);
      }
    }

    async function refreshSnapshot() {
      const snapshot = await getPrototypeSession();
      if (disposed) return;
      setLesson(snapshot.lesson);
      setPath(snapshot.path);
      setPathVersion(snapshot.pathVersion);
      lastSeqRef.current = Math.max(lastSeqRef.current, snapshot.lastSeq);
    }

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const current = useMemo(() => path.find((node) => node.status === 'current'), [path]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 1500);
  }

  async function runAction(action: TutorAction) {
    if (busy) return;
    try {
      await runTutorAction(action);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleQuiz(blockId: string, answer: string) {
    if (!lesson || busy) return;
    try {
      await submitQuizAnswer(lesson.id, blockId, answer);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (error) {
    return <div className="boot-state"><h1>OpenTutor Server unavailable</h1><p>{error}</p><code>Run: pnpm dev</code></div>;
  }

  if (!lesson) return <div className="boot-state">Loading Learning Room…</div>;

  const nextNode = path.find((node) => node.status === 'current' && node.knowledgeNodeId !== lesson.knowledgeNodeId)
    ?? path.find((node) => node.status === 'upcoming' && node.type === 'main');

  return (
    <div className="app">
      <header className="topbar">
        <div className="breadcrumbs"><span className="back">←</span><strong>Transformer</strong><span>/</span><span>{lesson.title}</span></div>
        <div className="top-actions"><span>SSE #{lastSeqRef.current} · Lesson v{lesson.version}</span><button className="ghost" onClick={() => setShowDebug((value) => !value)}>&lt;&gt; Debug</button></div>
      </header>

      <div className="room-grid">
        <LearningPathPanel path={path} />
        <LessonCanvas lesson={lesson} assessment={assessment} busy={busy} onQuizSubmit={handleQuiz} nextNodeTitle={nextNode?.title} />
        <TutorPanel busy={busy} connected={connected} messages={messages} onAction={runAction} />
      </div>

      {toast && <div className="toast">{toast}</div>}

      {showDebug && (
        <aside className="debug-panel">
          <strong>Server-driven state</strong>
          <pre>{JSON.stringify({ lessonVersion: lesson.version, pathVersion, lastSeq: lastSeqRef.current, currentNode: current?.knowledgeNodeId, connected, path }, null, 2)}</pre>
        </aside>
      )}
    </div>
  );
}
