import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloneOrPull } from '@cbi/github';

const temporaryDirectories: string[] = [];

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function branchFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'thread-branch-'));
  temporaryDirectories.push(root);
  const remote = join(root, 'remote.git');
  const checkout = join(root, 'checkout');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  execFileSync('git', ['init', '--initial-branch=main', checkout], { stdio: 'ignore' });
  git(['config', 'user.name', 'Test'], checkout);
  git(['config', 'user.email', 'test@example.com'], checkout);
  writeFileSync(join(checkout, 'readme.txt'), 'main');
  git(['add', 'readme.txt'], checkout);
  git(['commit', '-m', 'main'], checkout);
  git(['remote', 'add', 'origin', remote], checkout);
  git(['push', '-u', 'origin', 'main'], checkout);
  git(['checkout', '-b', 'dev'], checkout);
  writeFileSync(join(checkout, 'readme.txt'), 'dev');
  git(['commit', '-am', 'dev'], checkout);
  git(['push', '-u', 'origin', 'dev'], checkout);
  git(['checkout', 'main'], checkout);
  git(['branch', '-D', 'dev'], checkout);
  return checkout;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('explicit clone branch selection', () => {
  it('checks out the requested remote branch in an existing repository', async () => {
    const checkout = branchFixture();
    const result = await cloneOrPull({
      owner: 'acme',
      name: 'repo',
      branch: 'dev',
      existingPath: checkout,
    });

    expect(result.branch).toBe('dev');
    expect(execFileSync('git', ['show', 'HEAD:readme.txt'], { cwd: checkout, encoding: 'utf8' }).trim()).toBe('dev');
  });

  it('rejects a requested branch that does not exist', async () => {
    const checkout = branchFixture();
    await expect(
      cloneOrPull({ owner: 'acme', name: 'repo', branch: 'missing', existingPath: checkout }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
  });
});
