import { useEffect, useState, type FormEvent } from 'react';
import { getCourseSession, listCourses, type CourseSummary } from '../runtime/api.ts';
import type { LearningSessionSnapshot } from '@opentutor/protocol';

const examples = [
  '我想从零理解 Transformer，并能解释自注意力。',
  '我想学会用 Python 分析一份真实数据。',
  '我想补好线性代数，为机器学习做准备。',
];

export function HomeDashboard({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [goal, setGoal] = useState('');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [sessions, setSessions] = useState<Record<string, LearningSessionSnapshot>>({});

  useEffect(() => {
    let cancelled = false;
    listCourses().then(async (items) => {
      const ready = items.filter((course) => course.compileStatus === 'ready' || course.compileStatus === 'active');
      const pairs = await Promise.all(ready.slice(0, 6).map(async (course) => {
        try {
          return [course.id, await getCourseSession(course.id)] as const;
        } catch {
          return null;
}
      }));
        if (cancelled) return;
        setCourses(items);
      setSessions(Object.fromEntries(pairs.filter((pair): pair is readonly [string, LearningSessionSnapshot] => Boolean(pair))));
    }).catch(() => {
        if (!cancelled) setCourses([]);
      });
    return () => { cancelled = true; };
  }, []);

  function startGoal(event?: FormEvent) {
    event?.preventDefault();
    const value = goal.trim();
    if (value) onNavigate('/courses/new?goal=' + encodeURIComponent(value));
  }

  const readyCourses = courses.filter((course) => course.compileStatus === 'ready' || course.compileStatus === 'active');
  const currentCourse = readyCourses[0];
  const currentSession = currentCourse ? sessions[currentCourse.id] : undefined;
  const completed = currentSession?.path.filter((node) => node.status === 'completed').length ?? 0;
  const total = currentSession?.path.length ?? 0;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const currentNode = currentSession?.path.find((node) => node.status === 'current');

  return (
    <main className="page-shell home-page">
      <section className="home-intro">
        <span className="eyebrow">OpenTutor / 学习入口</span>
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
        <div className="goal-examples" aria-label="学习目标示例">
          <span>试试：</span>
          {examples.map((example) => <button type="button" key={example} onClick={() => setGoal(example)}>{example}</button>)}
        </div>
      </section>

      <section className="home-section home-continue">
        <div className="section-heading"><div><span className="eyebrow">继续前进</span><h2>我的学习</h2></div><button type="button" className="text-action" onClick={() => onNavigate('/courses')}>查看全部 →</button></div>
        {currentCourse ? (
          <article className="continue-card">
            <div className="continue-mark" aria-hidden="true">{currentCourse.title.slice(0, 1)}</div>
            <div className="continue-copy"><span className="status-pill">{currentNode ? '正在学习' : '已准备'}</span><h3>{currentCourse.title}</h3><p>{currentNode?.title || currentCourse.description || '从课程路径开始学习。'}</p><div className="progress-line"><i style={{ width: progress + '%' }} /></div><small>{completed} / {total || '—'} 个节点完成</small></div>
            <button type="button" className="btn-primary" onClick={() => currentSession ? onNavigate('/learn/' + currentSession.sessionId) : onNavigate('/courses/' + currentCourse.id)}>继续学习 <span aria-hidden="true">→</span></button>
          </article>
        ) : (
          <div className="empty-state-card home-empty"><h3>还没有学习路径</h3><p>从上面的目标开始，或直接查看我的学习。</p><button type="button" className="btn-secondary" onClick={() => onNavigate('/courses')}>查看我的学习</button></div>
        )}
      </section>

      <section className="home-section home-recent">
        <div className="section-heading"><div><span className="eyebrow">最近创建</span><h2>学习路径</h2></div><button type="button" className="btn-secondary" onClick={() => onNavigate('/courses/new')}>新建目标</button></div>
        <div className="home-course-list">
          {courses.slice(0, 4).map((course) => {
            return <button type="button" className="home-course-row" key={course.id} onClick={() => onNavigate('/courses/' + course.id)}><span className="course-row-mark">{course.title.slice(0, 1)}</span><span><strong>{course.title}</strong><small>{course.description || (course.compileStatus === 'compiling' ? '正在准备学习路径' : '查看课程路径')}</small></span><span className="row-arrow" aria-hidden="true">→</span></button>;
          })}
          {!courses.length && <p className="hint-text">你的下一条学习路径会出现在这里。</p>}
        </div>
      </section>
    </main>
  );
}
