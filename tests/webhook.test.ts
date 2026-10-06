import { describe, expect, it } from 'vitest';
import { normalizeWebhook, shouldTriggerReview, verifyWebhookSignature } from '@cbi/github';

function prEvent(baseRef: string, action = 'opened') {
  return normalizeWebhook('pull_request', {
    action,
    pull_request: {
      number: 7,
      title: 'Add feature',
      base: { ref: baseRef, sha: 'aaa' },
      head: { ref: 'feature-branch', sha: 'bbb' },
    },
    repository: { name: 'cognimail', owner: { login: 'HeyBroooo' }, default_branch: 'master' },
  });
}

describe('pull request webhook gating', () => {
  it('captures the base branch the PR targets', () => {
    expect(prEvent('master')?.baseBranch).toBe('master');
    expect(prEvent('develop')?.baseBranch).toBe('develop');
  });

  it('reviews a PR that targets the tracked branch', () => {
    const event = prEvent('master');
    expect(event).not.toBeNull();
    expect(shouldTriggerReview(event!, 'master')).toBe(true);
  });

  it('ignores a PR that targets a different branch', () => {
    // This is the guard that stops a review + comment on every PR in the repo.
    expect(shouldTriggerReview(prEvent('feature-x')!, 'master')).toBe(false);
    expect(shouldTriggerReview(prEvent('develop')!, 'master')).toBe(false);
  });

  it('treats a missing tracked branch as no filtering', () => {
    expect(shouldTriggerReview(prEvent('anything')!, null)).toBe(true);
  });

  it('ignores unsupported actions and non-PR events', () => {
    expect(shouldTriggerReview(prEvent('master', 'opened'), 'master')).toBe(true);
    // `closed` is filtered out during normalization, and the guard must not throw.
    expect(shouldTriggerReview(prEvent('master', 'closed'), 'master')).toBe(false);
    expect(shouldTriggerReview(prEvent('master', 'ready_for_review'), 'master')).toBe(true);
    expect(shouldTriggerReview(null, 'master')).toBe(false);
  });
});

describe('webhook signature verification', () => {
  it('accepts a correctly signed payload and rejects tampering', () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ zen: 'hello' });
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body + 'x', signature, secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });
});