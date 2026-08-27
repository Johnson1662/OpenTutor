const navItems = [
  { label: '首页', route: '/' },
  { label: '我的学习', route: '/courses' },
  { label: '创建目标', route: '/courses/new' },
  { label: '设置', route: '/settings' },
];

export function Navbar({
  activeRoute,
  onNavigate,
}: {
  activeRoute: string;
  onNavigate: (route: string) => void;
}) {
  const activePath = activeRoute.split('?')[0];

  return (
    <header className="app-nav">
      <button type="button" className="app-brand" onClick={() => onNavigate('/')}>
        <span className="brand-dot" aria-hidden="true" />
        <span>OpenTutor</span>
      </button>
      <nav className="app-nav-links" aria-label="主导航">
        {navItems.map((item) => {
          const active = item.route === '/'
            ? activePath === '/'
            : activePath === item.route || (item.route === '/courses' && activePath.startsWith('/courses/'));
          return (
            <button
              type="button"
              key={item.route}
              className={'app-nav-link ' + (active ? 'active' : '')}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(item.route)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="app-nav-meta">
        <span className="nav-greeting">今天也学一点</span>
        <button
          type="button"
          className={"nav-avatar-btn " + (activePath === '/settings' ? 'active' : '')}
          onClick={() => onNavigate('/settings')}
          title="系统设置 / 模型配置"
          aria-label="打开设置"
        >
          <span className="nav-avatar" aria-hidden="true">设</span>
        </button>
      </div>
    </header>
  );
}
