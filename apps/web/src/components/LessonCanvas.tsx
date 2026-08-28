import { useEffect, useState } from 'react';
import type { AssessmentResult, CodeBlock, DiagramBlock, Lesson, LessonBlock, QuizBlock, TextBlock } from '@opentutor/protocol';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

function MarkdownContent({ content }: { content: string }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown></div>;
}

function TextStep({ block }: { block: TextBlock }) {
  return <section className={'step-text variant-' + block.variant}><span className="step-type">{block.variant === 'definition' ? '定义' : block.variant === 'example' ? '例子' : block.variant === 'summary' ? '小结' : block.variant === 'callout' ? '提示' : '说明'}</span><MarkdownContent content={block.content} /></section>;
}

function CodeStep({ block }: { block: CodeBlock }) {
  return <section className="step-code"><div className="code-topline"><span>{block.language || 'code'}</span><span>示例</span></div><pre><code>{block.code}</code></pre>{block.explanation && <MarkdownContent content={block.explanation} />}</section>;
}

function DiagramStep({ block }: { block: DiagramBlock }) {
  const nodeCount = Math.max(block.nodes.length, 1);
  return <section className="step-diagram"><div className="diagram-canvas" aria-label="课程关系图"><svg viewBox="0 0 100 44" role="img" aria-label={block.diagramType}><g>{block.edges.map((edge, index) => { const from = block.nodes.findIndex((node) => node.id === edge.from); const to = block.nodes.findIndex((node) => node.id === edge.to); if (from < 0 || to < 0) return null; return <line key={edge.from + edge.to + index} x1={8 + from * (84 / nodeCount)} y1="22" x2={8 + to * (84 / nodeCount)} y2="22" />; })}</g></svg>{block.nodes.map((node, index) => <span key={node.id} className="diagram-node" style={{ left: 8 + index * (84 / nodeCount) + '%' }}>{node.label}</span>)}</div>{block.edges.length > 0 && <div className="diagram-legend">{block.edges.map((edge, index) => <span key={edge.from + edge.to + index}>{edge.from} → {edge.to}{edge.label ? ' · ' + edge.label : ''}</span>)}</div>}</section>;
}

function QuizStep({
  block,
  assessment,
  busy,
  submitted,
  onSubmit,
}: {
  block: QuizBlock;
  assessment?: AssessmentResult;
  busy: boolean;
  submitted: boolean;
  onSubmit: (blockId: string, answer: string) => void;
}) {
  const [answer, setAnswer] = useState('');
  useEffect(() => setAnswer(''), [block.id]);
  const multiple = (block.answerSpec?.type ?? block.answerType) === 'multiple_choice';
  const chosen = answer ? answer.split(',') : [];
  function choose(optionId: string) {
    if (!multiple) return setAnswer(optionId);
    setAnswer(chosen.includes(optionId) ? chosen.filter((item) => item !== optionId).join(',') : chosen.concat(optionId).join(','));
  }
  return <section className="step-quiz"><span className="step-type">小测验</span><div className="quiz-question-md"><MarkdownContent content={block.question} /></div>{block.options?.length ? <div className="quiz-options">{block.options.map((option) => <label key={option.id} className={chosen.includes(option.id) ? 'selected' : ''}><input type={multiple ? 'checkbox' : 'radio'} name={'quiz-' + block.id} checked={chosen.includes(option.id)} onChange={() => choose(option.id)} /><div className="option-md"><MarkdownContent content={option.text} /></div></label>)}</div> : <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={4} placeholder="用自己的话写下理解…" />}{assessment && <div className={'quiz-feedback ' + assessment.result}><strong>{assessment.result === 'correct' ? '回答正确' : assessment.result === 'partial' ? '方向接近' : '再想一步'}</strong><MarkdownContent content={assessment.feedback} /></div>}<button type="button" className="btn-primary" disabled={busy || submitted || !answer.trim()} onClick={() => onSubmit(block.id, answer)}>{submitted ? '答案已提交' : '提交答案'} <span aria-hidden="true">→</span></button></section>;
}

export function LessonCanvas({
  lesson,
  activeBlock,
  assessment,
  busy,
  submitted,
  onQuizSubmit,
  onAdvance,
  canAdvance = true,
}: {
  lesson: Lesson;
  activeBlock?: LessonBlock;
  assessment?: AssessmentResult;
  busy: boolean;
  submitted: boolean;
  onQuizSubmit: (blockId: string, answer: string) => void;
  onAdvance: () => void;
  canAdvance?: boolean;
}) {
  return <article className="lesson-canvas" aria-busy={busy}><header className="lesson-canvas-heading"><span className="eyebrow">当前学习步骤</span><h1>{lesson.title}</h1>{lesson.objective && <MarkdownContent content={lesson.objective} />}</header><div className="active-step-area">{activeBlock?.type === 'text' && <TextStep block={activeBlock} />}{activeBlock?.type === 'code' && <CodeStep block={activeBlock} />}{activeBlock?.type === 'diagram' && <DiagramStep block={activeBlock} />}{activeBlock?.type === 'quiz' && <QuizStep block={activeBlock} assessment={assessment} busy={busy} submitted={submitted} onSubmit={onQuizSubmit} />}{!activeBlock && <div className="step-empty"><span className="eyebrow">本节完成</span><h2>这一节已经走完了</h2><p>回到课程路径，继续下一节。</p></div>}</div>{activeBlock && activeBlock.type !== 'quiz' && <button type="button" className="step-advance" disabled={busy || !canAdvance} onClick={onAdvance}>我学会了，继续下一步 <span aria-hidden="true">→</span></button>}{activeBlock?.type === 'quiz' && <button type="button" className="step-advance" disabled={busy || !submitted || !canAdvance} onClick={onAdvance}>完成这一步 <span aria-hidden="true">→</span></button>}{busy && <div className="canvas-busy" role="status" aria-live="polite"><span className="busy-dot" />正在调整当前步骤…</div>}</article>;
}
