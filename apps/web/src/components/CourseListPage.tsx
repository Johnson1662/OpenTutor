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
        <div><h1>我的学习</h1></div>
        <button type="button" className="btn-primary" onClick={() => onNavigate('/courses/new')}>创建学习目标 <span aria-hidden="true">→</span></button>
      </header>

      {loading ? <div className="loading-block">正在读取你的学习路径…</div> : journeys.length ? (
        <section className="journey-list" aria-label="学习路径列表">
          {journeys.map((journey) => {
            const path = journey.session?.path ?? [];
            const courseCompleted = Boolean(journey.session && path.length > 0 && path.every((node) => node.status === 'completed'));
            const completed = path.filter((node) => node.status === 'completed').length;
            const current = path.find((node) => node.status === 'current');
            const progress = path.length ? Math.round((completed / path.length) * 100) : 0;
            const continueRoute = journey.session ? '/learn/' + journey.session.sessionId : '/courses/' + journey.id;
            const statusText = courseCompleted
              ? '学习完成'
              : current
                ? '当前 · ' + current.title
                : journey.compileStatus === 'compiling'
                  ? '正在生成学习路径'
                  : statusLabel(journey.compileStatus);
            return (
              <div className="journey-row" key={journey.id}>
                <button type="button" className="journey-row-main" onClick={() => onNavigate('/courses/' + journey.id)}>
                  <span className="journey-row-copy">
                    <strong>{journey.title}</strong>
                    <small>{courseCompleted ? '学习完成 · 100%' : statusText + (path.length ? ' · ' + completed + ' / ' + path.length : '')}</small>
                  </span>
                  <span className="journey-row-progress">
                    <span className="progress-line"><i style={{ width: progress + '%' }} /></span>
                    <small>{progress}%</small>
                  </span>
                </button>
                {courseCompleted ? (
                  <button type="button" className="btn-secondary" onClick={() => onNavigate('/courses/' + journey.id)}>查看路径 →</button>
                ) : (
                  <button type="button" className="btn-primary" disabled={journey.compileStatus === 'compiling'} onClick={() => onNavigate(continueRoute)}>{journey.session ? '继续学习' : '进入课程'} →</button>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <div className="empty-state-card journeys-empty"><h2>还没有学习路径</h2><p>告诉 OpenTutor 你想学会什么，它会先生成一条可执行的路线。</p><button type="button" className="btn-primary" onClick={() => onNavigate('/courses/new')}>创建第一个目标 <span aria-hidden="true">→</span></button></div>
      )}
    </main>
  );
}
