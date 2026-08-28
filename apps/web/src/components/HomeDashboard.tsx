import { useEffect, useState, type FormEvent } from 'react';
import { getExistingCourseSession, listCourses, type CourseSummary } from '../runtime/api.ts';
import type { LearningSessionSnapshot } from '@opentutor/protocol';

export function HomeDashboard({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [goal, setGoal] = useState('');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [sessions, setSessions] = useState<Record<string, LearningSessionSnapshot>>({});

  useEffect(() => {
    let cancelled = false;
    listCourses().then(async (items) => {
      const pairs = await Promise.all(items.slice(0, 3).map(async (course) => {
        if (course.compileStatus !== 'ready' && course.compileStatus !== 'active') return [course.id, null] as const;
        try {
          return [course.id, await getExistingCourseSession(course.id)] as const;
        } catch {
          return [course.id, null] as const;
        }
      }));
      if (cancelled) return;
      const nextSessions: Record<string, LearningSessionSnapshot> = {};
      for (const [courseId, session] of pairs) {
        if (session) nextSessions[courseId] = session;
      }
      setCourses(items);
      setSessions(nextSessions);
    }).catch(() => {
      if (!cancelled) setCourses([]);
    });
    return () => { cancelled = true; };
  }, []);

  function startGoal(event: FormEvent) {
    event.preventDefault();
    const value = goal.trim();
    if (value) onNavigate('/courses/new?goal=' + encodeURIComponent(value));
  }

  return (
    <main className="page-shell home-page">
      <section className="home-intro">
        <h1>你现在想学会什么？</h1>
        <p>说出目标，OpenTutor 会把它整理成一条可以真正走完的学习路径。</p>
        <form className="goal-form" onSubmit={startGoal}>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={4}
            placeholder="例如：我想理解 Transformer，从自注意力开始，并能写出一个小例子。"
            aria-label="学习目标"
          />
          <div className="goal-form-footer">
            <span>一句话就够了，之后可以再补资料。</span>
            <button className="btn-primary" type="submit" disabled={!goal.trim()}>开始规划 <span aria-hidden="true">→</span></button>
          </div>
        </form>
      </section>

      <section className="home-section home-recent">
        <div className="section-heading">
          <div><h2>继续学习</h2></div>
          <button type="button" className="text-action" onClick={() => onNavigate('/courses')}>查看全部 →</button>
        </div>
        <div className="home-course-list">
          {courses.slice(0, 3).map((course) => {
            const session = sessions[course.id];
            const courseCompleted = Boolean(session && session.path.length > 0 && session.path.every((node) => node.status === 'completed'));
            const completed = session?.path.filter((node) => node.status === 'completed').length ?? 0;
            const total = session?.path.length ?? 0;
            const current = session?.path.find((node) => node.status === 'current');
            const status = session
              ? courseCompleted
                ? '学习完成'
                : current?.title || '继续学习'
              : course.compileStatus === 'compiling'
                ? '正在生成学习路径'
                : course.compileStatus === 'failed'
                  ? '生成失败，请查看课程'
                  : '尚未开始';
            const route = session ? (courseCompleted ? '/courses/' + course.id : '/learn/' + session.sessionId) : '/courses/' + course.id;
            return (
              <button type="button" className="home-course-row" key={course.id} onClick={() => onNavigate(route)}>
                <span className="course-row-mark">{course.title.slice(0, 1)}</span>
                <span>
                  <strong>{course.title}</strong>
                  <small>{status}{session && total ? ` · ${completed}/${total} 个节点` : ''}</small>
                </span>
                <span className="row-arrow" aria-hidden="true">→</span>
              </button>
            );
          })}
          {!courses.length && <p className="hint-text">你的下一条学习路径会出现在这里。</p>}
        </div>
      </section>
    </main>
  );
}
