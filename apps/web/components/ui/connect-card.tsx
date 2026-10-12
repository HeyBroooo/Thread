'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { AnimatePresence, motion } from 'framer-motion';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Input } from './input';
import { Label } from './label';
import { ChevronDown, Loader2 } from 'lucide-react';

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
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    <motion.div
      initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="connect-shell"
    >
      <Card className="lp-connect-card w-full border-border/80 shadow-lg">
        <CardHeader className="gap-2 pb-5">
          <CardTitle className="text-[22px] font-bold tracking-[-0.025em]">
            Connect a repository
          </CardTitle>
          <CardDescription className="text-[15px] leading-relaxed">
            Paste a GitHub URL — we clone it and build the graph. No browser crawl, ever.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-0">
          <form onSubmit={connect} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-[2_1_240px] flex-col gap-2">
                <Label htmlFor="connect-repo-url" className="text-sm font-semibold">Repository URL</Label>
                <Input
                  id="connect-repo-url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/HeyBroooo/cognimail"
                  autoComplete="off"
                  className="h-11"
                />
              </div>
              <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-2">
                <Label htmlFor="connect-branch" className="text-sm font-semibold">Branch (optional)</Label>
                <Input
                  id="connect-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="Use repository default"
                  autoComplete="off"
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                disabled={connecting}
                className="h-11 shrink-0 px-6 font-semibold shadow-md"
              >
                {connecting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    {connectStage === 'checking' ? 'Checking…' : 'Cloning…'}
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>

            {/* Advanced: existing checkout or manual owner/name */}
            <div className="overflow-hidden rounded-lg border border-border bg-muted">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setAdvancedOpen((v) => !v)}
                aria-expanded={advancedOpen}
              >
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 transition-transform duration-200"
                  style={{ transform: advancedOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
                <span>Advanced</span>
                <span className="font-normal text-muted-foreground/70">
                  — existing checkout or manual owner/name
                </span>
              </button>

              <AnimatePresence initial={false}>
                {advancedOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap gap-3 px-3.5 pb-3.5 pt-1">
                      <div className="flex min-w-0 flex-[1_1_140px] flex-col gap-1.5">
                        <Label htmlFor="connect-owner">Owner</Label>
                        <Input
                          id="connect-owner"
                          value={owner}
                          onChange={(e) => setOwner(e.target.value)}
                          placeholder="acme"
                          autoComplete="off"
                        />
                      </div>
                      <div className="flex min-w-0 flex-[1_1_140px] flex-col gap-1.5">
                        <Label htmlFor="connect-name">Repository</Label>
                        <Input
                          id="connect-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="patient-portal"
                          autoComplete="off"
                        />
                      </div>
                      <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-1.5">
                        <Label htmlFor="connect-checkout">Local checkout path (optional)</Label>
                        <Input
                          id="connect-checkout"
                          value={checkoutPath}
                          onChange={(e) => setCheckoutPath(e.target.value)}
                          placeholder="C:\code\patient-portal"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <p className="m-0 px-3.5 pb-3.5 text-xs leading-relaxed text-muted-foreground">
                      Without a checkout path the API clones into <code>.cbi/checkouts</code>. If the
                      repository is private, install the GitHub App on it first.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </form>

          {error ? (
            <Alert variant="destructive" className="mt-3.5 px-3 py-2.5">
              <AlertDescription className="text-[13px]">{error}</AlertDescription>
            </Alert>
          ) : null}

          <AnimatePresence initial={false}>
            {connectStage ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-3.5 text-xs text-muted-foreground"
              >
                {connectStage === 'checking'
                  ? 'Checking whether the GitHub App can access this repository…'
                  : connectStage === 'cloning'
                    ? 'Cloning the repository and building the graph — this runs in the background.'
                    : 'Connected. The graph is building — the repository updates as indexing progresses.'}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {access && access.accessible === false ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <Alert variant="warning" className="mt-3">
                  <AlertDescription className="text-[13px]">
                    {access.message}
                    {access.requiresInstall ? (
                      <a
                        href="https://github.com/settings/installations"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2.5 inline-flex"
                      >
                        <Button type="button" size="sm">
                          Grant access to {access.owner}/{access.name}
                        </Button>
                      </a>
                    ) : null}
                  </AlertDescription>
                </Alert>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
