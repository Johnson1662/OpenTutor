import { useEffect, useState } from 'react';
import {
  getCourse,
  getCourseMap,
  getCourseEvidence,
  listCourseSources,
  addCourseSource,
  deleteCourseSource,
  compileCourse,
  type CourseSummary,
  type CourseMapInfo,
  type CourseEvidenceItem,
  type CourseSourceItem,
} from '../runtime/api.ts';

export function CourseSpacePage({
  courseId,
  initialTab = 'overview',
  onNavigate,
  onFlash,
}: {
  courseId: string;
  initialTab?: 'overview' | 'map' | 'materials';
  onNavigate: (route: string) => void;
  onFlash: (msg: string) => void;
}) {
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null);
  const [evidence, setEvidence] = useState<CourseEvidenceItem[]>([]);
  const [sources, setSources] = useState<CourseSourceItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'map' | 'materials'>(initialTab);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [evidenceFilter, setEvidenceFilter] = useState('');
  const [newMaterialTitle, setNewMaterialTitle] = useState('');
  const [newMaterialContent, setNewMaterialContent] = useState('');
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    loadCourseData();
  }, [courseId]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setSelectedNodeId(courseMap?.nodes[0]?.knowledgeNodeId ?? null);
  }, [courseMap]);

  async function loadCourseData() {
    try {
      setLoading(true);
      const [c, m, e, s] = await Promise.all([
        getCourse(courseId),
        getCourseMap(courseId).catch(() => null),
        getCourseEvidence(courseId).catch(() => []),
        listCourseSources(courseId).catch(() => []),
      ]);
      setCourse(c);
      setCourseMap(m);
      setEvidence(e);
      setSources(s);
    } catch (err: any) {
      onFlash(`Error loading course: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMaterial(e: React.FormEvent) {
    e.preventDefault();
    if (!newMaterialTitle.trim() || !newMaterialContent.trim()) return;
    try {
      await addCourseSource(courseId, newMaterialTitle.trim(), newMaterialContent.trim());
      onFlash('Added new material!');
      setNewMaterialTitle('');
      setNewMaterialContent('');
      await loadCourseData();
    } catch (err: any) {
      onFlash(`Failed to add material: ${err.message}`);
    }
  }

  async function handleDeleteMaterial(sourceId: string) {
    try {
      await deleteCourseSource(courseId, sourceId);
      onFlash('Removed material.');
      await loadCourseData();
    } catch (err: any) {
      onFlash(`Failed to delete material: ${err.message}`);
    }
  }

  async function handleRecompile() {
    try {
      setCompiling(true);
      await compileCourse(courseId, course?.description || 'Learn course concepts');
      onFlash('Course recompiled successfully!');
      await loadCourseData();
    } catch (err: any) {
      onFlash(`Recompilation failed: ${err.message}`);
    } finally {
      setCompiling(false);
    }
  }

  const selectedNode = courseMap?.nodes.find((node) => node.knowledgeNodeId === selectedNodeId);
  const prerequisites = courseMap?.edges
    .filter((edge) => edge.toNodeId === selectedNodeId)
    .map((edge) => courseMap.nodes.find((node) => node.knowledgeNodeId === edge.fromNodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node)) ?? [];
  const dependents = courseMap?.edges
    .filter((edge) => edge.fromNodeId === selectedNodeId)
    .map((edge) => courseMap.nodes.find((node) => node.knowledgeNodeId === edge.toNodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node)) ?? [];

  if (loading) {
    return <div className="page-shell"><div className="loading-spinner">Loading Course Space...</div></div>;
  }

  if (!course) {
    return <div className="page-shell"><h2>Course Not Found</h2></div>;
  }

  return (
    <main className="page-shell workbench-page">
      <div className="workbench-header">
        <div>
          <div className="workbench-kicker">知识编译工作台 <span>ⓘ</span></div>
          <h1>{course.title} · 知识工作台</h1>
          <p>将上传的资料转化为结构化知识：节点、Claims、Evidence、Artifact 与课程建议，持续进化你的知识图谱。</p>
        </div>
        <div className="workbench-actions">
          <button className="btn-secondary" onClick={handleRecompile} disabled={compiling}>⟳ {compiling ? '编译中…' : '重新编译'}</button>
          <button className="btn-secondary" onClick={() => setActiveTab('materials')}>＋ 上传资料</button>
          <button className="btn-primary" onClick={() => onNavigate(`/learn/${courseId === 'transformer' ? 'prototype' : `session-${courseId}`}`)}>进入学习空间 →</button>
        </div>
      </div>

      <div className="course-tabs">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          概览
        </button>
        <button
          className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          课程图谱 ({courseMap?.nodes.length ?? 0})
        </button>
        <button
          className={`tab-btn ${activeTab === 'materials' ? 'active' : ''}`}
          onClick={() => setActiveTab('materials')}
        >
          资料库 ({sources.length})
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="tab-content">
          <div className="workbench-top-grid">
            <section className="workbench-card ingest-card">
              <div className="workbench-card-heading"><h2><b>1</b> 文档摄入</h2><button type="button" onClick={() => setActiveTab('materials')}>＋ 上传资料</button></div>
              <button type="button" className="drop-zone" onClick={() => setActiveTab('materials')}>前往资料库添加课程材料</button>
              <div className="workbench-filters"><span className="active">全部 {sources.length}</span><span>处理中 0</span><span>已完成 {sources.length}</span><span>有警告 0</span></div>
              <div className="document-list">
                {sources.length === 0 ? <p className="hint-text">还没有资料，先上传一份课程材料。</p> : sources.slice(0, 3).map((source) => (
                  <div className="document-row" key={source.documentId}><span className="document-type">{source.title.toLowerCase().endsWith('.pdf') ? 'PDF' : 'M↓'}</span><div><strong>{source.title}</strong><small>{source.version} · {source.status}</small></div><span className="document-status">已完成</span></div>
                ))}
              </div>
            </section>

            <section className="workbench-card pipeline-card">
              <div className="workbench-card-heading"><h2><b>2</b> 编译流水线 <small>(LLM Wiki / Agentic RAG)</small></h2><span className="pipeline-state">{course.compileStatus === 'ready' ? '✓' : '…'}</span></div>
              <div className="pipeline-steps">
                {['文档解析', '实体抽取', 'Claim / Evidence 对齐', 'Artifact 生成', '课程建议'].map((step, index) => (
                  <div className={`pipeline-step ${course.compileStatus === 'ready' || index < 4 ? 'complete' : 'running'}`} key={step}><span className="pipeline-icon">{['⚙', '▣', '♧', '◇', '◌'][index]}</span><strong>{step}</strong><small>{course.compileStatus === 'ready' || index < 4 ? '完成' : '进行中'}</small></div>
                ))}
              </div>
              <div className="pipeline-progress"><span>整体进度</span><i><b style={{ width: course.compileStatus === 'ready' ? '100%' : '48%' }} /></i><strong>{course.compileStatus === 'ready' ? '100%' : '48%'}</strong><small>{course.compileStatus === 'ready' ? '已完成' : '预计剩余处理中'}</small></div>
              <div className="pipeline-note">ⓘ Agentic 模式已启用：自动路由检索 → 逻辑校验 → 冲突检测 → 知识整合。</div>
            </section>

            <section className="workbench-card node-preview-card">
              <div className="workbench-card-heading"><h2><b>3</b> 知识预览</h2><span className="ready-check">✓</span></div>
              <div className="node-summary"><small>节点信息</small><dl><dt>名称</dt><dd>{courseMap?.nodes[0]?.title || course.title}</dd><dt>节点数</dt><dd>{courseMap?.nodes.length ?? 0}</dd><dt>领域</dt><dd>课程知识 / 学习路径</dd><dt>来源</dt><dd>{sources[0]?.title || '尚未上传'}</dd></dl></div>
              <div className="node-list"><strong>关联概念</strong>{(courseMap?.nodes || []).slice(0, 5).map((node) => <span key={node.knowledgeNodeId}>{node.title}</span>)}</div>
            </section>
          </div>
          <div className="workbench-bottom-grid">
            <section className="workbench-card evidence-card">
              <div className="workbench-card-heading"><h2><b>4</b> 检索与证据</h2><button type="button" onClick={() => setActiveTab('materials')}>查看资料 →</button></div>
              <div className="evidence-search">
                ⌕ <input
                  aria-label="搜索 Claim、概念、证据或来源"
                  value={evidenceFilter}
                  onChange={(e) => setEvidenceFilter(e.target.value)}
                  placeholder="搜索 Claim、概念、证据或来源..."
                  style={{ border: 0, outline: 0, background: 'transparent', width: '100%', fontSize: '11px', color: 'inherit' }}
                />
              </div>
              <div className="evidence-table">
                <div className="evidence-head"><span>ID</span><span>知识节点</span><span>来源</span><span>Evidence 片段</span><span>置信度</span></div>
                {evidence
                  .filter((item) => {
                    const nodeTitle = courseMap?.nodes.find((node) => node.knowledgeNodeId === item.knowledgeNodeId)?.title || '';
                    const query = evidenceFilter.trim().toLowerCase();
                    return !query || [item.statement, nodeTitle, item.sourceTitle, item.excerpt].some((value) => value.toLowerCase().includes(query));
                  })
                  .slice(0, 8)
                  .map((item) => (
                    <div className="evidence-row" key={item.evidenceId}>
                      <span title={item.claimId}>{item.claimId}</span>
                      <strong>{courseMap?.nodes.find((node) => node.knowledgeNodeId === item.knowledgeNodeId)?.title || item.knowledgeNodeId}</strong>
                      <span>{item.sourceTitle}</span>
                      <span title={item.statement}>{item.excerpt}</span>
                      <em>{item.evidenceConfidence.toFixed(2)}</em>
                    </div>
                  ))}
                {evidence.length === 0 && <p className="hint-text">编译完成后，课程来源中的 Claim 与 Evidence 会显示在这里。</p>}
              </div>
            </section>
            <section className="workbench-card artifact-card">
              <div className="workbench-card-heading"><h2>Artifact 摘要</h2></div>
              <div className="artifact-grid">
                <div className="artifact-tile">
                  ▣ 概念结构<br /><small>结构化知识节点</small>
                </div>
                <div className="artifact-tile">
                  ◌ 知识图谱<br /><small>前置依赖与关系</small>
                </div>
                <div className="artifact-tile">
                  ▤ 代码示例<br /><small>PyTorch / Python 实现</small>
                </div>
                <div className="artifact-tile">
                  ▥ 互动测验<br /><small>自适应诊断检验</small>
                </div>
              </div>
            </section>
          </div>
          <section className="workbench-card graph-workbench-card"><div className="workbench-card-heading"><h2><b>5</b> 课程内图谱</h2><button type="button" onClick={() => setActiveTab('map')}>进入图谱视图 →</button></div><div className="workbench-graph"><div className="workbench-graph-center">{course.title}</div>{(courseMap?.nodes || []).slice(0, 5).map((node, index) => <span key={node.knowledgeNodeId} className={`workbench-graph-node graph-${index}`}>{node.title}</span>)}</div></section>
        </div>
      )}

      {activeTab === 'map' && (
        <div className="tab-content">
          <div className="map-view">
            <h2>课程知识图谱</h2>
            <div className="map-layout">
              <div className="map-nodes-grid">
                {(courseMap?.nodes || []).map((n) => (
                  <button
                    type="button"
                    key={n.knowledgeNodeId}
                    className={`map-node-card ${selectedNodeId === n.knowledgeNodeId ? 'selected' : ''}`}
                    aria-pressed={selectedNodeId === n.knowledgeNodeId}
                    onClick={() => setSelectedNodeId(n.knowledgeNodeId)}
                  >
                    <span className="map-node-step">第 {n.position + 1} 步</span>
                    <h4>{n.title}</h4>
                    <p>{n.description || 'Core concept'}</p>
                  </button>
                ))}
              </div>
              {selectedNode && (
                <aside className="map-node-details" aria-live="polite">
                  <span className="map-node-step">节点详情</span>
                  <h3>{selectedNode.title}</h3>
                  <p>{selectedNode.description || '暂无节点描述。'}</p>
                  <dl>
                    <dt>课程位置</dt><dd>第 {selectedNode.position + 1} 步</dd>
                    <dt>Evidence</dt><dd>{evidence.filter((item) => item.knowledgeNodeId === selectedNode.knowledgeNodeId).length} 条</dd>
                  </dl>
                  <strong>前置依赖</strong>
                  <p>{prerequisites.length ? prerequisites.map((node) => node.title).join('、') : '无'}</p>
                  <strong>后续节点</strong>
                  <p>{dependents.length ? dependents.map((node) => node.title).join('、') : '无'}</p>
                </aside>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'materials' && (
        <div className="tab-content">
          <div className="materials-view">
            <div className="materials-list">
              <h3>已上传资料</h3>
              {sources.length === 0 ? (
                <p className="hint-text">还没有上传资料。</p>
              ) : (
                sources.map((s) => (
                  <div key={s.documentId} className="source-item">
                    <div>
                      <strong>{s.title}</strong>
                      <span className="source-meta"> · v{s.version} ({s.status})</span>
                    </div>
                    <button className="btn-danger btn-sm" onClick={() => handleDeleteMaterial(s.documentId)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddMaterial} className="add-material-form">
              <h3>添加新资料</h3>
              <label className="form-field">
                <span>标题 / 文件名</span>
                <input
                  type="text"
                  placeholder="e.g. Multi-Head Attention.md"
                  value={newMaterialTitle}
                  onChange={(e) => setNewMaterialTitle(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                <span>内容</span>
                <textarea
                  rows={4}
                  placeholder="Paste markdown content..."
                  value={newMaterialContent}
                  onChange={(e) => setNewMaterialContent(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="btn-secondary">添加资料</button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
