import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ResourceDefinition, SessionUser } from '../lib/types';
import { clearToken } from '../lib/api';

type LayoutProps = {
  user: SessionUser;
  definitions: ResourceDefinition[];
};

const BRAND_MARK = (
  <svg viewBox="0 0 96 28" className="brand-logo" aria-hidden="true">
    <path d="M7 6h27l-8 8H14l8 8H7L0 14 7 6Zm31 0h52l-8 8H65l8 8H58l-8-8H39l7-8Zm18 0-7 8h-9l7-8h9Z" fill="currentColor" />
  </svg>
);

const NAV_META: Record<string, string> = {
  assets: 'AS',
  certificates: 'CF',
  jobs: 'JB',
  notifications: 'NT',
  files: 'FL',
  clients: 'CL',
  inspectors: 'IN',
  'functional-locations': 'LO',
};

export function Layout({ user, definitions }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = definitions.find((definition) => location.pathname.startsWith(`/${definition.path}`)) ?? definitions[0];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-cluster">
          <div className="brand-lockup">
            {BRAND_MARK}
            <div className="brand-copy">
              <strong>Rigways Group</strong>
              <span>Oil &amp; Gas Company</span>
            </div>
          </div>
          <span className="brand-badge">ACM</span>
          <div className="section-divider" />
          <p className="section-title">{active.navTitle}</p>
        </div>

        <div className="header-actions">
          <button className="icon-circle bell-icon" type="button" aria-label="Notifications">
            <span className="notif-dot" />
          </button>
          <button className="icon-circle gear-icon" type="button" aria-label="Settings" />
          <div className="avatar-circle">{user.name.charAt(0).toUpperCase()}</div>
        </div>
      </header>

      <nav className="app-nav">
        {definitions.map((item) => (
          <NavLink
            key={item.path}
            to={`/${item.path}`}
            className={({ isActive }) =>
              isActive
                ? `app-nav-link active ${item.accent === 'amber' ? 'is-amber' : ''}`
                : `app-nav-link ${item.accent === 'amber' ? 'is-amber' : ''}`
            }
          >
            <span className="nav-glyph">{NAV_META[item.path] ?? 'NA'}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}

        <button
          className="logout-ghost"
          onClick={() => {
            clearToken();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </nav>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
