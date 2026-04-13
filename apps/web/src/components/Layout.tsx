import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { SessionUser } from '../lib/types';
import { clearToken } from '../lib/api';

type LayoutProps = {
  user: SessionUser;
};

const NAV_ITEMS = [
  { to: '/', label: 'Overview' },
  { to: '/assets', label: 'Assets' },
  { to: '/certificates', label: 'Certificates' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/clients', label: 'Clients' },
  { to: '/inspectors', label: 'Inspectors' },
  { to: '/functional-locations', label: 'Locations' },
  { to: '/notifications', label: 'Notifications' },
];

export function Layout({ user }: LayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <p>Rigways</p>
            <small>Command Center</small>
          </div>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button
          className="ghost-button logout-button"
          onClick={() => {
            clearToken();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Fleet operations</p>
            <h1>Asset and certificate control</h1>
          </div>

          <div className="user-pill">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}