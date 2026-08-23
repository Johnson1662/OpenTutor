export function Navbar({
  activeRoute,
  onNavigate,
  connected,
}: {
  activeRoute: string;
  onNavigate: (route: string) => void;
  connected?: boolean;
}) {
  return (
    <header className="top-nav">
      <div className="nav-brand" onClick={() => onNavigate('/courses')}>
        <span className="brand-badge">OpenTutor</span>
        <span className="brand-version">v0.6</span>
      </div>

      <nav className="nav-links">
        <button
          className={`nav-btn ${activeRoute === '/' || activeRoute === '/courses' ? 'active' : ''}`}
          onClick={() => onNavigate('/courses')}
        >
          Courses
        </button>
        <button
          className={`nav-btn ${activeRoute === '/courses/new' ? 'active' : ''}`}
          onClick={() => onNavigate('/courses/new')}
        >
          + Create Course
        </button>
        <button
          className={`nav-btn ${activeRoute === '/settings/providers' ? 'active' : ''}`}
          onClick={() => onNavigate('/settings/providers')}
        >
          AI Providers
        </button>
      </nav>

      <div className="nav-status">
        <span className={`status-indicator ${connected ? 'connected' : 'connecting'}`} />
        <span className="status-label">{connected ? 'Live Sync' : 'Reconnecting'}</span>
      </div>
    </header>
  );
}
