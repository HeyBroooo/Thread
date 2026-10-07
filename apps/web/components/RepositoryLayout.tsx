'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-9 w-72" />
          </div>
        </header>
        <main className="repo-main">
          <div className="section space-y-4">
            <Skeleton className="h-8 w-44" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((tile) => (
                <Skeleton key={tile} className="h-24" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!repository) {
    return (
      <main className="section flex min-h-[50vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertDescription>{error || 'Repository not found.'}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <RepositoryContext.Provider value={{ repository, job, refresh, setRepository, setJob }}>
      <RepoShell repository={repository} onRepositoryChange={setRepository} onJobChange={setJob}>
        {children}
      </RepoShell>
    </RepositoryContext.Provider>
  );
}
