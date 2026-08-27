import { useEffect, useRef, useState } from 'react';
import {
  addCourseSource,
  compileCourse,
  getCourse,
  getCourseMap,
  listCourseSources,
  listCourses,
  type CourseMapInfo,
  type CourseSourceItem,
  type CourseSummary,
} from '../runtime/api.ts';

function learningRoute(courseId: string) {
  return `/learn/${courseId === 'transformer' ? 'prototype' : `session-${courseId}`}`;
}

export function MaterialsPage({
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
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null);
  const [sources, setSources] = useState<CourseSourceItem[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const uploadTitleRef = useRef<HTMLInputElement>(null);

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
    if (!activeCourseId) return;
    let cancelled = false;
    Promise.all([
      getCourse(activeCourseId),
      listCourseSources(activeCourseId),
      getCourseMap(activeCourseId).catch(() => null),
    ])
      .then(([nextCourse, nextSources, nextMap]) => {
        if (cancelled) return;
        setCourse(nextCourse);
        setSources(nextSources);
        setCourseMap(nextMap);
        setSelectedSourceId((current) => current && nextSources.some((source) => source.documentId === current) ? current : nextSources[0]?.documentId);
      })
      .catch((error: Error) => {
        if (!cancelled) onFlash(`加载资料库失败：${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCourseId]);

  function focusUpload() {
    setShowUploadForm(true);
    requestAnimationFrame(() => uploadTitleRef.current?.focus());
  }

  async function handleAddSource(event: React.FormEvent) {
    event.preventDefault();
    if (!activeCourseId || !title.trim() || !content.trim()) return;
    try {
      setSaving(true);
      await addCourseSource(activeCourseId, title.trim(), content.trim());
      onFlash('资料已添加，等待知识编译。');
      setTitle('');
      setContent('');
      setShowUploadForm(false);
      const nextSources = await listCourseSources(activeCourseId);
      setSources(nextSources);
      setSelectedSourceId(nextSources.at(-1)?.documentId);
    } catch (error: any) {
      onFlash(`添加资料失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCompile() {
    if (!activeCourseId || !course) return;
    try {
      setCompiling(true);
      await compileCourse(activeCourseId, course.description || '掌握课程核心知识');
      onFlash('资料已编译，学习路径已更新。');
      onNavigate(`/courses/${activeCourseId}/path`);
    } catch (error: any) {
      onFlash(`编译失败：${error.message}`);
    } finally {
      setCompiling(false);
    }
  }

  if (!activeCourseId || !course) {
    return <div className="page-shell"><div className="empty-state-card"><h2>还没有可管理的课程资料</h2><button className="btn-primary" onClick={() => onNavigate('/courses/new')}>创建课程</button></div></div>;
  }

  const selectedSource = sources.find((source) => source.documentId === selectedSourceId) || sources[0];
  const visibleSources = showAll ? sources : sources.slice(0, 3);
  const compileLabel = course.compileStatus === 'ready' ? '已完成' : course.compileStatus === 'compiling' ? '编译中' : course.compileStatus === 'failed' ? '需要处理' : '待编译';

  return (
    <main className="page-shell materials-page">
      <header className="materials-header">
        <div>
          <h1>资料库</h1>
          <p>上传学习资料，编译后同步到课程知识图谱。</p>
        </div>
        <label className="course-picker">
          <span>当前课程</span>
          <select value={activeCourseId} onChange={(event) => setActiveCourseId(event.target.value)} aria-label="选择资料所属课程">
            {courses.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select>
        </label>
      </header>

      <div className="materials-dashboard">
        <section className="materials-source-panel">
          <div className="panel-heading">
            <div><span className="page-eyebrow">资料来源</span><h2>{course.title}</h2></div>
            <button className="btn-primary btn-sm" onClick={focusUpload}>＋ 上传资料</button>
          </div>
          <button type="button" className="material-drop-zone" onClick={focusUpload}>将 Markdown / 文本资料粘贴到下方表单</button>
          <div className="source-list">
            {visibleSources.length ? visibleSources.map((source) => (
              <button type="button" className={`source-row ${selectedSource?.documentId === source.documentId ? 'selected' : ''}`} key={source.documentId} onClick={() => setSelectedSourceId(source.documentId)}>
                <span className="source-file-icon">{source.title.toLowerCase().endsWith('.pdf') ? 'PDF' : 'MD'}</span>
                <span><strong>{source.title}</strong><small>{source.version} · {source.status}</small></span>
                <span className="source-state">{source.status === 'active' ? '已接入' : source.status}</span>
              </button>
            )) : <p className="hint-text">还没有上传资料。</p>}
          </div>
          {sources.length > 3 && <button className="text-action" onClick={() => setShowAll((current) => !current)}>{showAll ? '收起资料' : `查看全部资料 (${sources.length})`} →</button>}
        </section>

        <section className="compiler-panel">
          <div className="panel-heading"><div><span className="page-eyebrow">知识编译</span><h2>从资料到课程知识</h2></div><span className={`compile-state ${course.compileStatus}`}>{compileLabel}</span></div>
          <div className="compiler-stages">
            {['文档解析', 'Claim / Evidence', '知识图谱', '课程路径'].map((stage, index) => <div className="compiler-stage" key={stage}><span>{index + 1}</span><strong>{stage}</strong><small>{course.compileStatus === 'ready' ? '完成' : index === 0 && sources.length ? '准备就绪' : '等待资料'}</small></div>)}
          </div>
          <button className="btn-primary btn-wide" disabled={compiling || !sources.length} onClick={handleCompile}>{compiling ? '正在编译…' : '开始编译'}</button>
          <small className="panel-note">编译会调用课程知识、资料证据和学习路径接口。</small>
        </section>

        <section className="source-preview-panel">
          <div className="panel-heading"><div><span className="page-eyebrow">知识预览</span><h2>{selectedSource?.title || '等待资料'}</h2></div><span className="preview-icon">◇</span></div>
          {selectedSource ? <><p className="source-excerpt">{selectedSource.content.slice(0, 260)}{selectedSource.content.length > 260 ? '…' : ''}</p><div className="preview-meta"><span>版本 v{selectedSource.version}</span><span>{selectedSource.status}</span></div></> : <p className="hint-text">选择一份资料查看原文预览。</p>}
          <button className="text-action" disabled={!selectedSource} onClick={focusUpload}>继续添加资料 →</button>
        </section>
      </div>

      <section className="materials-lower-grid">
        <div className="materials-graph-card">
          <div className="panel-heading"><div><span className="page-eyebrow">课程内图谱</span><h2>资料影响的知识节点</h2></div><button className="text-action" onClick={() => onNavigate(`/knowledge?courseId=${activeCourseId}`)}>查看图谱 →</button></div>
          <div className="materials-mini-graph"><div className="mini-graph-core">{course.title}</div>{(courseMap?.nodes || []).slice(0, 5).map((node, index) => <span className={`mini-node mini-node-${index}`} key={node.knowledgeNodeId}>{node.title}</span>)}</div>
        </div>
        <section className="materials-recent-panel">
          <div className="panel-heading"><div><h2>最近资料</h2><p>已接入课程的来源与编译状态</p></div></div>
          <div className="recent-source-list">{visibleSources.length ? visibleSources.map((source) => <button type="button" className="recent-source-row" key={source.documentId} onClick={() => setSelectedSourceId(source.documentId)}><span>{source.title.toLowerCase().endsWith('.pdf') ? 'PDF' : 'MD'}</span><strong>{source.title}</strong><small>{source.status === 'active' ? '已接入' : source.status}</small></button>) : <p className="hint-text">还没有最近资料。上传一份资料后，它会出现在这里。</p>}</div>
          <button className="btn-primary btn-wide" disabled={!sources.length || compiling} onClick={handleCompile}>{compiling ? '正在生成…' : '生成课程大纲'}</button>
        </section>
        <form className={`materials-form ${showUploadForm ? 'open' : ''}`} onSubmit={handleAddSource}>
          <div className="panel-heading"><div><span className="page-eyebrow">添加资料</span><h2>补充课程来源</h2></div></div>
          <label className="form-field"><span>标题 / 文件名</span><input ref={uploadTitleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Attention Is All You Need.md" required /></label>
          <label className="form-field"><span>内容</span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="粘贴 Markdown 或文本内容…" rows={5} required /></label>
          <div className="materials-form-actions"><button className="btn-secondary" type="button" onClick={() => setShowUploadForm(false)}>取消</button><button className="btn-primary" type="submit" disabled={saving}>{saving ? '保存中…' : '添加资料'}</button></div>
        </form>
      </section>
      <button className="btn-primary materials-learning-link" onClick={() => onNavigate(learningRoute(activeCourseId))}>进入学习空间 →</button>
    </main>
  );
}
