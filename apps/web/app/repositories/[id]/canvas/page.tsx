'use client';

import { useParams } from 'next/navigation';
import { useRepository } from '@/lib/useRepository';
import { RepoShell } from '@/components/RepoShell';
import { CanvasWorkspace } from '@/components/CanvasWorkspace';

export default function CanvasPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { repository, loading } = useRepository(id);

  if (loading || !repository) {
    return (
      <div className="app">
        <p className="muted">Loading repository…</p>
      </div>
    );
  }

  return (
    <RepoShell repository={repository}>
      <CanvasWorkspace repositoryId={id} indexStatus={repository.indexStatus} status="full repository" />
    </RepoShell>
  );
}
