import { useEffect, useState } from 'react';
import {
  getCourseMap,
  getCourseSession,
  listCourses,
  type CourseMapInfo,
  type CourseSummary,
} from '../runtime/api.ts';

const categories = [
  { icon: '◈', name: '人工智能', tone: 'violet' },
  { icon: '</>', name: '编程开发', tone: 'blue' },
  { icon: '∑', name: '数学基础', tone: 'orange' },
  { icon: '▥', name: '数据科学', tone: 'green' },
];

function courseRoute(courseId: string) {
  return `/learn/${courseId === 'transformer' ? 'prototype' : `session-${courseId}`}`;
}

export function HomeDashboard({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null);
  const [pathNodes, setPathNodes] = useState<Array<{ title: string; description?: string; status: string }>>([]);
  const [goal, setGoal] = useState('我想学 Transformer');
  const [category, setCategory] = useState('深度学习');

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then(async (items) => {
        if (cancelled) return;
        setCourses(items);
        const course = items.find((item) => item.id === 'transformer') || items.find((item) => item.compileStatus === 'ready' || item.compileStatus === 'active') || items[0];
        if (!course) return;
        const [map, session] = await Promise.all([
          getCourseMap(course.id).catch(() => null),
          getCourseSession(course.id).catch(() => null),
        ]);
        if (cancelled) return;
        setCourseMap(map);
        const mapNodes = map?.nodes || [];
        const nextPath = session?.path.length
          ? session.path.map((node) => ({
            title: node.title,
            description: mapNodes.find((item) => item.knowledgeNodeId === node.knowledgeNodeId)?.description,
            status: node.status,
          }))
          : mapNodes.map((node, index) => ({ title: node.title, description: node.description, status: index === 0 ? 'current' : 'upcoming' }));
        setPathNodes(nextPath.slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableLearningCourses = courses.filter((course) => course.compileStatus === 'ready' || course.compileStatus === 'active');
  const primaryCourse = availableLearningCourses.find((course) => course.id === 'transformer') || availableLearningCourses[0] || courses[0];
  const learningCourses = primaryCourse ? [primaryCourse] : [];
  const currentNode = pathNodes.find((node) => node.status === 'current') || pathNodes[0];
  const completedCount = pathNodes.filter((node) => node.status === 'completed').length;
  const progress = pathNodes.length ? Math.round((completedCount / pathNodes.length) * 100) : 0;

  function openCreateCourse(defaultGoal = goal) {
    const nextGoal = defaultGoal.trim() || '我想学习 Transformer，从自注意力开始';
    const title = `${category}：${nextGoal.slice(0, 20)}`;
    onNavigate(`/courses/new?goal=${encodeURIComponent(nextGoal)}&title=${encodeURIComponent(title)}`);
  }

  return (
    <main className="page-shell home-dashboard">
      <section className="home-hero">
        <div className="home-hero-main">
          <h1>你想学什么？</h1>
          <p>和 <strong>OpenTutor</strong> 对话，生成专属的个性化学习路径。</p>
          <div className="goal-composer">
            <textarea
              aria-label="告诉 OpenTutor 你想学习什么"
              rows={3}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="我想学 Transformer"
            />
            <div className="goal-composer-footer"><span className="composer-hint">按 Enter 生成学习路径</span>
              <button type="button" className="send-goal" aria-label="开始生成学习路径" onClick={() => openCreateCourse()}>➤</button>
            </div>
          </div>
          <div className="home-hero-actions">
            <button type="button" className="btn-primary" onClick={() => openCreateCourse()}>✦ 生成学习路径</button>
            <button type="button" className="btn-secondary" onClick={() => openCreateCourse('从零开始学习课程核心知识')}>♧ 从零开始</button>
            <button type="button" className="btn-secondary" onClick={() => onNavigate(primaryCourse ? `/materials?courseId=${primaryCourse.id}` : '/courses/new')}>☁ 上传资料学习</button>
          </div>
        </div>

        <aside className="path-preview">
          <div className="path-preview-heading"><span>✦</span><div><strong>学习路径预览</strong><small>{primaryCourse ? 'Transformer 导论' : '创建课程后生成'}</small></div></div>
          <div className="path-preview-list">
            {pathNodes.length ? pathNodes.map((node, index) => (
              <div className={`path-preview-node ${node.status}`} key={`${node.title}-${index}`}>
                <span className="path-node-number">{node.status === 'completed' ? '✓' : index + 1}</span>
                <div><strong>{node.title}</strong><small>{node.status === 'completed' ? '已完成' : node.status === 'current' ? '进行中' : '待解锁'}</small></div>
                <span className="path-node-state">{node.status === 'completed' || node.status === 'current' ? '●' : '♧'}</span>
              </div>
            )) : <p className="hint-text">输入学习目标，生成你的第一条学习路径。</p>}
          </div>
          {primaryCourse && <button type="button" className="path-preview-link" onClick={() => onNavigate(`/courses/${primaryCourse.id}/path`)}>查看完整学习路径 ↗</button>}
        </aside>
      </section>

      <section className="home-lower-grid home-content-grid">
        <section className="home-panel recent-preview">
          <div className="section-heading"><h2>继续学习</h2><button type="button" onClick={() => onNavigate('/courses')}>查看全部 →</button></div>
          {learningCourses.length ? <div className="recent-list">{learningCourses.map((course, index) => { const isPrimary = course.id === primaryCourse?.id; const width = isPrimary ? progress : 0; const status = course.compileStatus === 'active' ? '学习中' : course.compileStatus === 'ready' ? '已编译' : course.compileStatus; return <button type="button" className="recent-item" key={course.id} onClick={() => onNavigate(courseRoute(course.id))}><span className={`recent-icon tone-${index}`}>{index === 0 ? '✧' : '▦'}</span><span className="recent-copy"><strong>{course.title}</strong><small>继续学习 {isPrimary && currentNode ? `· ${currentNode.title}` : status}</small><span className="progress-track"><i style={{ width: `${width}%` }} /></span></span><span className="recent-percent">{isPrimary ? `${progress}%` : '—'}</span></button>; })}</div> : <p className="hint-text">还没有进行中的课程。</p>}
          {primaryCourse && <button type="button" className="recent-enter" onClick={() => onNavigate(courseRoute(primaryCourse.id))}>进入学习空间 <span>›</span></button>}
        </section>

        <section className="home-panel category-preview">
          <div className="section-heading"><h2>课程分类</h2><button type="button" onClick={() => onNavigate('/courses')}>查看全部 →</button></div>
          <div className="category-row">{categories.map((item) => <div className="category-card" key={item.name}><span className={`category-icon ${item.tone}`}>{item.icon}</span><span><strong>{item.name}</strong><small>探索课程</small></span></div>)}</div>
        </section>

        <section className="home-panel knowledge-preview">
          <div className="section-heading"><h2>跨课程知识图谱</h2><button type="button" onClick={() => onNavigate(primaryCourse ? `/knowledge?courseId=${primaryCourse.id}` : '/knowledge')}>查看图谱 →</button></div>
          <div className="home-graph-preview"><div className="home-graph-core">{primaryCourse?.title || 'OpenTutor'}</div>{(courseMap?.nodes || []).slice(0, 4).map((node, index) => <span className={`home-graph-node home-graph-${index}`} key={node.knowledgeNodeId}>{node.title}</span>)}</div>
        </section>
      </section>
    </main>
  );
}
