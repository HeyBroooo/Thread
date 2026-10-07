'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

function safeReturnPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export default function LoginPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState('/');
  const [identityAuthenticated, setIdentityAuthenticated] = useState(false);
  const [identityEmail, setIdentityEmail] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const destination = safeReturnPath(params.get('from'));
    setReturnTo(destination);
    if (params.has('error')) setError('Sign-in could not be completed. Please try again.');
    void api.authSession()
      .then((session) => {
        if (session.authenticated) {
          router.replace(destination);
          return;
        }
        setIdentityAuthenticated(session.identityAuthenticated);
        setIdentityEmail(session.email ?? '');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not verify the sign-in service.');
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function requestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api.requestMagicLink(email, returnTo);
      setNotice(`If the address can receive mail, a sign-in link is on its way to ${email.trim()}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send a sign-in link.');
    } finally {
      setSubmitting(false);
    }
  }

  async function enterWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(password);
      router.replace(returnTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not unlock the workspace.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-art" aria-label="ArchThread">
        <div className="login-art-orbit login-art-orbit-one" />
        <div className="login-art-orbit login-art-orbit-two" />
        <div className="login-art-content">
          <div className="login-art-brand">
            <img src="/logo-128.png" alt="" width="42" height="42" />
            <span>ArchThread</span>
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
        <Card className="login-card">
          <div className="login-mobile-brand">
            <img src="/logo-128.png" alt="" width="42" height="42" />
            <span>ArchThread</span>
          </div>
          <span className="login-eyebrow">{identityAuthenticated ? 'WORKSPACE ACCESS' : 'SECURE SIGN IN'}</span>
          <h2>{identityAuthenticated ? 'One last step' : 'Welcome to ArchThread'}</h2>
          <p className="login-description">
            {identityAuthenticated
              ? `Signed in as ${identityEmail}. Enter the workspace password to continue.`
              : 'Verify your identity with Google or receive a one-time sign-in link by email.'}
          </p>

          {loading ? (
            <div className="login-loading" aria-label="Checking your session">
              <Skeleton style={{ height: 44, marginBottom: 12 }} />
              <Skeleton style={{ height: 44 }} />
            </div>
          ) : identityAuthenticated ? (
            <form className="login-auth-form" onSubmit={enterWorkspace}>
              <Label className="login-field">
                <span>Entry password</span>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoFocus
                />
              </Label>
              {error && <Alert className="login-message" variant="destructive">{error}</Alert>}
              <Button className="login-submit" type="submit" disabled={submitting} size="lg">
                {submitting ? 'Checking…' : 'Enter workspace'}
              </Button>
            </form>
          ) : (
            <>
              <a
                className="login-provider-button ui-button ui-button-outline ui-button-lg"
                href={`/api/auth/google/start?from=${encodeURIComponent(returnTo)}`}
              >
                <span className="login-google-mark" aria-hidden="true">G</span>
                Continue with Google
              </a>
              <div className="login-divider"><span>or use a magic link</span></div>
              <form className="login-auth-form" onSubmit={requestMagicLink}>
                <Label className="login-field">
                  <span>Email address</span>
                  <Input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </Label>
                {error && <Alert className="login-message" variant="destructive">{error}</Alert>}
                {notice && <Alert className="login-message" variant="success">{notice}</Alert>}
                <Button className="login-submit" type="submit" disabled={submitting} size="lg">
                  {submitting ? 'Sending link…' : 'Email me a sign-in link'}
                </Button>
              </form>
            </>
          )}
          <p className="login-session-note">
            Identity verification is followed by a separate workspace password check.
          </p>
        </Card>
      </section>
    </main>
  );
}
