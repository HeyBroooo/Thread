'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { AnimatePresence, motion } from 'framer-motion';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Input } from './input';

export function ConnectCard() {
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
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

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const url = repoUrl.trim();
    const canUseParts = owner.trim() && name.trim();
    if (!url && !canUseParts) return;
    setConnecting(true);
    setConnectStage('cloning');
    setAccess(null);
    setError(null);
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
          ? { owner: owner.trim(), name: name.trim(), ...(branch.trim() ? { branch: branch.trim() } : {}) }
          : { repoUrl: url }),
        ...(branch.trim() && url ? { branch: branch.trim() } : {}),
        ...(checkoutPath.trim() ? { checkoutPath: checkoutPath.trim() } : {}),
      });
      setRepoUrl('');
      setOwner('');
      setName('');
      setBranch('');
      setCheckoutPath('');
      setConnectStage('done');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setConnecting(false);
      setTimeout(() => setConnectStage(null), 1200);
    }
  }

  return (
    <Card className="connect-card">
      <CardHeader>
        <CardTitle>Connect a repository</CardTitle>
        <p className="text-xs text-muted-foreground">
          Paste a GitHub URL — we clone it and build the graph. No browser crawl, ever.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={connect} className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-[2] flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Repository URL</span>
              <Input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/HeyBroooo/cognimail"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Branch (optional)</span>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Use repository default" />
            </label>
            <Button type="submit" disabled={connecting}>
              {connecting ? (connectStage === 'checking' ? 'Checking access…' : 'Cloning…') : 'Connect'}
            </Button>
          </div>

          <details className="connect-details">
            <summary className="text-xs text-muted-foreground connect-summary">
              Advanced — existing checkout or manual owner/name
            </summary>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Owner</span>
                <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="acme" />
              </label>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Repository</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="patient-portal" />
              </label>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Local checkout path (optional)</span>
                <Input
                  value={checkoutPath}
                  onChange={(e) => setCheckoutPath(e.target.value)}
                  placeholder="C:\\code\\patient-portal"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Without a checkout path the API clones into <code>.cbi/checkouts</code>. If the repository is
              private, install the GitHub App on it first.
            </p>
          </details>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AnimatePresence>
          {connectStage && (
            <motion.p
              className="text-xs text-muted-foreground"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
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
            >
              <Alert variant="warning">
                <AlertDescription>
                  {access.message}
                  {access.requiresInstall && (
                    <div className="mt-2">
                      <Button asChild size="sm">
                        <a href="https://github.com/settings/installations" target="_blank" rel="noreferrer">
                          Grant access to {access.owner}/{access.name}
                        </a>
                      </Button>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
