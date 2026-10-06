import { OpenRouterProvider } from '@cbi/ai';
import { createGraphStore } from '@cbi/graph';
import { DiskSourceRegistry, createLogger, getConfig } from '@cbi/shared';
import { GitHubClient } from '@cbi/github';
import { runReviewJob } from './pipeline.js';

const log = createLogger({ component: 'pr-reviewer.worker' });

/**
 * PR reviewer worker.
 *
 * Usage:
 *   tsx workers/pr-reviewer/src/index.ts --repository <id> --owner <o> --repo <r> --pr <n> --head <sha> [--checkout <path>]
 *
 * In production this consumes the PR queue. Locally it reviews one PR so the
 * whole loop can be exercised end to end.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repositoryId = arg(args, '--repository');
  const owner = arg(args, '--owner');
  const repo = arg(args, '--repo');
  const prNumber = Number(arg(args, '--pr') ?? '0');
  const headSha = arg(args, '--head');
  const checkout = arg(args, '--checkout');

  if (!repositoryId || !owner || !repo || !prNumber || !headSha) {
    log.info('reviewer.worker_idle', {
      note: 'Provide --repository --owner --repo --pr --head. Consumes the PR queue in production.',
      database: Boolean(getConfig().databaseUrl),
    });
    return;
  }

  const store = createGraphStore();
  await store.init();

  const client = new GitHubClient({
    appId: getConfig().github.appId ?? undefined,
    privateKey: getConfig().github.privateKey ?? undefined,
  });
  const sources = checkout ? new DiskSourceRegistry(checkout) : new DiskSourceRegistry(process.cwd());

  const ai = getConfig().ai.apiKey ? new OpenRouterProvider() : undefined;

  const result = await runReviewJob({
    repositoryId,
    owner,
    repo,
    pullRequestNumber: prNumber,
    title: `PR #${prNumber}`,
    baseSha: null,
    headSha,
    store,
    sources,
    github: client,
    appUrl: getConfig().appUrl,
    ...(ai ? { ai } : {}),
  });

  process.stdout.write(
    [
      '',
      `Review for ${owner}/${repo}#${prNumber}`,
      `  findings posted: ${result.postedFindings}`,
      `  inline comments: ${result.inlineCommentIds.length}`,
      `  ai status:       ${result.outcome.aiStatus}`,
      '',
    ].join('\n'),
  );

  await store.close();
}

function arg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

main().catch((e) => {
  log.error('reviewer.worker_failed', { message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});

export * from './pipeline.js';
