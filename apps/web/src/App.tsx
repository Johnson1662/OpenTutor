import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { CourseListPage } from './components/CourseListPage.tsx';
import { CreateCoursePage } from './components/CreateCoursePage.tsx';
import { CourseSpacePage } from './components/CourseSpacePage.tsx';
import { CoursePathPage } from './components/CoursePathPage.tsx';
import { KnowledgeGraphPage } from './components/KnowledgeGraphPage.tsx';
import { MaterialsPage } from './components/MaterialsPage.tsx';
import { DiagnosticPage } from './components/DiagnosticPage.tsx';
import { ProviderSettingsPage } from './components/ProviderSettingsPage.tsx';
import { LearningRoom } from './components/LearningRoom.tsx';
import { HomeDashboard } from './components/HomeDashboard.tsx';
import { listCourses } from './runtime/api.ts';

export function App() {
  const [route, setRoute] = useState(() => (window.location.pathname + window.location.search) || '/courses');
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [navigationCourseId, setNavigationCourseId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then((courses) => {
        if (!cancelled) setNavigationCourseId(courses[0]?.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handlePopState() {
      setRoute((window.location.pathname + window.location.search) || '/courses');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function handleNavigate(newRoute: string) {
    window.history.pushState({}, '', newRoute);
    setRoute(newRoute);
  }

  function flash(message: string) {
    setToast(message);
    setTimeout(() => {
      setToast((prev) => (prev === message ? null : prev));
    }, 4000);
  }

  const [pathname, search] = route.split('?');
  const searchParams = new URLSearchParams(search || '');
  const coursePathMatch = pathname.match(/^\/courses\/([a-zA-Z0-9_-]+)(?:\/(path))?$/);
  const learnPathMatch = pathname.match(/^\/learn\/([a-zA-Z0-9_-]+)$/);
  const diagnosticMatch = pathname.match(/^\/diagnostic\/([a-zA-Z0-9_-]+)$/);
  const courseTab = searchParams.get('tab');
  const queryCourseId = searchParams.get('courseId') || undefined;
  const navigationCourse = coursePathMatch && coursePathMatch[1] !== 'new'
    ? coursePathMatch[1]
    : learnPathMatch
      ? learnPathMatch[1] === 'prototype'
        ? 'transformer'
        : learnPathMatch[1].replace(/^session-/, '')
      : diagnosticMatch
        ? diagnosticMatch[1] === 'prototype'
          ? 'transformer'
          : diagnosticMatch[1].replace(/^session-/, '')
        : queryCourseId || navigationCourseId;

  return (
    <div className="app-shell">
      <Navbar activeRoute={route} courseId={navigationCourse} onNavigate={handleNavigate} connected={pathname.startsWith('/learn/') ? connected : undefined} />

      {toast && (
        <div
          className="toast-banner"
          role={/error|failed|unable|invalid/i.test(toast) ? 'alert' : 'status'}
          aria-live={/error|failed|unable|invalid/i.test(toast) ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {toast}
        </div>
      )}

      <div className="main-content">
        {pathname === '/' ? (
          <HomeDashboard onNavigate={handleNavigate} />
        ) : pathname === '/courses' ? (
          <CourseListPage searchParams={searchParams} onNavigate={handleNavigate} onFlash={flash} />
        ) : pathname === '/courses/new' ? (
          <CreateCoursePage searchParams={searchParams} onNavigate={handleNavigate} onFlash={flash} />
        ) : pathname === '/knowledge' ? (
          <KnowledgeGraphPage courseId={queryCourseId || navigationCourse} onNavigate={handleNavigate} onFlash={flash} />
        ) : pathname === '/materials' ? (
          <MaterialsPage courseId={queryCourseId || navigationCourse} onNavigate={handleNavigate} onFlash={flash} />
        ) : diagnosticMatch ? (
          <DiagnosticPage sessionId={diagnosticMatch[1]!} onNavigate={handleNavigate} onFlash={flash} />
        ) : coursePathMatch && coursePathMatch[1] !== 'new' && coursePathMatch[2] === 'path' ? (
          <CoursePathPage courseId={coursePathMatch[1]!} onNavigate={handleNavigate} onFlash={flash} />
        ) : coursePathMatch && coursePathMatch[1] !== 'new' ? (
          <CourseSpacePage
            courseId={coursePathMatch[1]!}
            initialTab={courseTab === 'map' || courseTab === 'materials' ? courseTab : 'overview'}
            onNavigate={handleNavigate}
            onFlash={flash}
          />
        ) : pathname.startsWith('/settings') ? (
          <ProviderSettingsPage onFlash={flash} />
        ) : learnPathMatch ? (
          <LearningRoom sessionId={learnPathMatch[1]!} onNavigate={handleNavigate} onFlash={flash} onConnectionChange={setConnected} />
        ) : (
          <LearningRoom sessionId="prototype" onNavigate={handleNavigate} onFlash={flash} onConnectionChange={setConnected} />
        )}
      </div>
      <footer className="flow-footer">
        <strong>OpenTutor 学习流</strong>
        <span>目标 <i>→</i> 路径 <i>→</i> 课程 <i>→</i> 诊断 <i>→</i> 复习</span>
      </footer>
    </div>
  );
}
