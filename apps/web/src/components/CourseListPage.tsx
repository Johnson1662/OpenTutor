import { useEffect, useState } from 'react';
import { listCourses, type CourseSummary } from '../runtime/api.ts';

export function CourseListPage({
  onNavigate,
  onFlash,
}: {
  onNavigate: (route: string) => void;
  onFlash: (msg: string) => void;
}) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCourses();
  }, []);

  async function loadCourses() {
    try {
      setLoading(true);
      const list = await listCourses();
      setCourses(list);
    } catch (err: any) {
      onFlash(`Failed to load courses: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="page-header page-header-row">
        <div>
          <h1>Your Courses</h1>
          <p>Personalized learning spaces compiled with Living Knowledge & Adaptive AI Tutor.</p>
        </div>
        <button className="btn-primary" onClick={() => onNavigate('/courses/new')}>
          + New Course
        </button>
      </div>

      {loading ? (
        <div className="loading-spinner">Loading courses...</div>
      ) : courses.length === 0 ? (
        <div className="empty-state-card">
          <h2>No Courses Yet</h2>
          <p>Create your first AI-compiled course to begin personalized learning.</p>
          <button className="btn-primary" onClick={() => onNavigate('/courses/new')}>
            Create Your First Course
          </button>
        </div>
      ) : (
        <div className="course-grid">
          {courses.map((c) => (
            <div key={c.id} className="course-card" onClick={() => onNavigate(`/courses/${c.id}`)}>
              <div className="course-card-top">
                <span className={`course-badge ${c.compileStatus}`}>{c.compileStatus}</span>
                <span className="course-date">{new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
              <h3 className="course-card-title">{c.title}</h3>
              <p className="course-card-desc">{c.description || 'Adaptive AI course'}</p>
              <div className="course-card-footer">
                <button
                  className="btn-primary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(`/learn/${c.id === 'transformer' ? 'prototype' : `session-${c.id}`}`);
                  }}
                >
                  Continue Learning →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
