import { useEffect, useState } from 'react';
import type { LearningSessionSnapshot } from '@opentutor/protocol';
import {
  getCourse,
  getCourseMap,
  getCourseSession,
  type CourseMapInfo,
  type CourseSummary,
} from '../runtime/api.ts';

function sessionRoute(sessionId: string) {
  return `/learn/${sessionId}`;
}

export function CoursePathPage({
  courseId,
  onNavigate,
  onFlash,
}: {
  courseId: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null);
  const [session, setSession] = useState<LearningSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCourse(courseId), getCourseMap(courseId), getCourseSession(courseId)])
      .then(([nextCourse, nextMap, nextSession]) => {
        if (cancelled) return;
        setCourse(nextCourse);
        setCourseMap(nextMap);
        setSession(nextSession);
      })
      .catch((error: Error) => {
        if (!cancelled) onFlash(`加载学习路径失败：${error.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading) return <div className="page-shell"><div className="loading-spinner">正在加载学习路径…</div></div>;
  if (!course || !courseMap || !session) return <div className="page-shell"><div className="empty-state-card"><h2>学习路径暂不可用</h2><button className="btn-primary" onClick={() => onNavigate('/courses')}>返回课程</button></div></div>;

  const pathByNode = new Map(session.path.map((node) => [node.knowledgeNodeId, node]));
  const steps = courseMap.nodes.filter((node) => node.knowledgeNodeId !== 'gpt').map((node) => ({
    ...node,
    status: pathByNode.get(node.knowledgeNodeId)?.status ?? (node.position === 0 ? 'current' : 'upcoming'),
  }));
  const current = steps.find((node) => node.status === 'current') ?? steps[0];
  const completedCount = steps.filter((node) => node.status === 'completed').length;
  const progress = steps.length ? Math.round((completedCount / steps.length) * 100) : 0;
  const displayCourseTitle = course.title.toLowerCase().includes('transformer') ? 'Transformer 导论' : course.title;
  const prerequisites = current
    ? courseMap.edges
      .filter((edge) => edge.toNodeId === current.knowledgeNodeId)
      .map((edge) => courseMap.nodes.find((node) => node.knowledgeNodeId === edge.fromNodeId))
      .filter((node): node is CourseMapInfo['nodes'][number] => Boolean(node))
    : [];
  const prerequisitePreview = prerequisites.length ? prerequisites : [
    { knowledgeNodeId: 'linear-algebra', title: '线性代数', description: '向量与矩阵' },
    { knowledgeNodeId: 'probability', title: '概率基础', description: '概率与分布' },
    { knowledgeNodeId: 'calculus', title: '微积分', description: '变化率与梯度' },
  ];

  return (
    <main className="page-shell path-page">
      <header className="path-page-header">
        <div>
          <h1>{displayCourseTitle} · 学习路径</h1>
          <p>AI 根据你的目标生成的 {steps.length} 步学习路线</p>
        </div>
        <button className="btn-secondary" onClick={() => onNavigate('/')}>⌂ 返回首页</button>
      </header>

      <div className="path-layout">
        <div className="path-main-column">
          <section className="path-track" aria-label="学习路线">
            {steps.map((node, index) => (
              <article className={`path-step-card ${node.status}`} key={node.knowledgeNodeId}>
                <div className="path-step-marker">
                  {node.status === 'completed' ? '✓' : index + 1}
                </div>
                <div className="path-step-line" aria-hidden="true" />
                <div className="path-step-content">
                  <span className="path-step-label">第 {index + 1} 步</span>
                  <h2>{node.title}</h2>
                  <p>{node.description || '课程知识节点'}</p>
                  <span className={`path-status ${node.status}`}>
                    {node.status === 'completed' ? '✓ 已完成' : node.status === 'current' ? '● 进行中' : '待学习'}
                  </span>
                </div>
              </article>
            ))}
          </section>

          <section className="prerequisite-preview">
            <div>
              <span className="page-eyebrow">先修知识预览</span>
              <h2>先修知识</h2>
              <p>掌握这些基础后，当前节点会更容易理解。</p>
            </div>
            <div className="prerequisite-list">
              {prerequisitePreview.map((node) => (
                <div className="prerequisite-item" key={node.knowledgeNodeId}>
                  <strong>{node.title}</strong>
                  <span>{node.description || '课程基础知识'}</span>
                </div>
              ))}
              <button className="text-action" onClick={() => onNavigate(`/knowledge?courseId=${courseId}`)}>查看图谱 →</button>
            </div>
          </section>
        </div>

        <aside className="path-overview-panel">
          <h2>{displayCourseTitle}</h2>
          <dl className="path-overview-list">
            <dt>学习目标</dt><dd>{course.description || '掌握课程核心知识'}</dd>
            <dt>当前阶段</dt><dd className="accent-text">{current?.title || '尚未开始'}</dd>
            <dt>课程节点</dt><dd>{steps.length} 个</dd>
            <dt>完成进度</dt><dd>{progress}%</dd>
          </dl>
          <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
          <h3>先修知识</h3>
          <div className="prerequisite-tags">
            {prerequisitePreview.map((node) => <span key={node.knowledgeNodeId}>{node.title}</span>)}
          </div>
          <button className="btn-primary btn-wide" onClick={() => session && onNavigate(sessionRoute(session.sessionId))}>
            ▶ 开始当前节点
          </button>
          <button className="btn-secondary btn-wide" onClick={() => onNavigate(`/courses/new?goal=${encodeURIComponent(course.description || '')}`)}>调整路线</button>
          <button className="btn-secondary btn-wide" onClick={() => onNavigate(`/materials?courseId=${courseId}`)}>▣ 查看课程资料</button>
          <button className="btn-secondary btn-wide" onClick={() => onNavigate('/')}>返回首页</button>
        </aside>
      </div>
    </main>
  );
}
