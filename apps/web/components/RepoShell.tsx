'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type JobPayload, type RepositoryPayload } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SessionControls } from '@/components/SessionControls';

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
          <form onSubmit={switchBranch} className="repo-header-main">
            <Button asChild variant="outline" size="icon" className="repo-back-btn">
              <Link href="/dashboard" aria-label="Back to repositories" title="Back to repositories">
                <ArrowLeft aria-hidden="true" />
              </Link>
            </Button>
            <strong className="repo-name">
              {repository.owner}/{repository.name}
            </strong>
            <StatusPill status={repository.indexStatus} />
            <label htmlFor="active-branch" className="sr-only">Active branch</label>
            <Input
              id="active-branch"
              aria-label="Active branch"
              className="repo-branch-input"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              maxLength={255}
              disabled={repository.id === 'demo'}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={repository.id === 'demo' || switching || !branch.trim() || branch.trim() === repository.branch}
              className="repo-switch-btn"
            >
              {switching ? 'Switching…' : 'Switch'}
            </Button>
          </form>
          <div className="repo-header-actions">
            <nav className="repo-tabs">
              {TABS.map((tab) => {
                const href = tab.key ? `${base}/${tab.key}` : base;
                const active = pathname === href;
                return (
                  <Link key={tab.key} href={href} aria-current={active ? 'page' : undefined}>
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
            <SessionControls variant="inline" />
          </div>
        </div>
        {branchError && (
          <Alert variant="destructive" className="mx-auto mt-2 max-w-[1440px]">
            <AlertDescription>{branchError}</AlertDescription>
          </Alert>
        )}
      </header>
      {repository.id === 'demo' && <div className="sample-banner"><span>Sample workspace · Illustrative data · Read-only</span><Link href="/dashboard#connect">Connect your repository →</Link></div>}
      <main className="repo-main">{children}</main>
    </div>
  );
}

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  READY: 'success',
  FAILED: 'destructive',
  STALE: 'warning',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'secondary'} className="repo-status-pill">
      {status}
    </Badge>
  );
}
