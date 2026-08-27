import { useEffect, useState } from 'react';
import {
  getCourseEvidence,
  getCourseMap,
  listCourses,
  type CourseEvidenceItem,
  type CourseMapInfo,
  type CourseSummary,
} from '../runtime/api.ts';

const positions = [
  { left: '50%', top: '50%' },
  { left: '50%', top: '12%' },
  { left: '84%', top: '30%' },
  { left: '84%', top: '72%' },
  { left: '50%', top: '88%' },
  { left: '16%', top: '72%' },
  { left: '16%', top: '30%' },
];

function learningRoute(courseId: string) {
  return `/learn/${courseId === 'transformer' ? 'prototype' : `session-${courseId}`}`;
}

export function KnowledgeGraphPage({
  courseId,
  onNavigate,
  onFlash,
}: {
  courseId?: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [activeCourseId, setActiveCourseId] = useState(courseId);
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null);
  const [evidence, setEvidence] = useState<CourseEvidenceItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [nodeQuery, setNodeQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then((items) => {
        if (cancelled) return;
        setCourses(items);
        setActiveCourseId((current) => current || courseId || items[0]?.id);
      })
      .catch((error: Error) => {
        if (!cancelled) onFlash(`加载课程失败：${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  useEffect(() => {
    if (!activeCourseId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getCourseMap(activeCourseId),
      getCourseEvidence(activeCourseId).catch(() => []),
    ])
      .then(([map, nextEvidence]) => {
        if (cancelled) return;
        setCourseMap(map);
        setEvidence(nextEvidence);
        setSelectedNodeId(map.nodes[0]?.knowledgeNodeId);
      })
      .catch((error: Error) => {
        if (!cancelled) onFlash(`加载知识图谱失败：${error.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCourseId]);

  if (loading) return <div className="page-shell"><div className="loading-spinner">正在加载知识图谱…</div></div>;
  if (!activeCourseId || !courseMap) {
    return <div className="page-shell"><div className="empty-state-card"><h2>还没有可展示的课程图谱</h2><button className="btn-primary" onClick={() => onNavigate('/courses/new')}>创建课程</button></div></div>;
  }

  const nodes = courseMap.nodes.filter((node) => node.title.toLowerCase().includes(nodeQuery.trim().toLowerCase())).slice(0, positions.length - 1);
  const graphTitle = courseMap.title.toLowerCase().includes('transformer') ? 'Transformer' : courseMap.title;
  const selectedNode = nodes.find((node) => node.knowledgeNodeId === selectedNodeId) ?? nodes[0];
  const prerequisites = selectedNode
    ? courseMap.edges
      .filter((edge) => edge.toNodeId === selectedNode.knowledgeNodeId)
      .map((edge) => nodes.find((node) => node.knowledgeNodeId === edge.fromNodeId))
      .filter((node): node is CourseMapInfo['nodes'][number] => Boolean(node))
    : [];

  return (
    <main className="page-shell knowledge-page">
      <header className="knowledge-header">
        <div>
          <span className="page-eyebrow">知识网络</span>
          <h1>知识图谱</h1>
          <p>查看课程内部与跨课程的知识关联</p>
        </div>
        <label className="course-picker">
          <span>当前课程</span>
          <select value={activeCourseId} onChange={(event) => setActiveCourseId(event.target.value)} aria-label="选择当前课程">
            {courses.length ? courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>) : <option value={activeCourseId}>{courseMap.title}</option>}
          </select>
        </label>
      </header>

      <div className="graph-switcher" aria-label="图谱范围">
        <div><span className="active">课程图谱</span><span>跨课程图谱</span></div>
        <label className="graph-search"><span aria-hidden="true">⌕</span><input value={nodeQuery} onChange={(event) => setNodeQuery(event.target.value)} placeholder="搜索节点" /></label>
      </div>

      <div className="knowledge-layout">
        <section className="knowledge-graph-panel">
          <div className="knowledge-graph-canvas" aria-label={`${courseMap.title} 课程知识图谱`}>
            <svg viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
              {nodes.slice(0, 6).map((node, index) => {
                const position = positions[index + 1];
                return <line key={node.knowledgeNodeId} x1="50" y1="50" x2={Number.parseFloat(position.left)} y2={Number.parseFloat(position.top)} />;
              })}
            </svg>
            <div className="graph-core">{graphTitle}</div>
            {nodes.slice(0, 6).map((node, index) => {
              const position = positions[index + 1];
              return (
                <button
                  type="button"
                  className={`knowledge-node graph-node-${index} ${selectedNode?.knowledgeNodeId === node.knowledgeNodeId ? 'selected' : ''}`}
                  style={position}
                  key={node.knowledgeNodeId}
                  aria-pressed={selectedNode?.knowledgeNodeId === node.knowledgeNodeId}
                  onClick={() => setSelectedNodeId(node.knowledgeNodeId)}
                >
                  <span>{node.title}</span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="knowledge-detail-panel">
          <span className="page-eyebrow">节点详情</span>
          <h2>{selectedNode?.title || courseMap.title}</h2>
          <p>{selectedNode?.description || '暂无节点描述。'}</p>
          <dl>
            <dt>Evidence</dt><dd>{evidence.filter((item) => item.knowledgeNodeId === selectedNode?.knowledgeNodeId).length} 条</dd>
            <dt>课程位置</dt><dd>{selectedNode ? `第 ${selectedNode.position + 1} 步` : '—'}</dd>
          </dl>
          <h3>先修知识</h3>
          <div className="detail-tags">{prerequisites.length ? prerequisites.map((node) => <span key={node.knowledgeNodeId}>{node.title}</span>) : <span>无</span>}</div>
          <button className="btn-primary btn-wide" onClick={() => onNavigate(learningRoute(activeCourseId))}>进入学习空间</button>
          <button className="btn-secondary btn-wide" onClick={() => onNavigate(`/materials?courseId=${activeCourseId}`)}>查看课程资料</button>
        </aside>
      </div>
    </main>
  );
}
