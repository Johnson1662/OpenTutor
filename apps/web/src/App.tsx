import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { CourseListPage } from './components/CourseListPage.tsx';
import { CreateCoursePage } from './components/CreateCoursePage.tsx';
import { CourseSpacePage } from './components/CourseSpacePage.tsx';
import { ProviderSettingsPage } from './components/ProviderSettingsPage.tsx';
import { LearningRoom } from './components/LearningRoom.tsx';
import { HomeDashboard } from './components/HomeDashboard.tsx';

type CourseTab = 'route' | 'knowledge' | 'materials';
type AppRoute =
  | { kind: 'home' }
  | { kind: 'courses'; search: URLSearchParams }
  | { kind: 'create'; search: URLSearchParams }
  | { kind: 'course'; courseId: string; tab: CourseTab }
  | { kind: 'player'; sessionId: string }
  | { kind: 'settings' }
  | { kind: 'not-found' };

function canonicalizeRoute(raw: string) {
  const url = new URL(raw || '/', window.location.origin);
  const courseId = url.searchParams.get('courseId');
  if (url.pathname === '/learning') return '/courses';
  if (url.pathname === '/knowledge' && courseId) return '/courses/' + courseId + '?tab=knowledge';
  if (url.pathname === '/materials' && courseId) return '/courses/' + courseId + '?tab=materials';
  const pathTab = url.pathname.match(/^\/courses\/([a-zA-Z0-9_-]+)\/path$/);
  if (pathTab) return '/courses/' + pathTab[1] + '?tab=route';
  if (/^\/diagnostic\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return '/courses';
  return url.pathname + url.search;
}

function parseRoute(raw: string): AppRoute {
  const url = new URL(raw || '/', window.location.origin);
  if (url.pathname === '/') return { kind: 'home' };
  if (url.pathname === '/courses') return { kind: 'courses', search: url.searchParams };
  if (url.pathname === '/courses/new') return { kind: 'create', search: url.searchParams };
  const course = url.pathname.match(/^\/courses\/([a-zA-Z0-9_-]+)$/);
  if (course) {
    const tab = url.searchParams.get('tab');
    return {
      kind: 'course',
      courseId: course[1]!,
      tab: tab === 'knowledge' || tab === 'materials' ? tab : 'route',
    };
  }
  const player = url.pathname.match(/^\/learn\/([a-zA-Z0-9_-]+)$/);
  if (player) return { kind: 'player', sessionId: player[1]! };
  if (url.pathname.startsWith('/settings')) return { kind: 'settings' };
  return { kind: 'not-found' };
}

export function App() {
  const [route, setRoute] = useState(() => canonicalizeRoute(window.location.pathname + window.location.search));
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const canonical = canonicalizeRoute(window.location.pathname + window.location.search);
    if (canonical !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', canonical);
    }
    setRoute(canonical);

    function handlePopState() {
      setRoute(canonicalizeRoute(window.location.pathname + window.location.search));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function handleNavigate(nextRoute: string) {
    const canonical = canonicalizeRoute(nextRoute);
    window.history.pushState({}, '', canonical);
    setRoute(canonical);
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 4000);
  }

  const parsed = parseRoute(route);
  const player = parsed.kind === 'player';

  return (
    <div className={player ? 'app-shell player-shell' : 'app-shell'}>
      {!player && parsed.kind !== 'not-found' && <Navbar activeRoute={route} onNavigate={handleNavigate} />}
      {toast && (
        <div className="toast-banner" role="status" aria-live="polite" aria-atomic="true">{toast}</div>
      )}
      <div className="main-content">
        {parsed.kind === 'home' && <HomeDashboard onNavigate={handleNavigate} />}
        {parsed.kind === 'courses' && <CourseListPage searchParams={parsed.search} onNavigate={handleNavigate} onFlash={flash} />}
        {parsed.kind === 'create' && <CreateCoursePage searchParams={parsed.search} onNavigate={handleNavigate} onFlash={flash} />}
        {parsed.kind === 'course' && (
          <CourseSpacePage courseId={parsed.courseId} initialTab={parsed.tab} onNavigate={handleNavigate} onFlash={flash} />
        )}
        {parsed.kind === 'player' && <LearningRoom sessionId={parsed.sessionId} onNavigate={handleNavigate} onFlash={flash} />}
        {parsed.kind === 'settings' && <ProviderSettingsPage onFlash={flash} />}
        {parsed.kind === 'not-found' && (
          <main className="page-shell"><div className="empty-state-card"><h1>页面不存在</h1><button type="button" className="btn-primary" onClick={() => handleNavigate('/courses')}>返回我的学习</button></div></main>
        )}
      </div>
    </div>
  );
}
