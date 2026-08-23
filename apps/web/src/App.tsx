import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { CourseListPage } from './components/CourseListPage.tsx';
import { CreateCoursePage } from './components/CreateCoursePage.tsx';
import { CourseSpacePage } from './components/CourseSpacePage.tsx';
import { ProviderSettingsPage } from './components/ProviderSettingsPage.tsx';
import { LearningRoom } from './components/LearningRoom.tsx';

export function App() {
  const [route, setRoute] = useState(() => window.location.pathname || '/courses');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    function handlePopState() {
      setRoute(window.location.pathname || '/courses');
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

  const courseMatch = route.match(/^\/courses\/([a-zA-Z0-9_-]+)$/);
  const learnMatch = route.match(/^\/learn\/([a-zA-Z0-9_-]+)$/);

  return (
    <div className="app-shell">
      <Navbar activeRoute={route} onNavigate={handleNavigate} connected={true} />

      {toast && <div className="toast-banner">{toast}</div>}

      <div className="main-content">
        {route === '/' || route === '/courses' ? (
          <CourseListPage onNavigate={handleNavigate} onFlash={flash} />
        ) : route === '/courses/new' ? (
          <CreateCoursePage onNavigate={handleNavigate} onFlash={flash} />
        ) : courseMatch && courseMatch[1] !== 'new' ? (
          <CourseSpacePage courseId={courseMatch[1]!} onNavigate={handleNavigate} onFlash={flash} />
        ) : route.startsWith('/settings') ? (
          <ProviderSettingsPage onFlash={flash} />
        ) : learnMatch ? (
          <LearningRoom sessionId={learnMatch[1]!} onNavigate={handleNavigate} onFlash={flash} />
        ) : (
          <LearningRoom sessionId="prototype" onNavigate={handleNavigate} onFlash={flash} />
        )}
      </div>
    </div>
  );
}
