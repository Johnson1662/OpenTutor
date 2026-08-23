import { useEffect, useState } from 'react';
import {
  getCourse,
  getCourseMap,
  listCourseSources,
  addCourseSource,
  deleteCourseSource,
  compileCourse,
  type CourseSummary,
  type CourseMapInfo,
  type CourseSourceItem,
} from '../runtime/api.ts';

export function CourseSpacePage({
  courseId,
  onNavigate,
  onFlash,
}: {
  courseId: string;
  onNavigate: (route: string) => void;
  onFlash: (msg: string) => void;
}) {
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [courseMap, setCourseMap] = useState<CourseMapInfo | null>(null);
  const [sources, setSources] = useState<CourseSourceItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'map' | 'materials'>('overview');
  const [loading, setLoading] = useState(true);
  const [newMaterialTitle, setNewMaterialTitle] = useState('');
  const [newMaterialContent, setNewMaterialContent] = useState('');
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    loadCourseData();
  }, [courseId]);

  async function loadCourseData() {
    try {
      setLoading(true);
      const [c, m, s] = await Promise.all([
        getCourse(courseId),
        getCourseMap(courseId).catch(() => null),
        listCourseSources(courseId).catch(() => []),
      ]);
      setCourse(c);
      setCourseMap(m);
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

  if (loading) {
    return <div className="page-shell"><div className="loading-spinner">Loading Course Space...</div></div>;
  }

  if (!course) {
    return <div className="page-shell"><h2>Course Not Found</h2></div>;
  }

  return (
    <main className="page-shell">
      <div className="page-header page-header-row">
        <div>
          <span className={`course-badge ${course.compileStatus}`}>{course.compileStatus}</span>
          <h1>{course.title}</h1>
          <p>{course.description || 'Personalized AI Course Space'}</p>
        </div>
        <div className="header-actions">
          <button
            className="btn-primary btn-lg"
            onClick={() => onNavigate(`/learn/${courseId === 'transformer' ? 'prototype' : `session-${courseId}`}`)}
          >
            Enter Learning Room →
          </button>
        </div>
      </div>

      <div className="course-tabs">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          Course Map ({courseMap?.nodes.length ?? 0})
        </button>
        <button
          className={`tab-btn ${activeTab === 'materials' ? 'active' : ''}`}
          onClick={() => setActiveTab('materials')}
        >
          Materials ({sources.length})
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="tab-content">
          <div className="overview-grid">
            <div className="overview-card">
              <h3>Target Concepts</h3>
              <ul className="concept-list">
                {(courseMap?.nodes || []).map((n) => (
                  <li key={n.knowledgeNodeId}>
                    <span className="concept-pos">#{n.position}</span>
                    <span className="concept-name">{n.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="overview-card">
              <h3>Compilation Status</h3>
              <p><strong>Status:</strong> {course.compileStatus}</p>
              <p><strong>Compiled at:</strong> {course.compiledAt ? new Date(course.compiledAt).toLocaleString() : 'Not compiled yet'}</p>
              <button
                className="btn-secondary"
                onClick={handleRecompile}
                disabled={compiling}
              >
                {compiling ? 'Recompiling...' : '⚡ Recompile Course'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'map' && (
        <div className="tab-content">
          <div className="map-view">
            <h2>Course Knowledge Graph Projection</h2>
            <div className="map-nodes-grid">
              {(courseMap?.nodes || []).map((n) => (
                <div key={n.knowledgeNodeId} className="map-node-card">
                  <span className="map-node-step">Step {n.position}</span>
                  <h4>{n.title}</h4>
                  <p>{n.description || 'Core concept'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'materials' && (
        <div className="tab-content">
          <div className="materials-view">
            <div className="materials-list">
              <h3>Uploaded Documents</h3>
              {sources.length === 0 ? (
                <p className="hint-text">No materials uploaded yet.</p>
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
              <h3>Add New Material</h3>
              <label className="form-field">
                <span>Title / Filename</span>
                <input
                  type="text"
                  placeholder="e.g. Multi-Head Attention.md"
                  value={newMaterialTitle}
                  onChange={(e) => setNewMaterialTitle(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                <span>Content</span>
                <textarea
                  rows={4}
                  placeholder="Paste markdown content..."
                  value={newMaterialContent}
                  onChange={(e) => setNewMaterialContent(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="btn-secondary">Upload Material</button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
