import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, setToken } from '../lib/api';
import type { SessionUser } from '../lib/types';

type LoginPageProps = {
  onAuthenticated: (user: SessionUser) => void;
};

const FEATURE_ITEMS = [
  {
    title: 'Asset Lifecycle Tracking',
    body: 'Full visibility from acquisition to decommission',
  },
  {
    title: 'Certificate Compliance',
    body: 'Automated expiry alerts with approval workflow',
  },
  {
    title: 'Role-Based Access Control',
    body: 'Admin, Manager, Technician & User isolation',
  },
];

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const year = useMemo(() => new Date().getFullYear(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const data = await login(username, password);
      setToken(data.token);
      onAuthenticated(data.user);
      navigate('/assets');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-grid-overlay" />
        <div className="login-orb orb-a" />
        <div className="login-orb orb-b" />
        <div className="login-orb orb-c" />

        <div className="login-brand-block">
          <div className="login-brand-row">
            <div className="brand-lockup inverse">
              <div className="brand-mark-wide">
                <span className="brand-mark-glyph">RG</span>
              </div>
              <div className="brand-copy">
                <strong>Rigways Group</strong>
                <span>Oil &amp; Gas Company</span>
              </div>
            </div>
          </div>

          <div className="login-message">
            <h1>
              Manage <span>Assets</span> &amp;
              <br />
              <span>Certificates</span> at Scale
            </h1>
            <p>A unified platform built on SAP Fiori UX principles.</p>
          </div>

          <div className="login-feature-list">
            {FEATURE_ITEMS.map((item, index) => (
              <article key={item.title} className="feature-panel">
                <div className={`feature-icon icon-${index + 1}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>

          <small className="login-footer-note">Rigways Group - Asset &amp; Certificate Management</small>
        </div>
      </section>

      <section className="login-form-column">
        <form className="login-form-card" onSubmit={handleSubmit}>
          <p className="overline blue">WELCOME BACK</p>
          <h2>Sign in to your account</h2>
          <p className="muted-copy">Enter your credentials - your role is detected automatically.</p>

          <label className="field-wrap">
            <span>Username</span>
            <div className="field-shell two-col">
              <span className="field-icon user" />
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter username" />
            </div>
          </label>

          <label className="field-wrap">
            <span>Password</span>
            <div className="field-shell three-col">
              <span className="field-icon lock" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
              />
              <span className="field-icon trailing eye" />
            </div>
          </label>

          {error ? <p className="error-banner">{error}</p> : null}

          <button className="submit-button" type="submit" disabled={busy}>
            <span className="button-arrow" />
            <span>{busy ? 'Signing In' : 'Sign In'}</span>
          </button>

          <div className="login-meta">
            <strong>Rigways Group</strong>
            <span>Asset &amp; Certificate Management System</span>
            <small>© {year} - All rights reserved.</small>
          </div>
        </form>
      </section>
    </div>
  );
}
