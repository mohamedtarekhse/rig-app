import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, setToken } from '../lib/api';
import type { SessionUser } from '../lib/types';

type LoginPageProps = {
  onAuthenticated: (user: SessionUser) => void;
};

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const data = await login(username, password);
      setToken(data.token);
      onAuthenticated(data.user);
      navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <section className="login-poster">
        <p className="eyebrow">Rigways rebuild</p>
        <h1>Field-grade control for assets, certificates, and jobs.</h1>
        <p>
          This React + Node.js version keeps the old domain model but upgrades it into a deployable
          MySQL stack for Docker and Coolify.
        </p>
      </section>

      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Secure sign in</p>
          <h2>Command center access</h2>
        </div>

        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p className="error-banner">{error}</p> : null}

        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Enter platform'}
        </button>

        <p className="hint-text">Seed credentials: admin / admin123</p>
      </form>
    </div>
  );
}