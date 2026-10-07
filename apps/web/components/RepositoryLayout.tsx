'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { RepoShell } from '@/components/RepoShell';
import { useRepository } from '@/lib/useRepository';
import type { JobPayload, RepositoryPayload } from '@/lib/api';

interface RepositoryContextValue {
  repository: RepositoryPayload;
  job: JobPayload | null;
  refresh: () => Promise<void>;
  setRepository: (repository: RepositoryPayload) => void;
  setJob: (job: JobPayload | null) => void;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function useRepositoryContext(): RepositoryContextValue {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error('Repository pages must be rendered inside RepositoryLayout.');
  return context;
}

export function RepositoryLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { repository, job, loading, error, refresh, setRepository, setJob } = useRepository(id);

  if (loading) {
    return (
      <div className="repo-shell" aria-label="Loading repository">
        <header className="repo-header">
          <div className="repo-header-inner">
            <div className="skeleton" style={{ height: 18, width: 220 }} />
            <div className="skeleton" style={{ height: 34, width: 300 }} />
          </div>
        </header>
        <main className="repo-main">
          <div className="section">
            <div className="skeleton" style={{ height: 28, width: 180, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 140, width: '100%' }} />
          </div>
        </main>
      </div>
    );
  }

  if (!repository) {
    return <main className="section">{error || 'Repository not found.'}</main>;
  }

  return (
    <RepositoryContext.Provider value={{ repository, job, refresh, setRepository, setJob }}>
      <RepoShell repository={repository} onRepositoryChange={setRepository} onJobChange={setJob}>
        {children}
      </RepoShell>
    </RepositoryContext.Provider>
  );
}
