'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

function safeReturnPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export default function LoginPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState('/');
  const [username, setUsername] = useState('Admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const destination = safeReturnPath(new URLSearchParams(window.location.search).get('from'));
    setReturnTo(destination);
    void api.authSession().then((session) => {
      if (session.authenticated) router.replace(destination);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not verify login service.');
    });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(username, password);
      router.replace(returnTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-art" aria-label="Codebase Intelligence">
        <div className="login-art-orbit login-art-orbit-one" />
        <div className="login-art-orbit login-art-orbit-two" />
        <div className="login-art-content">
          <div className="login-art-brand">
            <img src="/logo-128.png" alt="" width="42" height="42" />
            <span>Codebase Intelligence</span>
          </div>
          <div className="login-art-message">
            <span className="login-eyebrow">ARCHITECTURE, WITH EVIDENCE</span>
            <h1>See how your code fits together.</h1>
            <p>Explore the relationships, decisions, and pathways that shape your software.</p>
          </div>
          <div className="login-art-caption">
            <span className="login-caption-dot" />
            One connected view of your system
          </div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-mobile-brand">
            <img src="/logo-128.png" alt="" width="42" height="42" />
            <span>Codebase Intelligence</span>
          </div>
          <span className="login-eyebrow">ADMIN WORKSPACE</span>
          <h2>Welcome back</h2>
          <p className="login-description">Sign in to continue to your repository workspace.</p>
          <label className="login-field">
            <span>Login ID</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="login-session-note">Your secure session lasts 24 hours.</p>
        </form>
      </section>
    </main>
  );
}
