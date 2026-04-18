import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ResourceDefinition, SessionUser } from '../lib/types';
import { clearToken } from '../lib/api';

type LayoutProps = {
  user: SessionUser;
  definitions: ResourceDefinition[];
};

const BRAND_MARK = (
  <svg viewBox="0 0 248 88" className="brand-logo" aria-hidden="true">
    <path
      fill="currentColor"
      d="M9 78 36 52c-9-4-15-13-15-24C21 12 34 0 51 0h190l-21 23H51c-4 0-7 2-9 5-2 3-2 7 0 11 2 3 5 5 9 5h34c10 0 18 8 18 18v16H73V58H43L9 78Zm110-39h42c-1 17 14 31 31 31h46V48h-43c-10 0-18-8-18-18v-2h61V9H119v30Zm0 39V49h29c4 17 20 29 39 29h54v-1h-55c-17 0-31-8-40-21v22h-27Z"
    />
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to Main Content</a>

      <header className="app-header">
        <div className="brand-cluster">
          <div className="brand-lockup shell-brand-lockup">
            <div className="brand-logo-wrap">{BRAND_MARK}</div>
            <div className="brand-copy shell-brand-copy">
              <strong translate="no">Rigways Group</strong>
              <span>Oil &amp; Gas Company</span>
            </div>
          </div>
          <span className="brand-badge" translate="no">ACM</span>
          <div className="section-divider" />
          <p className="section-title">{active.navTitle}</p>
        </div>

        <div className="header-actions">
          <div className="avatar-menu" ref={menuRef}>
            <button
              className={`avatar-trigger ${menuOpen ? 'open' : ''}`}
              type="button"
              aria-label="Open account menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <div className="avatar-circle" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</div>
              <span className="avatar-caret" aria-hidden="true" />
            </button>

            {menuOpen ? (
              <div className="avatar-dropdown" role="dialog" aria-label="Account menu">
                <button
                  className="avatar-dropdown-item"
                  type="button"
                  onClick={() => {
                    clearToken();
                    navigate('/login');
                  }}
                >
                  Sign Out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="app-nav" aria-label="Primary navigation">
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
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <main className="app-main" id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
