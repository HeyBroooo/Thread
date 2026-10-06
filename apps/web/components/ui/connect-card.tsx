'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RepositoryPayload } from '@/lib/api';
import { AnimatePresence, motion } from 'framer-motion';
import { GlareCard } from './glare-card';
import { ShimmerButton } from './shimmer-button';

export function ConnectCard() {
  const [repositories, setRepositories] = useState<RepositoryPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [checkoutPath, setCheckoutPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [connectStage, setConnectStage] = useState<'checking' | 'cloning' | 'done' | null>(null);
  const [access, setAccess] = useState<{
    owner: string;
    name: string;
    appConfigured: boolean;
    accessible: boolean | null;
    requiresInstall: boolean;
    message: string;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listRepositories();
      setRepositories(data.repositories);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const url = repoUrl.trim();
    const canUseParts = owner.trim() && name.trim();
    if (!url && !canUseParts) return;
    setConnecting(true);
    setConnectStage('cloning');
    setAccess(null);
    try {
      if (url) {
        setConnectStage('checking');
        try {
          setAccess(await api.checkAccess(url));
        } catch {
          setAccess(null);
        }
      }
      setConnectStage('cloning');
      await api.createRepository({
        ...(canUseParts
          ? { owner: owner.trim(), name: name.trim(), branch: branch.trim() || 'main' }
          : { repoUrl: url }),
        ...(checkoutPath.trim() ? { checkoutPath: checkoutPath.trim() } : {}),
      });
      setRepoUrl('');
      setOwner('');
      setName('');
      setCheckoutPath('');
      setConnectStage('done');
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setConnecting(false);
      setTimeout(() => setConnectStage(null), 1200);
    }
  }

  return (
    <GlareCard className="connect-card">
      <div className="card-header">
        <div>
          <h2>Connect a repository</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Paste a GitHub URL — we clone it and build the graph. No browser crawl, ever.
          </p>
        </div>
      </div>
      <form onSubmit={connect} className="connect-form">
        <div className="form-row">
          <label className="form-field" style={{ flex: 2 }}>
            <span className="label">Repository URL</span>
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/HeyBroooo/cognimail"
              className="connect-input"
            />
          </label>
          <label className="form-field" style={{ flex: 1 }}>
            <span className="label">Branch (optional)</span>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" className="connect-input" />
          </label>
          <ShimmerButton type="submit" disabled={connecting} className="connect-btn">
            {connecting ? (connectStage === 'checking' ? 'Checking access…' : 'Cloning…') : 'Connect'}
          </ShimmerButton>
        </div>
        <details className="connect-details">
          <summary className="muted small connect-summary">
            Advanced — existing checkout or manual owner/name
          </summary>
          <div className="form-row" style={{ marginTop: 10 }}>
            <label className="form-field">
              <span className="label">Owner</span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="acme" className="connect-input" />
            </label>
            <label className="form-field">
              <span className="label">Repository</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="patient-portal" className="connect-input" />
            </label>
            <label className="form-field" style={{ flex: 1 }}>
              <span className="label">Local checkout path (optional)</span>
              <input
                value={checkoutPath}
                onChange={(e) => setCheckoutPath(e.target.value)}
                placeholder="C:\\code\\patient-portal"
                style={{ width: '100%' }}
                className="connect-input"
              />
            </label>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Without a checkout path the API clones into <code>.cbi/checkouts</code>. If the repository is
            private, install the GitHub App on it first.
          </p>
        </details>
      </form>
      <AnimatePresence>
        {connectStage && (
          <motion.p
            className="muted small"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ marginTop: 12 }}
          >
            {connectStage === 'checking'
              ? 'Checking whether the GitHub App can access this repository…'
              : connectStage === 'cloning'
                ? 'Cloning the repository and building the graph — this runs in the background.'
                : 'Connected. The graph is building — the repository updates as indexing progresses.'}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {access && access.accessible === false && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="access-warning"
          >
            <p className="small" style={{ margin: 0, color: '#fde68a' }}>
              {access.message}
            </p>
            {access.requiresInstall && (
              <a
                className="btn-primary access-btn"
                href={`https://github.com/settings/installations`}
                target="_blank"
                rel="noreferrer"
              >
                Grant access to {access.owner}/{access.name}
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </GlareCard>
  );
}
