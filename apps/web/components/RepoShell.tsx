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
import { cn } from '@/lib/utils';

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
            <Button
              asChild
              variant="outline"
              size="icon"
              className="shrink-0"
            >
              <Link href="/" aria-label="Back to repositories" title="Back to repositories">
                <ArrowLeft aria-hidden="true" />
              </Link>
            </Button>
            <strong className="max-w-[34vw] truncate text-sm font-semibold">
              {repository.owner}/{repository.name}
            </strong>
            <form className="flex items-center gap-2" onSubmit={switchBranch}>
              <label className="sr-only" htmlFor="active-branch">Active branch</label>
              <Input
                id="active-branch"
                aria-label="Active branch"
                className="h-8 w-40"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                maxLength={255}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={switching || !branch.trim() || branch.trim() === repository.branch}
              >
                {switching ? 'Switching…' : 'Switch'}
              </Button>
            </form>
            <StatusPill status={repository.indexStatus} />
          </div>
          <nav className="flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
            {TABS.map((tab) => {
              const href = tab.key ? `${base}/${tab.key}` : base;
              const active = pathname === href;
              return (
                <Link
                  key={tab.key}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground',
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {branchError && (
          <Alert variant="destructive" className="mx-auto mt-2 max-w-[1440px]">
            <AlertDescription>{branchError}</AlertDescription>
          </Alert>
        )}
      </header>
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
