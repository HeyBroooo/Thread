'use client';

import { useRepositoryContext } from '@/components/RepositoryLayout';
import { CanvasWorkspace } from '@/components/CanvasWorkspace';

export default function CanvasPage() {
  const { repository } = useRepositoryContext();

  return (
    <CanvasWorkspace
      repositoryId={repository.id}
      repositoryBranch={repository.branch}
      indexStatus={repository.indexStatus}
      status="full repository"
    />
  );
}
