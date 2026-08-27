import { useEffect, useMemo, useState } from 'react';
import { listCourses, type CourseSummary } from '../runtime/api.ts';

const filters = ['全部', '人工智能', '编程开发', '数学基础', '数据科学'];

function courseRoute(courseId: string) {
  return `/learn/${courseId === 'transformer' ? 'prototype' : `session-${courseId}`}`;
}

function matchesFilter(course: CourseSummary, filter: string) {
  if (filter === '全部') return true;
  const text = `${course.title} ${course.description || ''}`.toLowerCase();
  const keywords: Record<string, string[]> = {
    人工智能: ['ai', '人工智能', 'transformer', '机器学习', '深度学习'],
    编程开发: ['编程', '代码', 'c++', 'python', '系统'],
    数学基础: ['数学', '线性', '概率', '矩阵'],
    数据科学: ['数据', '统计', '分析'],
  };
  return keywords[filter]?.some((keyword) => text.includes(keyword)) ?? false;
}

function statusLabel(status: CourseSummary['compileStatus']) {
  return status === 'ready' || status === 'active' ? '已准备' : status === 'compiling' ? '编译中' : status === 'failed' ? '需要处理' : '草稿';
}

export function CourseListPage({
  onNavigate,
  onFlash,
  searchParams,
}: {
  onNavigate: (route: string) => void;
  onFlash: (msg: string) => void;
  searchParams?: URLSearchParams;
}) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('全部');
  const [courseSearch, setCourseSearch] = useState(searchParams?.get('q') || '');

  useEffect(() => {
    listCourses()
      .then(setCourses)
      .catch((error: Error) => onFlash(`加载课程失败：${error.message}`))
      .finally(() => setLoading(false));
  }, []);

  const searchQuery = courseSearch.trim().toLowerCase();
  const filteredCourses = useMemo(() => courses.filter((course) => {
    const matchesSearch = !searchQuery || course.title.toLowerCase().includes(searchQuery) || (course.description?.toLowerCase().includes(searchQuery) ?? false);
    return matchesSearch && matchesFilter(course, filter);
  }), [courses, filter, searchQuery]);
  const recommendations = courses.slice(5, 7);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    onNavigate(courseSearch.trim() ? `/courses?q=${encodeURIComponent(courseSearch.trim())}` : '/courses');
  }

  return (
    <main className="page-shell courses-page">
      <header className="courses-header">
        <div><h1>{searchQuery ? `搜索结果："${searchQuery}"` : '课程'}</h1><p>按学科浏览，或从目标生成专属学习路径。</p></div>
        <button className="btn-primary" onClick={() => onNavigate('/courses/new')}>＋ 新建学习</button>
      </header>

      <div className="courses-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="课程分类">{filters.map((item) => <button type="button" role="tab" aria-selected={filter === item} className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
        <form className="course-search" onSubmit={submitSearch}><span aria-hidden="true">⌕</span><input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="搜索课程" aria-label="搜索课程" /></form>
      </div>

      <div className="courses-layout">
        <section className="course-grid reference-course-grid" aria-label="课程列表">
          {loading ? <div className="loading-spinner">正在加载课程…</div> : filteredCourses.length ? filteredCourses.slice(0, 6).map((course, index) => {
            const ready = course.compileStatus === 'ready' || course.compileStatus === 'active';
            const presentation = coursePresentation[index];
            return (
              <article className={`course-card reference-course-card ${index === 0 ? 'featured' : ''}`} key={course.id}>
                {index === 0 && <span className="featured-label">精选</span>}
                <div className={`course-visual visual-${index % 6}`} aria-hidden="true"><span>{index === 0 ? '⌘' : index === 1 ? '✧' : index === 2 ? '◌' : index === 3 ? '▣' : index === 4 ? 'C++' : '∑'}</span></div>
                <div className="course-card-body"><span className={`course-status ${course.compileStatus}`}>{statusLabel(course.compileStatus)}</span><h2><button type="button" className="course-card-link" onClick={() => onNavigate(`/courses/${course.id}/path`)}>{presentation?.title || course.title}</button></h2><p>{presentation?.description || course.description || '从课程资料中编译结构化知识与学习路径。'}</p><small className="course-meta">{course.compiledAt ? `最近编译 ${new Date(course.compiledAt).toLocaleDateString('zh-CN')}` : '等待课程编译'}</small></div>
                <div className="course-card-actions"><button className="btn-secondary" onClick={() => onNavigate(`/courses/${course.id}/path`)}>查看路径</button><button className="btn-primary" disabled={course.compileStatus === 'compiling'} onClick={() => onNavigate(ready ? courseRoute(course.id) : `/courses/${course.id}`)}>{course.compileStatus === 'compiling' ? '编译中…' : ready ? '继续学习' : '查看课程'}</button></div>
              </article>
            );
          }) : <div className="empty-state-card"><h2>{searchQuery || filter !== '全部' ? '没有匹配的课程' : '还没有课程'}</h2><p>创建一个课程，让 OpenTutor 根据目标生成学习路径。</p><button className="btn-primary" onClick={() => onNavigate('/courses/new')}>创建课程</button></div>}
        </section>

        <aside className="recommendations-panel">
          <div className="panel-heading"><div><span className="page-eyebrow">课程发现</span><h2>推荐学习</h2></div></div>
          {recommendations.length ? recommendations.map((course, index) => <article className="recommendation-item" key={course.id}><div className={`recommendation-thumb visual-${(index + 2) % 6}`} aria-hidden="true">{index ? '▥' : '✧'}</div><div><strong>{course.title}</strong><p>{course.description || '从课程资料开始建立知识基础。'}</p><small>{statusLabel(course.compileStatus)}</small></div><button className="text-action" onClick={() => onNavigate(courseRoute(course.id))}>开始学习</button></article>) : <p className="hint-text">创建或加载课程后，这里会展示可继续学习的内容。</p>}
          <button className="recommend-ai" onClick={() => onNavigate('/courses/new?goal=请根据我的兴趣推荐一门课程&title=AI 推荐学习路径')}>✦ 让 AI 推荐</button>
        </aside>
      </div>
    </main>
  );
}
const coursePresentation = [
  { title: 'Transformer 导论', description: '从注意力机制开始，建立现代语言模型的核心直觉。' },
  { title: '深度学习基础', description: '掌握神经网络、优化与表示学习的关键概念。' },
  { title: '机器学习入门', description: '用清晰的模型与案例理解机器学习工作流。' },
  { title: '计算机系统基础', description: '从程序运行到内存与缓存，建立系统视角。' },
  { title: 'C++ 核心语法', description: '通过实践掌握现代 C++ 的核心语法与抽象。' },
  { title: '线性代数基础', description: '为机器学习准备向量、矩阵与空间的数学基础。' },
];
