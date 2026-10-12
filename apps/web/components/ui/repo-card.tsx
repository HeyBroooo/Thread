'use client';

import Link from 'next/link';
import { StatusPill } from '@/components/RepoShell';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { Card, CardContent, CardFooter, CardHeader } from './card';
import { Progress } from './progress';

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
    <Card className="repo-card h-full overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4 pb-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/repositories/${repo.id}/canvas`}
            className="text-base font-bold text-foreground transition-colors hover:text-primary hover:underline decoration-2 underline-offset-2"
          >
            {repo.owner}/{repo.name}
          </Link>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
              branch: {repo.branch}
            </span>
            {job?.nodesCreated ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                {job.nodesCreated} nodes
              </span>
            ) : null}
            {job?.edgesCreated ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                {job.edgesCreated} relationships
              </span>
            ) : null}
            {repo.indexedCommitSha ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                commit {repo.indexedCommitSha.slice(0, 8)}
              </span>
            ) : null}
            {repo.parserVersion ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                parser {repo.parserVersion}
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill status={repo.indexStatus} />
      </CardHeader>

      {repo.error && (
        <CardContent className="pt-0 pb-4">
          <Alert variant="destructive" className="px-4 py-3 rounded-lg">
            <AlertDescription className="text-xs font-medium">{repo.error}</AlertDescription>
          </Alert>
        </CardContent>
      )}

      {running && job && (
        <CardContent className="space-y-3 pt-0 pb-4">
          <Progress value={job.progress ?? 0} className="h-2" />
          <p className="text-xs font-medium text-muted-foreground">
            {job.stage} · {job.progress}%
            {job.filesTotal && job.filesTotal > 0 ? ` · ${job.filesProcessed}/${job.filesTotal} files` : ''}
          </p>
        </CardContent>
      )}

      <CardFooter className="mt-auto flex-wrap gap-2 pt-4 border-t border-border/50">
        <Button type="button" size="sm" onClick={() => onReindex(repo.id)} disabled={running}>
          {repo.indexedCommitSha ? 'Re-index' : 'Index'}
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/repositories/${repo.id}/canvas`}>Canvas</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/repositories/${repo.id}/chat`}>Chat</Link>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="ml-auto"
          onClick={() => onDelete(repo.id)}
        >
          Remove
        </Button>
      </CardFooter>
    </Card>
  );
}
