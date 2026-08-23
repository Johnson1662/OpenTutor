import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssessmentCompletedEventData,
  AssessmentResult,
  AgentCompletedEventData,
  LearningPathNode,
  Lesson,
  LessonActivatedEventData,
  LessonPatchEventData,
  LessonUpdatedEventData,
  PathPatchEventData,
  TutorAction,
} from '@opentutor/protocol';
import { applyLessonPatches, applyPathPatches } from '../runtime/patch.ts';
import {
  getSession,
  runTutorAction,
  sendTutorMessage,
  submitQuizAnswer,
  subscribeToLearningEvents,
} from '../runtime/api.ts';
import { LearningPathPanel } from './LearningPathPanel.tsx';
import { LessonCanvas } from './LessonCanvas.tsx';
import { TutorPanel } from './TutorPanel.tsx';

export function LearningRoom({
  sessionId = 'prototype',
  onNavigate,
  onFlash,
}: {
  sessionId?: string;
  onNavigate: (route: string) => void;
  onFlash: (msg: string) => void;
}) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [path, setPath] = useState<LearningPathNode[]>([]);
  const [pathVersion, setPathVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<string[]>([
    'Welcome to your AI-Native Learning Room. Ask questions or use Quick Actions to adapt the lesson in real time.',
  ]);
  const [assessment, setAssessment] = useState<AssessmentResult>();
  const [showDebug, setShowDebug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function bootstrap() {
      try {
        const snapshot = await getSession(sessionId);
        setLesson(snapshot.lesson);
        setPath(snapshot.path);
        setPathVersion(snapshot.pathVersion);
        lastSeqRef.current = snapshot.lastSeq;

        unsubscribe = subscribeToLearningEvents(
          sessionId,
          lastSeqRef.current,
          (event) => {
            lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);

            if (event.type === 'agent.started') {
              setBusy(true);
            }

            if (event.type === 'agent.completed') {
              const data = event.data as AgentCompletedEventData;
              setBusy(false);
              setMessages((prev) => [...prev, data.message]);
              onFlash('Tutor updated the learning session.');
            }

            if (event.type === 'lesson.patch') {
              const data = event.data as LessonPatchEventData;
              setLesson((prev) => (prev ? applyLessonPatches(prev, data.patches) : prev));
            }

            if (event.type === 'lesson.updated') {
              const data = event.data as LessonUpdatedEventData;
              setLesson((prev) => (prev ? { ...prev, ...data.changes, version: data.version } : prev));
            }

            if (event.type === 'lesson.activated') {
              const data = event.data as LessonActivatedEventData;
              setLesson(data.lesson);
            }

            if (event.type === 'path.patch') {
              const data = event.data as PathPatchEventData;
              setPath((prev) => applyPathPatches(prev, data.patches));
              setPathVersion(data.version);
            }

            if (event.type === 'assessment.completed') {
              const data = event.data as AssessmentCompletedEventData;
              setAssessment(data.assessment);
            }

            if (event.type === 'error') {
              setBusy(false);
              let errorMsg = 'Operation failed';
              if (event.data && typeof event.data === 'object' && 'error' in event.data) {
                const errValue = (event.data as Record<string, unknown>).error;
                if (typeof errValue === 'string') {
                  errorMsg = errValue;
                }
              }
              onFlash(`Agent error: ${errorMsg}`);
            }
          },
          (status) => setConnected(status)
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    bootstrap();
    return () => {
      unsubscribe?.();
    };
  }, [sessionId]);

  const current = useMemo(() => path.find((node) => node.status === 'current'), [path]);

  async function handleRunAction(action: TutorAction) {
    try {
      setBusy(true);
      await runTutorAction(action, sessionId);
    } catch (err) {
      setBusy(false);
      onFlash(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function handleSendMessage(message: string) {
    try {
      setBusy(true);
      setMessages((prev) => [...prev, `Learner: ${message}`]);
      await sendTutorMessage(message, sessionId);
    } catch (err) {
      setBusy(false);
      onFlash(err instanceof Error ? err.message : 'Message failed');
    }
  }

  async function handleQuiz(blockId: string, answer: string) {
    if (!lesson) return;
    try {
      setBusy(true);
      await submitQuizAnswer(lesson.id, blockId, answer, sessionId);
      onFlash('Answer submitted for assessment diagnosis.');
    } catch (err) {
      setBusy(false);
      onFlash(err instanceof Error ? err.message : 'Submission failed');
    }
  }

  if (error) {
    return (
      <div className="boot-state">
        <h1>Learning Session Unavailable</h1>
        <p>{error}</p>
        <button className="btn-primary" onClick={() => onNavigate('/courses')}>Return to Courses</button>
      </div>
    );
  }

  if (!lesson) {
    return <div className="boot-state">Loading Learning Room...</div>;
  }

  const nextNode =
    path.find((node) => node.status === 'current' && node.knowledgeNodeId !== lesson.knowledgeNodeId) ??
    path.find((node) => node.status === 'upcoming' && node.type === 'main');

  return (
    <div className="learning-room-shell">
      <div className="room-subnav">
        <button className="btn-secondary btn-sm" onClick={() => onNavigate('/courses')}>
          ← Back to Courses
        </button>
        <span className="room-session-badge">Session: {sessionId} · Focus: {current?.title ?? lesson.title}</span>
        <button className="btn-secondary btn-sm" onClick={() => setShowDebug((d) => !d)}>
          {showDebug ? 'Hide Debug' : 'Debug State'}
        </button>
      </div>

      <div className="learning-room-grid">
        <LearningPathPanel path={path} />

        <LessonCanvas
          lesson={lesson}
          assessment={assessment}
          busy={busy}
          onQuizSubmit={handleQuiz}
          nextNodeTitle={nextNode?.title}
        />

        <TutorPanel
          busy={busy}
          connected={connected}
          messages={messages}
          onAction={handleRunAction}
          onSendMessage={handleSendMessage}
        />
      </div>

      {showDebug && (
        <section className="debug-drawer">
          <h3>Debug Session Protocol Snapshot</h3>
          <pre>{JSON.stringify({ lesson, path, pathVersion, assessment }, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
