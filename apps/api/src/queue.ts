import { createLogger, uuid, type IndexStage } from '@cbi/shared';

const log = createLogger({ component: 'queue' });

export type JobKind = 'index' | 'review';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface JobRecord {
  id: string;
  kind: JobKind;
  repositoryId: string;
  status: JobStatus;
  stage: IndexStage;
  progress: number;
  filesProcessed: number;
  filesTotal: number;
  nodesCreated: number;
  edgesCreated: number;
  requestId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  payload: Record<string, unknown>;
  result: unknown;
}

type JobHandler = (job: JobRecord, update: (patch: Partial<JobRecord>) => void) => Promise<unknown>;

const MAX_KEEP = 200;

/**
 * In-process job queue (doc §127: webhooks must not do heavy work inline).
 *
 * Production swaps this for a Redis-backed queue with the same surface; the
 * worker processes consume from the broker instead of this process.
 */
export class JobQueue {
  private jobs = new Map<string, JobRecord>();
  private order: string[] = [];
  private handlers = new Map<JobKind, JobHandler>();
  private running = 0;
  private concurrency: number;

  constructor(options: { concurrency?: number } = {}) {
    this.concurrency = options.concurrency ?? 2;
  }

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  enqueue(kind: JobKind, repositoryId: string, payload: Record<string, unknown> = {}, requestId?: string): JobRecord {
    const job: JobRecord = {
      id: `job_${uuid()}`,
      kind,
      repositoryId,
      status: 'QUEUED',
      stage: 'QUEUED',
      progress: 0,
      filesProcessed: 0,
      filesTotal: 0,
      nodesCreated: 0,
      edgesCreated: 0,
      requestId: requestId ?? null,
      startedAt: null,
      completedAt: null,
      error: null,
      payload,
      result: null,
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    this.trim();
    log.info('job.enqueued', { jobId: job.id, kind, repositoryId });
    void this.pump();
    return job;
  }

  get(id: string): JobRecord | null {
    return this.jobs.get(id) ?? null;
  }

  list(repositoryId?: string): JobRecord[] {
    const all = this.order.map((id) => this.jobs.get(id)!).filter(Boolean);
    const filtered = repositoryId ? all.filter((j) => j.repositoryId === repositoryId) : all;
    return filtered.reverse().slice(0, 50);
  }

  latest(repositoryId: string, kind?: JobKind): JobRecord | null {
    return this.list(repositoryId).find((j) => !kind || j.kind === kind) ?? null;
  }

  removeRepositoryJobs(repositoryId: string): boolean {
    if (this.list(repositoryId).some((job) => job.status === 'RUNNING')) return false;
    const removed = new Set(this.list(repositoryId).map((job) => job.id));
    this.order = this.order.filter((id) => !removed.has(id));
    for (const id of removed) this.jobs.delete(id);
    return true;
  }

  private trim(): void {
    while (this.order.length > MAX_KEEP) {
      const id = this.order.shift();
      if (id) this.jobs.delete(id);
    }
  }

  private async pump(): Promise<void> {
    if (this.running >= this.concurrency) return;
    const next = this.order
      .map((id) => this.jobs.get(id)!)
      .find((j) => j && j.status === 'QUEUED');
    if (!next) return;
    this.running++;
    next.status = 'RUNNING';
    next.startedAt = new Date().toISOString();
    const update = (patch: Partial<JobRecord>) => Object.assign(next, patch);
    try {
      const handler = this.handlers.get(next.kind);
      if (!handler) throw new Error(`No handler registered for job kind ${next.kind}`);
      next.result = await handler(next, update);
      next.status = 'COMPLETED';
      next.progress = 100;
      next.stage = 'READY';
      next.completedAt = new Date().toISOString();
      log.info('job.completed', { jobId: next.id, kind: next.kind, repositoryId: next.repositoryId });
    } catch (e) {
      next.status = 'FAILED';
      next.stage = 'FAILED';
      next.error = e instanceof Error ? e.message : String(e);
      next.completedAt = new Date().toISOString();
      log.error('job.failed', { jobId: next.id, kind: next.kind, message: next.error });
    } finally {
      this.running--;
      void this.pump();
    }
  }
}

export const jobQueue = new JobQueue({ concurrency: 2 });
