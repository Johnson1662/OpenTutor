import { useState } from 'react';
import type { AssessmentResult, DiagramBlock, Lesson, QuizBlock } from '@opentutor/protocol';

function DiagramView({ block }: { block: DiagramBlock }) {
  return (
    <div className="diagram-block">
      <div className="diagram-row">
        {block.nodes.map((node) => (
          <span key={node.id} className="token-pill">{node.label}</span>
        ))}
      </div>
      <div className="diagram-edges">
        {block.edges.map((edge, index) => (
          <div key={`${edge.from}-${edge.to}-${index}`}>
            <strong>{edge.from}</strong> → <strong>{edge.to}</strong>{edge.label ? ` · ${edge.label}` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuizView({
  block,
  assessment,
  busy,
  onSubmit,
}: {
  block: QuizBlock;
  assessment?: AssessmentResult;
  busy: boolean;
  onSubmit: (blockId: string, answer: string) => void;
}) {
  const [answer, setAnswer] = useState('');
  return (
    <section className="quiz-block">
      <div className="section-label">Quick check</div>
      <h3>{block.question}</h3>
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer…" />
      <div className="quiz-actions">
        <button className="primary" disabled={busy || !answer.trim()} onClick={() => onSubmit(block.id, answer)}>Check answer</button>
      </div>
      {assessment && (
        <div className={`quiz-result ${assessment.result === 'correct' ? 'success' : ''}`}>
          <strong>{assessment.result === 'correct' ? 'Core idea understood.' : 'Partially understood.'}</strong><br />
          {assessment.feedback}
        </div>
      )}
    </section>
  );
}

export function LessonCanvas({
  lesson,
  assessment,
  busy,
  onQuizSubmit,
  nextNodeTitle,
}: {
  lesson: Lesson;
  assessment?: AssessmentResult;
  busy: boolean;
  onQuizSubmit: (blockId: string, answer: string) => void;
  nextNodeTitle?: string;
}) {
  return (
    <main className="canvas-shell">
      <article className="lesson-canvas">
        <header className="lesson-header">
          <div className="section-label">Self attention</div>
          <h1>{lesson.title}</h1>
          {lesson.objective && <p>{lesson.objective}</p>}
        </header>

        <div className="block-list">
          {lesson.blocks.map((block) => {
            if (block.type === 'text') {
              return block.variant === 'paragraph' ? (
                <p className="text-block" key={block.id}>{block.content}</p>
              ) : (
                <section className={`callout ${block.variant}`} key={block.id}>
                  <div className="callout-label">{block.variant}</div>
                  <div>{block.content}</div>
                </section>
              );
            }
            if (block.type === 'code') {
              return (
                <section className="code-block" key={block.id}>
                  <div className="block-meta"><span>Code example</span><span className="added">Added</span></div>
                  <pre><code>{block.code}</code></pre>
                  {block.explanation && <p>{block.explanation}</p>}
                </section>
              );
            }
            if (block.type === 'diagram') return <DiagramView key={block.id} block={block} />;
            if (block.type === 'quiz') return (
              <QuizView key={block.id} block={block} assessment={assessment?.blockId === block.id ? assessment : undefined} busy={busy} onSubmit={onQuizSubmit} />
            );
            return null;
          })}
        </div>

        {lesson.status === 'completed' && (
          <section className="lesson-completion">
            <div className="section-label">Mastered</div>
            <h2>{lesson.title} complete</h2>
            {nextNodeTitle && <p>Next: <strong>{nextNodeTitle}</strong></p>}
            <button className="primary" disabled>Continue (next prototype step)</button>
          </section>
        )}
      </article>
    </main>
  );
}
