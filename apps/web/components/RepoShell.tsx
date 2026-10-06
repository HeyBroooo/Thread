'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RepositoryPayload } from '@/lib/api';

const TABS = [
  { key: '', label: 'Overview' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'chat', label: 'Chat' },
  { key: 'prs', label: 'Pull Requests' },
] as const;

export function RepoShell({
  repository,
  children,
}: {
  repository: RepositoryPayload;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const base = `/repositories/${repository.id}`;

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
            <span className="pill">{repository.branch}</span>
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
  return <span className={`pill ${cls}`}>{status}</span>;
}
