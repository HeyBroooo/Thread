'use client';

import Link from 'next/link';
import { StatusPill } from '@/components/RepoShell';
import { GlareCard } from './glare-card';
import { Button } from './button';

interface RepoCardProps {
  repo: {
    id: string;
    owner: string;
    name: string;
    branch: string;
    indexStatus: string;
    indexedCommitSha?: string | null;
    parserVersion?: string | null;
    error?: string | null;
    latestJob?: {
      nodesCreated?: number;
      edgesCreated?: number;
      progress?: number;
      stage?: string;
      filesProcessed?: number;
      filesTotal?: number;
    } | null;
  };
  onReindex: (id: string) => void;
  onDelete: (id: string) => void;
}

export function RepoCard({ repo, onReindex, onDelete }: RepoCardProps) {
  const job = repo.latestJob;
  const running = repo.indexStatus === 'INDEXING' || repo.indexStatus === 'QUEUED';

  return (
    <GlareCard className="repo-card">
      <div className="repo-card-content">
        <div className="repo-card-header">
          <Link href={`/repositories/${repo.id}/canvas`} className="repo-card-link">
            {repo.owner}/{repo.name}
          </Link>
          <StatusPill status={repo.indexStatus} />
        </div>
        <div className="repo-card-meta">
          <span>branch: {repo.branch}</span>
          {job?.nodesCreated && job.nodesCreated > 0 && <span>{job.nodesCreated} nodes</span>}
          {job?.edgesCreated && job.edgesCreated > 0 && <span>{job.edgesCreated} relationships</span>}
          {repo.indexedCommitSha && <span>commit {repo.indexedCommitSha.slice(0, 8)}</span>}
          {repo.parserVersion && <span>parser {repo.parserVersion}</span>}
          {repo.error && <span className="error">{repo.error}</span>}
        </div>
        {running && job && (
          <>
            <div className="progress">
              <div style={{ width: `${job.progress}%` }} />
            </div>
            <div className="muted small">
              {job.stage} · {job.progress}%
              {job.filesTotal && job.filesTotal > 0 ? ` · ${job.filesProcessed}/${job.filesTotal} files` : ''}
            </div>
          </>
        )}
      </div>
      <div className="repo-card-actions">
        <Button type="button" onClick={() => onReindex(repo.id)} disabled={running} size="sm">
          {repo.indexedCommitSha ? 'Re-index' : 'Index'}
        </Button>
        <Link href={`/repositories/${repo.id}/canvas`}>
          <span className="ui-button ui-button-outline ui-button-sm repo-card-link-btn">Canvas</span>
        </Link>
        <Link href={`/repositories/${repo.id}/chat`}>
          <span className="ui-button ui-button-outline ui-button-sm repo-card-link-btn">Chat</span>
        </Link>
        <Button type="button" variant="destructive" size="sm" className="repo-card-link-btn" onClick={() => onDelete(repo.id)}>
          Remove
        </Button>
      </div>
    </GlareCard>
  );
}
