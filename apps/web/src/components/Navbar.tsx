import { useState } from 'react';

function NavGlyph({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: 'M3 10.5 12 3l9 7.5M5.5 9v10h13V9M9 19v-5h6v5',
    courses: 'M5 4.5h14v15H5zM8 8h8M8 12h8M8 16h5',
    learn: 'M4 5.5a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2zM4 5.5v13M8 8h6M8 11h6',
    graph: 'M5 12a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm14 7a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM17 7a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM7.5 7.5l7-3M7 10.5l8.5 5',
    materials: 'M3.5 6.5h6l2 2h9v9.5h-17zM3.5 6.5v-2h6l2 2',
    settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17 7l1.5-1.5M7 17l-1.5 1.5M17 17l1.5 1.5M7 7 5.5 5.5',
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] || paths.home} /></svg>;
}

export function Navbar({
  activeRoute,
  onNavigate,
  connected,
  courseId,
}: {
  activeRoute: string;
  onNavigate: (route: string) => void;
  connected?: boolean;
  courseId?: string;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activePath] = activeRoute.split('?');
  const navItems = [
    { label: '首页', icon: 'home', route: '/' },
    { label: '课程', icon: 'courses', route: '/courses' },
    ...(courseId ? [{ label: '学习空间', icon: 'learn', route: `/learn/${courseId === 'transformer' ? 'prototype' : `session-${courseId}`}` }] : []),
    { label: '知识图谱', icon: 'graph', route: courseId ? `/knowledge?courseId=${courseId}` : '/knowledge' },
    { label: '资料库', icon: 'materials', route: courseId ? `/materials?courseId=${courseId}` : '/materials' },
    { label: '设置', icon: 'settings', route: '/settings/providers' },
  ];

  return (
    <>
      <aside className="app-sidebar">
        <button type="button" className="sidebar-brand" onClick={() => onNavigate('/')}>
          <span className="brand-mark" aria-hidden="true">◉</span>
          <span className="brand-badge">OpenTutor</span>
        </button>
        <nav className="sidebar-nav" aria-label="主导航">
          {navItems.map((item) => {
            const active = item.route === '/'
              ? activePath === '/'
              : item.route.startsWith('/knowledge')
                ? activePath === '/knowledge'
                : item.route.startsWith('/materials')
                  ? activePath === '/materials'
                  : item.route.startsWith('/learn/')
                    ? activePath.startsWith('/learn/')
                    : item.route === '/courses'
                      ? activePath === '/courses' || activePath === '/courses/new' || (activePath.startsWith('/courses/') && !activeRoute.includes('/path'))
                      : activePath === item.route || activePath.startsWith(`${item.route}/`);
            return (
              <button
                type="button"
                key={`${item.label}-${item.route}`}
                className={`sidebar-item ${item.label === '设置' ? 'sidebar-settings-item' : ''} ${active ? 'active' : ''}`}
                onClick={() => onNavigate(item.route)}
              >
                <span className="sidebar-icon"><NavGlyph name={item.icon} /></span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <header className="top-nav">
        <div className="top-search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            aria-label="搜索课程、知识点、资料"
            placeholder="搜索课程、知识点或资料"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onNavigate(searchTerm.trim() ? `/courses?q=${encodeURIComponent(searchTerm.trim())}` : '/courses');
              }
            }}
          />
          <kbd>⌘K</kbd>
        </div>
        <div className="top-actions">
          <button type="button" className="top-create" onClick={() => onNavigate('/courses/new')}>＋ 新建学习</button>
          <div className="top-utilities">
            <span className="utility-icon notification" aria-label="通知">♧<i /></span>
            <span className="user-profile"><span className="avatar">张</span><span>张同学</span><b>⌄</b></span>
          </div>
          {connected !== undefined && (
            <span className="nav-status">
              <span className={`status-indicator ${connected ? 'connected' : 'connecting'}`} />
              {connected ? 'Live Sync' : 'Reconnecting'}
            </span>
          )}
        </div>
      </header>
    </>
  );
}
