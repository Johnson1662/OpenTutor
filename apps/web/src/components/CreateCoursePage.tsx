import { useState } from 'react';
import { createCourse, addCourseSource, compileCourse } from '../runtime/api.ts';

export function CreateCoursePage({
  onNavigate,
  onFlash,
  searchParams,
}: {
  onNavigate: (route: string) => void;
  onFlash: (msg: string) => void;
  searchParams?: URLSearchParams;
}) {
  const [title, setTitle] = useState(() => searchParams?.get('title') || '');
  const [learningGoal, setLearningGoal] = useState(() => searchParams?.get('goal') || '');
  const [materialTitle, setMaterialTitle] = useState('Core Notes.md');
  const [materialContent, setMaterialContent] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [compileStage, setCompileStage] = useState('');

  async function handleCreateAndCompile(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !learningGoal.trim()) {
      onFlash('Please enter a course title and learning goal.');
      return;
    }

    try {
      setCompiling(true);
      setCompileStage('1. Creating course workspace...');
      const course = await createCourse(title.trim(), learningGoal.trim());

      if (materialContent.trim()) {
        setCompileStage('2. Uploading and parsing source materials...');
        await addCourseSource(course.id, materialTitle, materialContent);
      }

      setCompileStage('3. AI Knowledge Compilation & Course Planning...');
      const { snapshot } = await compileCourse(course.id, learningGoal.trim());

      onFlash('Course compiled successfully! Launching Learning Room...');
      onNavigate(`/learn/${snapshot.sessionId}`);
    } catch (err: any) {
      onFlash(`Compilation failed: ${err.message}`);
      setCompiling(false);
    }
  }

  function handlePresetTransformer() {
    setTitle('Transformer Architecture');
    setLearningGoal('I want to understand Transformer architecture from scratch and implement self-attention.');
    setMaterialTitle('Attention Is All You Need.md');
    setMaterialContent(`# Self Attention
Self attention enables direct token interactions across sequences.
Softmax converts logits into normalized probability distribution.

# Multi-Head Attention
Multi-Head Attention runs multiple self-attention mechanisms in parallel.
Embeddings project discrete tokens into dense vector space.`);
  }

  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>Create Adaptive Course</h1>
        <p>State what you want to learn. Our AI will compile your knowledge graph, course map, and lessons.</p>
      </div>

      <div className="create-course-container">
        <form onSubmit={handleCreateAndCompile} className="create-form">
          <div className="preset-row">
            <span>Need inspiration?</span>
            <button type="button" className="btn-secondary btn-sm" onClick={handlePresetTransformer}>
              ⚡ Fill "Transformer from Scratch" Example
            </button>
          </div>

          <label className="form-field">
            <span>Course Title</span>
            <input
              type="text"
              placeholder="e.g. Transformer Architecture & Attention"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={compiling}
              required
            />
          </label>

          <label className="form-field">
            <span>What do you want to learn? (Learning Goal)</span>
            <textarea
              rows={3}
              placeholder="e.g. I want to understand Transformer from scratch, master query-key-value intuition, and implement self-attention."
              value={learningGoal}
              onChange={(e) => setLearningGoal(e.target.value)}
              disabled={compiling}
              required
            />
          </label>

          <div className="materials-section">
            <h3>Source Materials (Optional)</h3>
            <p className="hint-text">Upload Markdown or Text notes to compile into grounded Living Knowledge.</p>

            <label className="form-field">
              <span>Material Filename / Title</span>
              <input
                type="text"
                value={materialTitle}
                onChange={(e) => setMaterialTitle(e.target.value)}
                disabled={compiling}
              />
            </label>

            <label className="form-field">
              <span>Markdown / Text Content</span>
              <textarea
                rows={6}
                placeholder="Paste your markdown notes or reference text here..."
                value={materialContent}
                onChange={(e) => setMaterialContent(e.target.value)}
                disabled={compiling}
              />
            </label>
          </div>

          {compiling ? (
            <div className="compile-progress-box">
              <div className="loading-spinner" />
              <p className="compile-stage-text">{compileStage}</p>
            </div>
          ) : (
            <button type="submit" className="btn-primary btn-lg">
              Compile & Start Learning →
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
