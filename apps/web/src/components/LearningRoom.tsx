import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssessmentCompletedEventData,
  AssessmentResult,
  AgentCompletedEventData,
  LearningPathNode,
  Lesson,
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
import { LessonCanvas } from './LessonCanvas.tsx';
import { TutorPanel } from './TutorPanel.tsx';

export function LearningRoom({
  sessionId = 'prototype',
  onNavigate,
  onFlash,
  onConnectionChange,
}: {
  sessionId?: string;
  onNavigate: (route: string) => void;
  onFlash: (msg: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [path, setPath] = useState<LearningPathNode[]>([]);
  const [pathVersion, setPathVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<string[]>([
    '你好，我会根据你的学习进度解释概念、补充例子，并在需要时调整这节课。',
  ]);
  const [assessment, setAssessment] = useState<AssessmentResult>();
  const [error, setError] = useState<string | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    async function bootstrap() {
      try {
        const snapshot = await getSession(sessionId);
        if (disposed) return;
        setLesson(snapshot.lesson);
        setPath(snapshot.path);
        setPathVersion(snapshot.pathVersion);
        lastSeqRef.current = snapshot.lastSeq;

        const closeSubscription = subscribeToLearningEvents(
          sessionId,
          lastSeqRef.current,
          (event) => {
            if (event.seq <= lastSeqRef.current) return;
            lastSeqRef.current = event.seq;

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
              setLesson((prev) => (prev ? applyLessonPatches(prev, data.patches, data.version) : prev));
            }

            if (event.type === 'lesson.updated') {
              const data = event.data as LessonUpdatedEventData;
              setLesson((prev) => (prev ? { ...prev, ...data.changes, version: data.version } : prev));
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
              onFlash(`Agent error: ${(event.data as any)?.error || 'Operation failed'}`);
            }
          },
          (status) => {
            setConnected(status);
            onConnectionChange?.(status);
          }
        );
        if (disposed) closeSubscription();
        else unsubscribe = closeSubscription;
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      }
    }

    bootstrap();
    return () => {
      disposed = true;
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
      setBusy(false);
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
  const visiblePath = path.filter((node) => node.knowledgeNodeId !== 'gpt').slice(0, 4);
  const currentIndex = Math.max(visiblePath.findIndex((node) => node.status === 'current'), 0);

  return (
    <div className="learning-room-shell">
      <div className="room-subnav"><span>课程</span><i>/</i><span>{lesson.title}</span><i>/</i><strong>学习空间</strong></div>

      <div className="learning-room-grid">

        <LessonCanvas
          lesson={lesson}
          assessment={assessment}
          busy={busy}
          stepLabel={`${currentIndex + 1} / ${Math.max(visiblePath.length, 1)}`}
          onQuizSubmit={handleQuiz}
          onAdvance={() => {
            if (nextNode?.title) {
              handleSendMessage(`I'm ready to move on to the next concept: ${nextNode.title}`);
            } else {
              onNavigate('/courses');
            }
          }}
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

      <div className="room-action-bar">
        <button className="btn-primary" disabled={busy} onClick={() => {
          if (nextNode?.title) void handleSendMessage(`我准备继续学习下一个知识点：${nextNode.title}`);
          else onNavigate('/courses');
        }}>→ 继续下一个知识点</button>
        <button className="btn-secondary" disabled={busy} onClick={() => void handleRunAction('softmax_unknown')}>✦ 生成诊断题</button>
        <button className="btn-secondary" onClick={() => onNavigate(`/knowledge?courseId=${encodeURIComponent(lesson.courseId)}`)}>⌘ 查看图谱关联</button>
        <span className="room-autosave">✓ 学习进度自动保存</span>
      </div>
    </div>
  );
}
