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
      <form className="login-card" onSubmit={submit}>
        <img src="/logo-128.png" alt="" width="48" height="48" />
        <p className="label">Codebase Intelligence</p>
        <h1>Admin sign in</h1>
        <p className="muted small">Sign in to open the repository workspace. Sessions expire after 24 hours.</p>
        <label className="login-field">
          <span className="label">Login ID</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label className="login-field">
          <span className="label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <p className="error small" role="alert">{error}</p>}
        <button className="btn-primary login-submit" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
