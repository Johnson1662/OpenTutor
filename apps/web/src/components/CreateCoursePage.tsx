import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { addCourseSource, compileCourse, createCourse } from '../runtime/api.ts';

function deriveTitle(goal: string) {
  const clean = goal.replace(/^我想(学会|学习|理解|掌握)?/u, '').replace(/[。！？!?].*$/u, '').trim();
  return (clean || '新的学习目标').slice(0, 28);
}

const allowedFile = /\.(txt|md|markdown)$/i;

export function CreateCoursePage({
  onNavigate,
  onFlash,
  searchParams,
}: {
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
  searchParams?: URLSearchParams;
}) {
  const [learningGoal, setLearningGoal] = useState(() => searchParams?.get('goal') || '');
  const [title, setTitle] = useState(() => searchParams?.get('title') || '');
  const [background, setBackground] = useState('零基础');
  const [outcome, setOutcome] = useState('理解原理');
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialContent, setMaterialContent] = useState('');
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    if (!title && learningGoal) setTitle(deriveTitle(learningGoal));
  }, [learningGoal, title]);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!allowedFile.test(file.name)) {
      onFlash('目前支持 .txt、.md、.markdown 文件。');
      event.target.value = '';
      return;
    }
    setMaterialTitle(file.name);
    setMaterialContent(await file.text());
  }

  async function createAndCompile(event: FormEvent) {
    event.preventDefault();
    const goal = learningGoal.trim();
    if (!goal) {
      onFlash('先写下你想学会什么。');
      return;
    }
    const courseTitle = title.trim() || deriveTitle(goal);
    const enrichedGoal = goal + ' 学习者背景：' + background + '；期望结果：' + outcome + '。';
    try {
      setCompiling(true);
      const course = await createCourse(courseTitle, enrichedGoal);
      if (materialContent.trim()) {
        await addCourseSource(course.id, materialTitle.trim() || '学习资料.md', materialContent.trim());
      }
      await compileCourse(course.id, enrichedGoal);
      onFlash('学习路径已生成。');
      onNavigate('/courses/' + course.id + '?tab=route');
    } catch (error: any) {
      onFlash('生成失败：' + (error.message || '请稍后重试'));
      setCompiling(false);
    }
  }

  return (
    <main className="page-shell create-page">
      <header className="page-heading create-heading"><div><span className="eyebrow">Create a goal</span><h1>创建学习目标</h1><p>先说目标。标题、路径和每一步内容都会从这里开始。</p></div><button type="button" className="text-action" onClick={() => onNavigate('/')}>返回首页</button></header>
      <form className="goal-builder" onSubmit={createAndCompile}>
        <section className="builder-main">
          <label className="field-label" htmlFor="learning-goal">我想学会</label>
          <textarea id="learning-goal" value={learningGoal} onChange={(event) => { setLearningGoal(event.target.value); if (!title) setTitle(deriveTitle(event.target.value)); }} rows={6} placeholder="例如：我想理解 Transformer，从自注意力开始，并能写出一个小例子。" disabled={compiling} autoFocus />
          <label className="field-label" htmlFor="course-title">路径名称</label>
          <input id="course-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="会根据目标自动生成" disabled={compiling} />
          <div className="builder-actions"><button type="submit" className="btn-primary btn-large" disabled={compiling || !learningGoal.trim()}>{compiling ? '正在生成路径…' : '生成我的学习路径'} <span aria-hidden="true">→</span></button><span>生成后会进入课程路径，不会直接跳进播放器。</span></div>
        </section>

        <aside className="builder-side">
          <div className="builder-note"><span className="eyebrow">只需两件事</span><h2>让路径更贴合你</h2><p>这两个选择会作为规划条件，不会变成冗长问卷。</p></div>
          <fieldset><legend>你现在的基础</legend><div className="choice-list">{['零基础', '有一些基础', '已经做过实践'].map((item) => <label key={item} className={background === item ? 'choice selected' : 'choice'}><input type="radio" name="background" value={item} checked={background === item} onChange={() => setBackground(item)} />{item}</label>)}</div></fieldset>
          <fieldset><legend>你想得到什么</legend><div className="choice-list">{['理解原理', '完成一个项目', '准备考试或面试'].map((item) => <label key={item} className={outcome === item ? 'choice selected' : 'choice'}><input type="radio" name="outcome" value={item} checked={outcome === item} onChange={() => setOutcome(item)} />{item}</label>)}</div></fieldset>
        </aside>

        <section className="material-drop-card">
          <div><span className="eyebrow">可选</span><h2>带上你的资料</h2><p>支持 .txt、.md、.markdown，也可以直接粘贴。资料会成为课程的真实来源。</p></div>
          <label className="file-button">选择文件<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={readFile} disabled={compiling} /></label>
          <input value={materialTitle} onChange={(event) => setMaterialTitle(event.target.value)} placeholder="资料名称，例如：我的笔记.md" disabled={compiling} />
          <textarea value={materialContent} onChange={(event) => setMaterialContent(event.target.value)} rows={4} placeholder="或把资料粘贴到这里…" disabled={compiling} />
        </section>
      </form>
    </main>
  );
}
