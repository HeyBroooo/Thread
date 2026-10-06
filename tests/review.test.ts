import { afterEach, describe, expect, it } from 'vitest';
import { DiskSourceRegistry } from '@cbi/shared';
import type { AIProvider, AIRequest, AIResult } from '@cbi/ai';
import type {
  GitHubApi,
  GitHubChangedFile,
  GitHubCompareResult,
  GitHubPullRequest,
  GitHubRepo,
  PullRequestCommentInput,
  ReviewCommentInput,
} from '@cbi/github';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { postReviewToGitHub, reviewPullRequest, parseUnifiedDiff, detectVersionBumps } from '@cbi/reviewer';
import { cloneFixture, indexFixture } from './helpers.js';

/** The fixture file with the PR's added lines actually present on disk. */
const MODIFIED_BUTTON = `import { cn } from '@/lib/utils';
import { dischargePatient } from '@/services/patientService';
const LEAKED_KEY = "sk-abcdefghijklmnopqrstuvwxyz012345";
const RETRY_LIMIT = 3;

export interface DischargeButtonProps {
  patientId: string;
  disabled?: boolean;
}

export function DischargeButton({ patientId, disabled }: DischargeButtonProps) {
  const handleDischarge = async () => {
    await dischargePatient(patientId);
  };

  return (
    <button type="button" className={cn('btn', 'btn-primary')} disabled={disabled} onClick={handleDischarge}>
      Discharge patient
    </button>
  );
}
`;

const DIFF = `diff --git a/src/components/patient/DischargeButton.tsx b/src/components/patient/DischargeButton.tsx
index 1111111..2222222 100644
--- a/src/components/patient/DischargeButton.tsx
+++ b/src/components/patient/DischargeButton.tsx
@@ -1,3 +1,5 @@
 import { cn } from '@/lib/utils';
 import { dischargePatient } from '@/services/patientService';
+const LEAKED_KEY = "sk-abcdefghijklmnopqrstuvwxyz012345";
+const RETRY_LIMIT = 3;
 
`;

class FakeProvider implements AIProvider {
  readonly id = 'fake';
  readonly defaultModel = 'fake-model';
  constructor(private response: string) {}
  async complete(_request: AIRequest): Promise<AIResult> {
    return { text: this.response, model: this.defaultModel, usage: {} };
  }
}

class MockGitHub implements GitHubApi {
  comments: ReviewCommentInput[] = [];
  issueComments: PullRequestCommentInput[] = [];

  async getRepository(): Promise<GitHubRepo> {
    return { id: 1, owner: 'acme', name: 'patient-portal', defaultBranch: 'main', private: true, language: 'TypeScript' };
  }
  async listInstallationRepositories(): Promise<GitHubRepo[]> {
    return [await this.getRepository()];
  }
  async getPullRequest(): Promise<GitHubPullRequest> {
    return {
      number: 42,
      title: 'Add discharge flow',
      author: 'dev',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      baseBranch: 'main',
      headBranch: 'feature/discharge',
      state: 'open',
      draft: false,
      body: null,
    };
  }
  async getPullRequestDiff(): Promise<string> {
    return DIFF;
  }
  async listPullRequests(): Promise<Array<{ number: number; title: string; author: string | null; state: string; draft: boolean; baseBranch: string; headBranch: string; baseSha: string; headSha: string; updatedAt: string; htmlUrl: string }>> {
    return [
      {
        number: 42,
        title: 'Add discharge flow',
        author: 'dev',
        state: 'open',
        draft: false,
        baseBranch: 'main',
        headBranch: 'feature/discharge',
        baseSha: 'base-sha',
        headSha: 'head-sha',
        updatedAt: new Date().toISOString(),
        htmlUrl: 'https://github.com/acme/patient-portal/pull/42',
      },
    ];
  }
  async compareCommits(): Promise<GitHubCompareResult> {
    return { baseSha: 'base-sha', headSha: 'head-sha', files: [] as GitHubChangedFile[] };
  }
  async getBranchHeadSha(): Promise<string> {
    return 'head-sha';
  }
  async listBranchNames(): Promise<string[]> {
    return ['main'];
  }
  async createReviewComment(_o: string, _r: string, _n: number, _c: string, comment: ReviewCommentInput): Promise<{ id: number }> {
    this.comments.push(comment);
    return { id: 1000 + this.comments.length };
  }
  async createIssueComment(_o: string, _r: string, _n: number, comment: PullRequestCommentInput): Promise<{ id: number }> {
    this.issueComments.push(comment);
    return { id: 9000 + this.issueComments.length - 1 };
  }
  async listIssueComments(): Promise<Array<{ id: number; body: string }>> {
    return this.issueComments.map((c, i) => ({ id: 9000 + i, body: c.body }));
  }
  async updateIssueComment(
    _o: string,
    _r: string,
    commentId: number,
    comment: PullRequestCommentInput,
  ): Promise<{ id: number }> {
    const index = commentId - 9000;
    this.issueComments[index] = comment;
    return { id: commentId };
  }
}

const AI_RESPONSE = JSON.stringify({
  findings: [
    {
      severity: 'high',
      category: 'security',
      file: 'src/components/patient/DischargeButton.tsx',
      line: 4,
      title: 'Retry limit is not configurable',
      explanation: 'The change hardcodes a retry limit at module scope, which is inconsistent with the project configuration approach.',
      suggestion: 'Read the retry limit from configuration.',
      confidence: 0.91,
      evidence: 'const RETRY_LIMIT = 3;',
    },
    {
      severity: 'high',
      category: 'architecture',
      file: 'src/components/patient/DoesNotExist.tsx',
      line: 10,
      title: 'Hallucinated file',
      explanation: 'This file does not exist in the repository.',
      confidence: 0.99,
    },
    {
      severity: 'medium',
      category: 'performance',
      file: 'src/hooks/usePatient.ts',
      line: 9999,
      title: 'Line out of range',
      explanation: 'Line 9999 does not exist in this file.',
      confidence: 0.9,
    },
  ],
  summary: 'Reviewed the discharge flow.',
});

async function runReview(aiResponse = AI_RESPONSE) {
  const { dir, cleanup } = cloneFixture();
  writeFileSync(join(dir, 'src/components/patient/DischargeButton.tsx'), MODIFIED_BUTTON, 'utf8');
  const { store, repositoryId } = await indexFixture(dir);
  const outcome = await reviewPullRequest(
    { store, sources: new DiskSourceRegistry(dir), ai: new FakeProvider(aiResponse) },
    {
      repositoryId,
      pullRequestNumber: 42,
      title: 'Add discharge flow',
      baseSha: 'base-sha',
      headSha: 'head-sha',
      diff: DIFF,
      conventions: [],
      graphIsPartial: false,
    },
  );
  cleanups.push(cleanup);
  return { outcome, store, repositoryId, cleanup };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('diff parsing', () => {
  it('extracts added and touched lines', () => {
    const parsed = parseUnifiedDiff(DIFF);
    expect(parsed.changedFiles).toEqual(['src/components/patient/DischargeButton.tsx']);
    expect([...parsed.addedLineSet.get(parsed.changedFiles[0]!)!].sort((a, b) => a - b)).toEqual([3, 4]);
  });
});

describe('PR review pipeline', () => {
  it('maps changed symbols and computes impact', async () => {
    const { outcome } = await runReview();
    expect(outcome.changedSymbols.changedFiles).toContain('src/components/patient/DischargeButton.tsx');
    // The added module-level constants are real changed symbols in the graph.
    const changedNames = outcome.changedSymbols.changedNodes.map((n) => n.name);
    expect(changedNames).toEqual(expect.arrayContaining(['LEAKED_KEY', 'RETRY_LIMIT']));
    expect(outcome.impact.nodes.length).toBeGreaterThan(0);
  });

  it('detects a hardcoded secret deterministically without exposing it', async () => {
    const { outcome } = await runReview();
    const security = outcome.deterministicFindings.find((f) => f.category === 'security');
    expect(security).toBeDefined();
    expect(security!.file).toBe('src/components/patient/DischargeButton.tsx');
    expect(security!.line).toBe(3);
    // The secret value must never appear in the finding text.
    expect(security!.explanation).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(JSON.stringify(security)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('accepts validated findings and discards hallucinated ones', async () => {
    const { outcome } = await runReview();
    expect(outcome.impact.truncated).toBe(false);
    const titles = outcome.accepted.map((f) => f.title);
    expect(titles).toContain('Retry limit is not configurable');
    expect(outcome.accepted.some((f) => f.category === 'security')).toBe(true);

    const rejectedTitles = outcome.rejected.map((r) => r.finding.title);
    expect(rejectedTitles).toContain('Hallucinated file');
    expect(rejectedTitles).toContain('Line out of range');
    expect(outcome.rejected.find((r) => r.finding.title === 'Hallucinated file')!.reason).toMatch(/not in indexed graph/);
  });

  it('never exceeds the noise budget', async () => {
    const { outcome } = await runReview();
    expect(outcome.accepted.length).toBeLessThanOrEqual(12);
  });
});

describe('posting to GitHub', () => {
  it('posts exactly one comment — no inline comments at all', async () => {
    const { outcome } = await runReview();
    const github = new MockGitHub();
    const posted = await postReviewToGitHub(github, {
      owner: 'acme',
      repo: 'patient-portal',
      pullRequestNumber: 42,
      commitId: 'head-sha',
      appUrl: 'https://thread.example.com/',
      findings: outcome.accepted,
      summary: outcome.summary,
      parsedDiff: outcome.parsedDiff,
      aiStatus: outcome.aiStatus,
    });

    expect(posted.inlineCommentIds).toEqual([]);
    expect(github.comments).toEqual([]);
    expect(github.issueComments).toHaveLength(1);
    expect(posted.summaryCommentId).toBe(9000);

    const body = github.issueComments[0]!.body;
    expect(body).toContain('Codebase Intelligence');
    expect(body).toContain('<img src="https://thread.example.com/logo-128.png"');
    expect(body).toContain('Automated pull request review');
    expect(body).toContain('GitHub still owns approval and merge');
    expect(body).toContain('| Severity | Location | Finding |');
    expect(body).toContain('| :--- | :--- | :--- |');
    expect(body).toContain('<details>');
    expect(body).not.toContain('🤖');

    const localGithub = new MockGitHub();
    await postReviewToGitHub(localGithub, {
      owner: 'acme',
      repo: 'patient-portal',
      pullRequestNumber: 42,
      commitId: 'head-sha',
      appUrl: 'http://localhost:3000',
      findings: outcome.accepted,
      summary: outcome.summary,
      parsedDiff: outcome.parsedDiff,
      aiStatus: outcome.aiStatus,
    });
    expect(localGithub.issueComments[0]!.body).toContain(
      '<img src="https://github.com/identicons/app/app/archthread"',
    );
  });

  it('edits the existing comment instead of adding a second one', async () => {
    const { outcome } = await runReview();
    const github = new MockGitHub();
    const base = {
      owner: 'acme',
      repo: 'patient-portal',
      pullRequestNumber: 42,
      appUrl: 'https://thread.example.com',
      findings: outcome.accepted,
      summary: outcome.summary,
      parsedDiff: outcome.parsedDiff,
      aiStatus: outcome.aiStatus,
    } as const;

    const first = await postReviewToGitHub(github, { ...base, commitId: 'head-sha' });
    expect(first.alreadyPosted).toBe(false);
    expect(github.issueComments).toHaveLength(1);

    // A second run — a later commit, or the webhook and the poller racing.
    const second = await postReviewToGitHub(github, { ...base, commitId: 'next-sha' });
    expect(second.alreadyPosted).toBe(true);
    expect(github.issueComments).toHaveLength(1);
    expect(second.summaryCommentId).toBe(first.summaryCommentId);
    // The single comment now describes the newer commit.
    expect(github.issueComments[0]!.body).toContain('next-sha');
  });

  it('posts a fresh comment when requested and updates that newest comment later', async () => {
    const { outcome } = await runReview();
    const github = new MockGitHub();
    const base = {
      owner: 'acme',
      repo: 'patient-portal',
      pullRequestNumber: 42,
      findings: outcome.accepted,
      summary: outcome.summary,
      parsedDiff: outcome.parsedDiff,
      aiStatus: outcome.aiStatus,
    } as const;

    const first = await postReviewToGitHub(github, { ...base, commitId: 'head-sha' });
    const fresh = await postReviewToGitHub(github, {
      ...base,
      commitId: 'fresh-sha',
      postNewComment: true,
    });

    expect(fresh.alreadyPosted).toBe(false);
    expect(fresh.summaryCommentId).not.toBe(first.summaryCommentId);
    expect(github.issueComments).toHaveLength(2);

    await postReviewToGitHub(github, { ...base, commitId: 'automatic-update-sha' });
    expect(github.issueComments).toHaveLength(2);
    expect(github.issueComments[0]!.body).toContain('head-sha');
    expect(github.issueComments[1]!.body).toContain('automatic-update-sha');
  });

  it('surfaces a failed AI review without failing the deterministic review', async () => {
    const { outcome } = await runReview('not json at all');
    expect(outcome.aiStatus).toBe('AI_REVIEW_FAILED');
    expect(outcome.accepted.some((f) => f.category === 'security')).toBe(true);
  });
});

/** Mirrors a real PR: an existing dependency's version line is replaced. */
const VERSION_DIFF = `diff --git a/package.json b/package.json
index 7cbb1ce..f730573 100644
--- a/package.json
+++ b/package.json
@@ -10,7 +10,7 @@
   "dependencies": {
     "react": "^19.0.0",
-    "react-dom": "^19.0.0",
+    "react-dom": "^67.0.0",
     "sonner": "^2.0.6",
   },
   "devDependencies": {
`;

describe('dependency version bump detection', () => {
  it('compares the removed and added package.json lines', async () => {
    const findings = await detectVersionBumps(parseUnifiedDiff(VERSION_DIFF));
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.category).toBe('dependency');
    expect(finding.analyzer).toBe('dependency-version');
    expect(finding.file).toBe('package.json');
    // The bump lives on the added line of the hunk.
    expect(finding.line).toBe(12);
    expect(finding.evidence).toContain('^19.0.0');
    expect(finding.evidence).toContain('^67.0.0');
    // Offline the registry check degrades to a heuristic; online the missing
    // version is reported as high severity.
    expect(['medium', 'high']).toContain(finding.severity);
    expect(finding.title).toMatch(/does not exist on npm|Major dependency bump/);
    expect(finding.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('stays quiet for routine minor and patch bumps', async () => {
    const diff = VERSION_DIFF.replace('+    "react-dom": "^67.0.0",', '+    "react-dom": "^19.1.0",');
    const findings = await detectVersionBumps(parseUnifiedDiff(diff));
    expect(findings).toHaveLength(0);
  });

  it('reaches the validated findings of a full review', async () => {
    const { dir, cleanup } = cloneFixture();
    const { store, repositoryId } = await indexFixture(dir);
    const outcome = await reviewPullRequest(
      { store, sources: new DiskSourceRegistry(dir) },
      {
        repositoryId,
        pullRequestNumber: 1,
        title: 'Update react-dom version',
        baseSha: 'base-sha',
        headSha: 'head-sha',
        diff: VERSION_DIFF,
        conventions: [],
        graphIsPartial: false,
        runAi: false,
      },
    );
    cleanups.push(cleanup);

    const finding = outcome.accepted.find((f) => f.analyzer === 'dependency-version');
    expect(finding).toBeDefined();
    expect(finding!.explanation).toMatch(/npm/);
    expect(outcome.parsedDiff.changedFiles).toContain('package.json');
  });
});
