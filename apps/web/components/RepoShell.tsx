'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type JobPayload, type RepositoryPayload } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const TABS = [
  { key: '', label: 'Overview' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'chat', label: 'Chat' },
  { key: 'prs', label: 'Pull Requests' },
] as const;

export function RepoShell({
  repository,
  onRepositoryChange,
  onJobChange,
  children,
}: {
  repository: RepositoryPayload;
  onRepositoryChange: (repository: RepositoryPayload) => void;
  onJobChange: (job: JobPayload | null) => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const base = `/repositories/${repository.id}`;
  const [branch, setBranch] = useState(repository.branch);
  const [switching, setSwitching] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  useEffect(() => setBranch(repository.branch), [repository.branch]);

  async function switchBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedBranch = branch.trim();
    if (!requestedBranch || requestedBranch === repository.branch) return;
    setSwitching(true);
    setBranchError(null);
    try {
      const result = await api.switchBranch(repository.id, requestedBranch);
      onRepositoryChange(result.repository);
      onJobChange(result.job);
    } catch (cause) {
      setBranchError(cause instanceof Error ? cause.message : 'Could not switch branches.');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="repo-shell">
      <header className="repo-header">
        <div className="repo-header-inner">
          <div className="repo-title">
            <Link href="/" className="back-link" title="Back to repositories" aria-label="Back to repositories">
              <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            </Link>
            <strong>
              {repository.owner}/{repository.name}
            </strong>
            <form className="branch-switcher" onSubmit={switchBranch}>
              <label className="sr-only" htmlFor="active-branch">Active branch</label>
              <Input
                id="active-branch"
                aria-label="Active branch"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                maxLength={255}
              />
              <Button type="submit" size="sm" variant="outline" disabled={switching || !branch.trim() || branch.trim() === repository.branch}>
                {switching ? 'Switching…' : 'Switch'}
              </Button>
            </form>
            <StatusPill status={repository.indexStatus} />
          </div>
          <nav className="tabs">
            {TABS.map((tab) => {
              const href = tab.key ? `${base}/${tab.key}` : base;
              const active = pathname === href;
              return (
                <Link key={tab.key} href={href} className={active ? 'tab active' : 'tab'}>
                  {active && (
                    <motion.span
                      className="tab-indicator"
                      layoutId="tab-indicator"
                      transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                    />
                  )}
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {branchError && <p className="error small branch-error" role="alert">{branchError}</p>}
      </header>
      <main className="repo-main">{children}</main>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'READY'
      ? 'status-ready'
      : status === 'FAILED'
        ? 'status-failed'
        : status === 'STALE'
          ? 'status-stale'
          : 'status-running';
  return <Badge variant="secondary" className={`pill ${cls}`}>{status}</Badge>;
}
