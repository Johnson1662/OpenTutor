import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { LearningSessionSnapshot } from '@opentutor/protocol';
import {
  addCourseSource,
  compileCourse,
  getCourse,
  getCourseEvidence,
  getCourseMap,
  getCourseSession,
  listCourseSources,
  type CourseEvidenceItem,
  type CourseMapInfo,
  type CourseSourceItem,
  type CourseSummary,
} from '../runtime/api.ts';

type CourseTab = 'route' | 'knowledge' | 'materials';
const allowedFile = /\.(txt|md|markdown)$/i;

function statusText(status: LearningSessionSnapshot['path'][number]['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'current') return '当前';
  if (status === 'skipped') return '已跳过';
  return '待学习';
}

export function CourseSpacePage({
  courseId,
  initialTab = 'route',
  onNavigate,
  onFlash,
}: {
  courseId: string;
  initialTab?: CourseTab;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [session, setSession] = useState<LearningSessionSnapshot | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null);
  const [evidence, setEvidence] = useState<CourseEvidenceItem[]>([]);
  const [sources, setSources] = useState<CourseSourceItem[]>([]);
  const [tab, setTab] = useState<CourseTab>(initialTab);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [addingSource, setAddingSource] = useState(false);

  useEffect(() => setTab(initialTab), [initialTab]);

  async function loadCourse() {
    const nextCourse = await getCourse(courseId);
    const [nextMap, nextEvidence, nextSources, nextSession] = await Promise.all([
      getCourseMap(courseId).catch(() => null),
      getCourseEvidence(courseId).catch(() => []),
      listCourseSources(courseId).catch(() => []),
      nextCourse.compileStatus === 'ready' || nextCourse.compileStatus === 'active' ? getCourseSession(courseId).catch(() => null) : Promise.resolve(null),
    ]);
    setCourse(nextCourse);
    setCourseMap(nextMap);
    setEvidence(nextEvidence);
    setSources(nextSources);
    setSession(nextSession);
    const defaultNodeId = nextSession?.path.find((node) => node.status === 'current')?.knowledgeNodeId ?? nextMap?.nodes[0]?.knowledgeNodeId ?? null;
    setSelectedNodeId((current) => current && nextMap?.nodes.some((node) => node.knowledgeNodeId === current) ? current : defaultNodeId);
    setSelectedSourceId((current) => current && nextSources.some((source) => source.documentId === current) ? current : nextSources[0]?.documentId ?? null);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCourse()
      .catch((error: Error) => { if (!cancelled) onFlash('加载课程失败：' + error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [courseId]);

  function changeTab(nextTab: CourseTab) {
    setTab(nextTab);
    onNavigate('/courses/' + courseId + '?tab=' + nextTab);
  }

  async function readSourceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!allowedFile.test(file.name)) {
      onFlash('目前支持 .txt、.md、.markdown 文件。');
      event.target.value = '';
      return;
    }
    setSourceTitle(file.name);
    setSourceContent(await file.text());
  }

  async function recompile() {
    try {
      setCompiling(true);
      await compileCourse(courseId, course?.description || '掌握这门课程的核心知识，并能应用它。');
      onFlash('学习路径已生成。');
      await loadCourse();
    } catch (error: any) {
      onFlash('编译失败：' + (error.message || '请稍后重试'));
    } finally {
      setCompiling(false);
    }
  }

  async function addSource(event: FormEvent) {
    event.preventDefault();
    if (!sourceContent.trim()) {
      onFlash('先选择文件或粘贴资料内容。');
      return;
    }
    try {
      setAddingSource(true);
      await addCourseSource(courseId, sourceTitle.trim() || '课程资料.md', sourceContent.trim());
      const learningGoal = course?.description || '掌握这门课程的核心知识，并能应用它。';
      setCompiling(true);
      await compileCourse(courseId, learningGoal);
      setSourceTitle('');
      setSourceContent('');
      onFlash('资料已添加，课程路径已重新编译。');
      await loadCourse();
      changeTab('materials');
    } catch (error: any) {
      onFlash('资料处理失败：' + (error.message || '请稍后重试'));
    } finally {
      setAddingSource(false);
      setCompiling(false);
    }
  }


  if (loading) return <main className="page-shell"><div className="loading-block">正在读取课程路径…</div></main>;
  if (!course) return <main className="page-shell"><div className="empty-state-card"><h1>课程不存在</h1><button type="button" className="btn-primary" onClick={() => onNavigate('/courses')}>返回我的学习</button></div></main>;

  const path = session?.path ?? [];
  const currentNode = path.find((node) => node.status === 'current');
  const completedCount = path.filter((node) => node.status === 'completed').length;
  const progress = path.length ? Math.round(completedCount / path.length * 100) : 0;
  const selectedNode = courseMap?.nodes.find((node) => node.knowledgeNodeId === selectedNodeId);
  const selectedSource = sources.find((source) => source.documentId === selectedSourceId);
  const selectedNodeEvidence = evidence.filter((item) => item.knowledgeNodeId === selectedNode?.knowledgeNodeId);
  const selectedSourceEvidence = evidence.filter((item) => item.sourceTitle === selectedSource?.title);
  const pathNodeForSelection = path.find((node) => node.knowledgeNodeId === selectedNode?.knowledgeNodeId);
  const tabLabels: Array<[CourseTab, string]> = [['route', '学习路径'], ['knowledge', '知识'], ['materials', '资料']];

  return (
    <main className="page-shell course-page">
      <header className="course-page-header">
        <div><button type="button" className="back-link" onClick={() => onNavigate('/courses')}>← 我的学习</button><span className="eyebrow">Course journey</span><h1>{course.title}</h1><p>{course.description || '按路径一步一步建立知识结构。'}</p></div>
        <div className="course-header-actions"><button type="button" className="btn-secondary" onClick={() => changeTab('materials')}>添加资料</button><button type="button" className="btn-primary" disabled={!session || !currentNode} onClick={() => session && onNavigate('/learn/' + session.sessionId)}>{currentNode ? '继续学习' : '路径完成'} <span aria-hidden="true">→</span></button></div>
      </header>

      <nav className="course-tabs" aria-label="课程内容">
        {tabLabels.map(([value, label]) => <button type="button" key={value} className={tab === value ? 'active' : ''} onClick={() => changeTab(value)}>{label}{value === 'knowledge' ? ' ' + (courseMap?.nodes.length ?? 0) : value === 'materials' ? ' ' + sources.length : ''}</button>)}
      </nav>

      {tab === 'route' && (
        <section className="course-route-layout">
          <div className="route-column">
            <div className="route-summary"><div><span className="eyebrow">Authoritative path</span><h2>你的学习路线</h2></div><span className="route-progress-value">{progress}%</span><div className="progress-line"><i style={{ width: progress + '%' }} /></div><small>{completedCount} / {path.length || '—'} 个节点完成</small></div>
            {path.length ? <div className="path-list">{path.map((node, index) => <button type="button" key={node.id} className={'path-node ' + node.status + ' ' + (node.id === currentNode?.id ? 'selected' : '')} onClick={() => setSelectedNodeId(node.knowledgeNodeId)}><span className="path-node-index">{node.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span><span className="path-node-copy"><small>{node.type === 'detour' ? '补充路径' : node.type === 'prerequisite' ? '先修知识' : '主路径'} · {statusText(node.status)}</small><strong>{node.title}</strong>{node.note && <em>{node.note}</em>}</span><span className="path-node-arrow" aria-hidden="true">{node.status === 'current' ? '→' : '·'}</span></button>)}</div> : <div className="empty-state-card"><h3>路径还没有生成</h3><p>先添加资料或重新编译课程。</p><button type="button" className="btn-primary" onClick={recompile} disabled={compiling}>{compiling ? '编译中…' : '生成学习路径'}</button></div>}
          </div>
          <aside className="node-drawer route-drawer"><NodeDetail node={selectedNode} pathNode={pathNodeForSelection} evidence={selectedNodeEvidence} onOpenKnowledge={() => changeTab('knowledge')} /></aside>
        </section>
      )}

      {tab === 'knowledge' && (
        <section className="knowledge-layout course-child-layout">
          <div className="knowledge-canvas" aria-label="课程知识图谱">
            <div className="canvas-label"><span className="eyebrow">Course knowledge</span><strong>知识关系</strong><small>点击节点查看来源和前置关系</small></div>
            <svg viewBox="0 0 100 100" role="img" aria-label="课程知识关系图">
              {courseMap?.edges.map((edge) => { const from = graphPoint(courseMap.nodes, edge.fromNodeId); const to = graphPoint(courseMap.nodes, edge.toNodeId); return from && to ? <line key={edge.fromNodeId + '-' + edge.toNodeId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
            </svg>
            {courseMap?.nodes.map((node) => { const point = graphPoint(courseMap.nodes, node.knowledgeNodeId); return point ? <button type="button" key={node.knowledgeNodeId} className={'graph-node ' + (selectedNode?.knowledgeNodeId === node.knowledgeNodeId ? 'selected' : '')} style={{ left: point.x + '%', top: point.y + '%' }} onClick={() => setSelectedNodeId(node.knowledgeNodeId)}>{node.title}</button> : null; })}
            {!courseMap?.nodes.length && <div className="canvas-empty">编译后会出现课程知识节点。</div>}
          </div>
          <aside className="node-drawer"><NodeDetail node={selectedNode} pathNode={pathNodeForSelection} evidence={selectedNodeEvidence} /></aside>
        </section>
      )}

      {tab === 'materials' && (
        <section className="materials-layout course-child-layout">
          <div className="materials-main"><div className="child-heading"><div><span className="eyebrow">Course sources</span><h2>课程资料</h2><p>只展示已经加入这门课程的文本来源。</p></div><span className="source-count">{sources.length} 份</span></div><div className="source-list">{sources.length ? sources.map((source) => <button type="button" key={source.documentId} className={'source-row ' + (source.documentId === selectedSourceId ? 'selected' : '')} onClick={() => setSelectedSourceId(source.documentId)}><span className="source-type">{source.title.toLowerCase().endsWith('.md') || source.title.toLowerCase().endsWith('.markdown') ? 'MD' : 'TXT'}</span><span><strong>{source.title}</strong><small>v{source.version} · {source.status}</small></span><span aria-hidden="true">→</span></button>) : <div className="empty-inline">还没有资料。添加一份 .txt、.md 或 .markdown 文件。</div>}</div></div>
          <aside className="source-drawer"><SourceDetail source={selectedSource} evidence={selectedSourceEvidence} onOpenNode={(nodeId) => { setSelectedNodeId(nodeId); changeTab('knowledge'); }} /></aside>
          <form className="material-add-card" onSubmit={addSource}><div><span className="eyebrow">Add source</span><h2>补充学习资料</h2><p>加入后会自动重新编译课程路径。</p></div><label className="file-button">选择文本文件<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={readSourceFile} disabled={addingSource || compiling} /></label><input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="资料名称，例如：我的笔记.md" disabled={addingSource || compiling} /><textarea value={sourceContent} onChange={(event) => setSourceContent(event.target.value)} rows={6} placeholder="也可以直接粘贴文本或 Markdown…" disabled={addingSource || compiling} /><button type="submit" className="btn-primary" disabled={addingSource || compiling || !sourceContent.trim()}>{addingSource || compiling ? '正在编译…' : '添加并编译'}</button></form>
        </section>
      )}
    </main>
  );
}

function graphPoint(nodes: CourseMapInfo['nodes'], nodeId: string) {
  const node = nodes.find((item) => item.knowledgeNodeId === nodeId);
  if (!node) return null;
  const index = nodes.indexOf(node);
  const columns = Math.min(3, Math.max(1, nodes.length));
  return { x: 20 + (index % columns) * (60 / Math.max(1, columns - 1)), y: 25 + Math.floor(index / columns) * 25 };
}

function NodeDetail({
  node,
  pathNode,
  evidence,
  onOpenKnowledge,
}: {
  node?: CourseMapInfo['nodes'][number];
  pathNode?: LearningSessionSnapshot['path'][number];
  evidence: CourseEvidenceItem[];
  onOpenKnowledge?: () => void;
}) {
  if (!node) return <div className="drawer-empty"><span className="eyebrow">Node detail</span><h2>选择一个节点</h2><p>从左侧路径或图谱选择节点。</p></div>;
  return <div className="drawer-content"><span className="eyebrow">节点详情</span><h2>{node.title}</h2><p>{node.description || '这是一项课程知识节点。'}</p><dl><dt>路径状态</dt><dd>{pathNode ? statusText(pathNode.status) : '知识节点'}</dd><dt>课程位置</dt><dd>第 {node.position} 步</dd><dt>来源证据</dt><dd>{evidence.length} 条</dd></dl>{evidence.length > 0 && <div className="evidence-snippets"><h3>来源片段</h3>{evidence.slice(0, 3).map((item) => <p key={item.evidenceId}>{item.excerpt || item.statement}<small>{item.sourceTitle}</small></p>)}</div>}{onOpenKnowledge && <button type="button" className="text-action" onClick={onOpenKnowledge}>查看相关知识 →</button>}</div>;
}

function SourceDetail({
  source,
  evidence,
  onOpenNode,
}: {
  source?: CourseSourceItem;
  evidence: CourseEvidenceItem[];
  onOpenNode: (nodeId: string) => void;
}) {
  if (!source) return <div className="drawer-empty"><span className="eyebrow">Source detail</span><h2>选择一份资料</h2><p>资料原文和关联片段会显示在这里。</p></div>;
  return <div className="drawer-content"><span className="eyebrow">来源详情</span><h2>{source.title}</h2><p className="source-full-preview">{source.content.slice(0, 720)}{source.content.length > 720 ? '…' : ''}</p><small className="source-meta">版本 v{source.version} · {source.status}</small>{evidence.length > 0 && <div className="evidence-snippets"><h3>关联知识片段</h3>{evidence.slice(0, 4).map((item) => <button type="button" className="snippet-button" key={item.evidenceId} onClick={() => onOpenNode(item.knowledgeNodeId)}><strong>{item.statement}</strong><span>{item.excerpt}</span></button>)}</div>}</div>;
}
