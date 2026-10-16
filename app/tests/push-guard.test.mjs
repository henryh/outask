import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const installer = fileURLToPath(new URL('../../scripts/install-push-guard.mjs', import.meta.url));
const cli = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const guard = readFileSync(new URL('../../scripts/pre-push.sh', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "outask-push-'"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
    assert.equal(existsSync(directory), false);
  });
  const checkout = join(directory, 'checkout');
  const remote = join(directory, 'remote.git');
  const global = join(directory, 'gitconfig');
  writeFileSync(global, '[user]\n name = Push Test\n email = push@example.invalid\n');
  mkdirSync(checkout);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
  const run = (command, args, cwd = checkout) => {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const git = (...args) => run('git', args);
  ok(run('git', ['init', '--bare', '-q', remote]));
  ok(git('init', '-q', '-b', 'main'));
  ok(git('config', 'commit.gpgsign', 'false'));
  ok(git('commit', '--allow-empty', '-qm', 'Initial'));
  ok(git('remote', 'add', 'origin', remote));
  ok(git('push', '-q', 'origin', 'main'));
  mkdirSync(join(checkout, 'scripts'));
  writeFileSync(join(checkout, 'scripts/install-push-guard.mjs'), readFileSync(installer));
  writeFileSync(join(checkout, 'scripts/pre-push.sh'), guard);
  writeFileSync(join(checkout, 'Makefile'), readFileSync(new URL('../../Makefile', import.meta.url)));
  const install = () => run('make', ['install-push-guard']);
  const hook = join(checkout, '.git/hooks/pre-push');
  return { directory, checkout, remote, global, run, git, install, hook };
}

function ok(result) {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('installed guard rejects normal, forced, deletion and multi-ref main pushes; permits task delivery', (t) => {
  const { remote, run, git, install, hook, global } = fixture(t);
  const configBefore = ok(git('config', '--local', '--list'));
  const globalBefore = readFileSync(global);
  ok(install());
  chmodSync(hook, 0o644);
  ok(install());
  assert.ok(lstatSync(hook).mode & 0o111);
  assert.equal(ok(git('config', '--local', '--list')), configBefore);
  assert.deepEqual(readFileSync(global), globalBefore);
  assert.deepEqual(readFileSync(hook), guard);
  ok(git('switch', '-qc', 'task-47-example'));
  ok(git('commit', '--allow-empty', '-qm', 'Task change'));
  ok(git('push', '-q', 'origin', 'task-47-example'));
  const before = ok(run('git', ['--git-dir', remote, 'rev-parse', 'main']));
  for (const args of [
    ['HEAD:main'], ['--force', 'HEAD:main'], ['--delete', 'main'],
    ['HEAD:refs/heads/another-task', 'HEAD:main'],
  ]) {
    const result = git('push', 'origin', ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Push rejected: main changes must go through a GitHub pull request/);
    assert.equal(ok(run('git', ['--git-dir', remote, 'rev-parse', 'main'])), before);
  }
  assert.notEqual(run('git', ['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/another-task']).status, 0);
  // The documented bypass is observable; it is not a server-side protection.
  ok(git('push', '--no-verify', '-q', 'origin', 'HEAD:main'));
  assert.equal(ok(run('git', ['--git-dir', remote, 'rev-parse', 'main'])), ok(git('rev-parse', 'HEAD')));
  const forced = git('push', '--force', 'origin', `${before}:main`);
  assert.notEqual(forced.status, 0);
  assert.match(forced.stderr, /Push rejected/);
  assert.equal(ok(run('git', ['--git-dir', remote, 'rev-parse', 'main'])), ok(git('rev-parse', 'HEAD')));
});

test('existing and symlinked pre-push hooks are preserved', (t) => {
  const { directory, install, hook } = fixture(t);
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  const before = readFileSync(hook);
  assert.match(install().stderr, /Existing pre-push hook preserved/);
  assert.deepEqual(readFileSync(hook), before);
  assert.equal(lstatSync(hook).mode & 0o111, 0);
  rmSync(hook);
  const target = join(directory, 'foreign-hook');
  writeFileSync(target, guard);
  symlinkSync(target, hook);
  assert.notEqual(install().status, 0);
  assert.equal(lstatSync(hook).isSymbolicLink(), true);
  assert.deepEqual(readFileSync(target), guard);
});

test('custom hooksPath and shared worktree hooks require manual integration', (t) => {
  const { directory, checkout, git, run, install, hook } = fixture(t);
  const custom = join(directory, 'custom-hooks');
  ok(git('config', 'core.hooksPath', custom));
  assert.match(install().stderr, /Custom\/shared hooks location/);
  assert.equal(existsSync(hook), false);
  assert.equal(existsSync(custom), false);
  assert.equal(ok(git('config', '--get', 'core.hooksPath')), custom);
  ok(git('config', '--unset', 'core.hooksPath'));
  const linked = join(directory, 'linked');
  ok(git('worktree', 'add', '-qb', 'linked-task', linked));
  assert.notEqual(run(process.execPath, [installer], linked).status, 0);
  assert.notEqual(install().status, 0);
  assert.equal(existsSync(join(checkout, '.git/hooks/pre-push')), false);
});

test('symlinked hook directories are left untouched', (t) => {
  const { directory, checkout, install } = fixture(t);
  const hooks = join(checkout, '.git/hooks');
  rmSync(hooks, { recursive: true });
  const external = join(directory, 'external-hooks');
  mkdirSync(external);
  symlinkSync(external, hooks);
  assert.match(install().stderr, /Symlinked hooks directory/);
  assert.equal(existsSync(join(external, 'pre-push')), false);
});

test('push guard leaves task-validation pre-commit behaviour intact', (t) => {
  const { checkout, run, git, install } = fixture(t);
  const tasks = (...args) => run(process.execPath, [cli, ...args]);
  ok(tasks('create', '--title', 'Validation still works'));
  ok(tasks('hook', '--install'));
  const precommit = join(checkout, '.git/hooks/pre-commit');
  const before = readFileSync(precommit);
  ok(install());
  assert.deepEqual(readFileSync(precommit), before);
  ok(git('add', 'tasks'));
  ok(git('commit', '-qm', 'Valid tasks'));
  writeFileSync(join(checkout, 'tasks/active.json'), '{invalid');
  ok(git('add', 'tasks'));
  const rejected = git('commit', '-qm', 'Invalid tasks');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /INVALID_JSON/);
});
