import { useState, type ChangeEvent, type FormEvent } from 'react';
import { addCourseSource, compileCourse, createCourse } from '../runtime/api.ts';

const allowedFile = /\.(txt|md|markdown)$/i;
const modelSetupCodes = ['MODEL_SETUP_REQUIRED', 'MODEL_AUTH_REQUIRED', 'MODEL_NOT_FOUND'];

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
  const [background, setBackground] = useState('零基础');
  const [outcome, setOutcome] = useState('理解');
  const [language, setLanguage] = useState<'zh' | 'en'>(() => (localStorage.getItem('opentutor.learningLanguage') === 'en' ? 'en' : 'zh'));
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialContent, setMaterialContent] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [modelSetupError, setModelSetupError] = useState(false);

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
    const courseTitle = goal.replace(/^我想(学会|学习|理解|掌握)?/u, '').replace(/[。！？!?].*$/u, '').trim().slice(0, 28) || '新的学习目标';
    const enrichedGoal = language === 'en'
      ? `${goal} Learner background: ${background}; Expected outcome: ${outcome}.`
      : `${goal} 学习者背景：${background}；期望结果：${outcome}。`;
    try {
      setCompiling(true);
      setModelSetupError(false);
      const course = await createCourse(courseTitle, enrichedGoal, language);
      if (materialContent.trim()) {
        await addCourseSource(course.id, materialTitle.trim() || '学习资料.md', materialContent.trim());
      }
      await compileCourse(course.id, enrichedGoal);
      onFlash('学习路径已生成。');
      onNavigate('/courses/' + course.id + '?tab=route');
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
      if (code && modelSetupCodes.includes(code)) {
        setModelSetupError(true);
      } else {
        onFlash('生成失败：' + (error instanceof Error ? error.message : '请稍后重试'));
      }
      setCompiling(false);
    }
  }

  return (
    <main className="page-shell create-page">
      <header className="page-heading create-heading">
        <div><h1>创建学习目标</h1></div>
      </header>

      <form className="goal-builder" onSubmit={createAndCompile}>
          <label className="field-label" htmlFor="learning-goal">你想学什么？</label>
          <textarea
            id="learning-goal"
            value={learningGoal}
            onChange={(event) => setLearningGoal(event.target.value)}
            rows={5}
            placeholder="例如：我想理解 Transformer，从自注意力开始，并能写出一个小例子。"
            disabled={compiling}
            autoFocus
          />
          {modelSetupError && (
            <div className="model-setup-alert" role="alert">
              <span>需要先配置 AI 模型。</span>
              <button type="button" className="text-action" onClick={() => onNavigate('/settings')}>前往设置 →</button>
            </div>
          )}
        <div className="create-options">
          <fieldset>
            <legend>基础</legend>
            <div className="choice-list">
              {['零基础', '有一点', '熟悉'].map((item) => (
                <label key={item} className={background === item ? 'choice selected' : 'choice'}>
                  <input type="radio" name="background" value={item} checked={background === item} onChange={() => setBackground(item)} />
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>目标</legend>
            <div className="choice-list">
              {['理解', '应用', '实现'].map((item) => (
                <label key={item} className={outcome === item ? 'choice selected' : 'choice'}>
                  <input type="radio" name="outcome" value={item} checked={outcome === item} onChange={() => setOutcome(item)} />
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>课程语言</legend>
            <div className="choice-list">
              {([['zh', '中文'], ['en', 'English']] as const).map(([value, label]) => (
                <label key={value} className={language === value ? 'choice selected' : 'choice'}>
                  <input type="radio" name="language" value={value} checked={language === value} onChange={() => setLanguage(value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <details className="material-drop-card">
          <summary>添加资料（可选）</summary>
          <div className="material-content">
            <p>支持 .txt、.md、.markdown，也可以直接粘贴。</p>
            <label className="file-button">选择文件<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={readFile} disabled={compiling} /></label>
            <input value={materialTitle} onChange={(event) => setMaterialTitle(event.target.value)} placeholder="资料名称，例如：我的笔记.md" disabled={compiling} />
            <textarea value={materialContent} onChange={(event) => setMaterialContent(event.target.value)} rows={4} placeholder="或把资料粘贴到这里…" disabled={compiling} />
          </div>
        </details>

        <div className="builder-actions">
          <button type="submit" className="btn-primary btn-large" disabled={compiling || !learningGoal.trim()}>
            {compiling ? '正在生成路径…' : '开始'} <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </main>
  );
}
