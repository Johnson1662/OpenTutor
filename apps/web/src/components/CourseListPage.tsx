import { useEffect, useState } from 'react';
import { getExistingCourseSession, listCourses, type CourseSummary } from '../runtime/api.ts';
import type { LearningSessionSnapshot } from '@opentutor/protocol';

interface LearningJourney extends CourseSummary {
  session?: LearningSessionSnapshot;
}

function statusLabel(status: CourseSummary['compileStatus']) {
  if (status === 'active') return '学习中';
  if (status === 'ready') return '已准备';
  if (status === 'compiling') return '准备中';
  if (status === 'failed') return '需要处理';
  return '未完成';
}

export function CourseListPage({
  onNavigate,
  onFlash,
  searchParams: _searchParams,
}: {
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
  searchParams?: URLSearchParams;
}) {
  const [journeys, setJourneys] = useState<LearningJourney[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then(async (courses) => {
        const rows = await Promise.all(courses.map(async (course) => {
          if (course.compileStatus !== 'ready' && course.compileStatus !== 'active') return course;
          try {
            const session = await getExistingCourseSession(course.id);
            return session ? { ...course, session } : course;
          } catch {
            return course;
          }
        }));
        if (!cancelled) setJourneys(rows);
      })
      .catch((error: Error) => {
        if (!cancelled) onFlash('加载学习路径失败：' + error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [onFlash]);

  return (
    <main className="page-shell journeys-page">
      <header className="page-heading journeys-heading">
        <div><span className="eyebrow">My learning</span><h1>我的学习</h1><p>每一条路径都从你的目标开始，按当前状态继续。</p></div>
        <button type="button" className="btn-primary" onClick={() => onNavigate('/courses/new')}>创建学习目标 <span aria-hidden="true">→</span></button>
      </header>

      {loading ? <div className="loading-block">正在读取你的学习路径…</div> : journeys.length ? (
        <section className="journey-grid" aria-label="学习路径列表">
          {journeys.map((journey, index) => {
            const path = journey.session?.path ?? [];
            const completed = path.filter((node) => node.status === 'completed').length;
            const current = path.find((node) => node.status === 'current');
            const progress = path.length ? Math.round((completed / path.length) * 100) : 0;
            const continueRoute = journey.session ? '/learn/' + journey.session.sessionId : '/courses/' + journey.id;
            return (
              <article className="journey-card" key={journey.id}>
                <div className={'journey-card-accent accent-' + (index % 4)} />
                <div className="journey-card-body">
                  <div className="journey-card-top"><span className="status-pill">{statusLabel(journey.compileStatus)}</span><span className="journey-index">{String(index + 1).padStart(2, '0')}</span></div>
                  <h2>{journey.title}</h2>
                  <p>{journey.description || '从课程路径中逐步建立可用的知识结构。'}</p>
                  <div className="journey-progress"><div className="progress-line"><i style={{ width: progress + '%' }} /></div><span>{path.length ? completed + ' / ' + path.length + ' 个节点' : '路径待生成'}</span></div>
                  <div className="journey-current">{current ? <><small>当前节点</small><strong>{current.title}</strong></> : <small>{journey.compileStatus === 'compiling' ? '学习路径正在准备' : '打开查看课程路径'}</small>}</div>
                </div>
                <div className="journey-card-actions"><button type="button" className="text-action" onClick={() => onNavigate('/courses/' + journey.id)}>查看路径</button><button type="button" className="btn-primary" disabled={journey.compileStatus === 'compiling'} onClick={() => onNavigate(continueRoute)}>{journey.session ? '继续学习' : '进入课程'} <span aria-hidden="true">→</span></button></div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="empty-state-card journeys-empty"><span className="empty-kicker">从一个问题开始</span><h2>还没有学习路径</h2><p>告诉 OpenTutor 你想学会什么，它会先生成一条可执行的路线。</p><button type="button" className="btn-primary" onClick={() => onNavigate('/courses/new')}>创建第一个目标 <span aria-hidden="true">→</span></button></div>
      )}
    </main>
  );
}
