import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entry = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const installer = fileURLToPath(new URL('../scripts/install-cli.mjs', import.meta.url));
function execute(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}
function ok(result) { assert.equal(result.status, 0, result.stderr); return result.stdout; }
function repo(t) {
  const root = mkdtempSync(join(tmpdir(), "task-hook-'"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false); });
  const git = (...args) => execute('git', args, root);
  ok(git('init', '-q'));
  ok(git('config', 'user.name', 'Hook Test'));
  ok(git('config', 'user.email', 'hook@example.invalid'));
  ok(git('config', 'commit.gpgsign', 'false'));
  const cli = (...args) => execute(process.execPath, [entry, ...args], root);
  return { root, git, cli };
}

test('installed CLI onboarding prepares, guards blockers, restores, validates manual edits and opts into commits', (t) => {
  const { root, git } = repo(t);
  const bin = join(root, 'bin');
  const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
  ok(execute(process.execPath, [installer, 'install', '--bin-dir', bin], root, env));
  const cli = (...args) => execute(join(bin, 'tasks'), args, root, env);
  const record = (...args) => JSON.parse(ok(cli(...args)));
  const blocker = record('create', '--title', 'Prerequisite');
  const work = record('create', '--title', 'Delivery', '--json', JSON.stringify({ blockers: [blocker.id] }));
  assert.equal(existsSync(join(root, 'tasks/.task-tracker.json')), true);
  assert.equal(existsSync(join(root, '.git/hooks/pre-commit')), false);
  assert.equal(record('deps', String(work.id), '--format', 'json').eligible, false);
  assert.match(cli('transition', String(work.id), '--status', 'in_progress').stderr, /^ACTIVE_BLOCKERS:/);
  record('update', String(blocker.id), '--json', '{"set":{"completed_at":"2026-09-21T00:00:00Z"}}');
  record('transition', String(blocker.id), '--status', 'done');
  record('transition', String(blocker.id), '--status', 'cancelled');
  assert.equal(record('deps', String(work.id), '--format', 'json').eligible, true);
  record('transition', String(work.id), '--status', 'in_progress');
  record('update', String(work.id), '--json', '{"set":{"completed_at":"2026-09-21T00:00:00Z"}}');
  record('transition', String(work.id), '--status', 'done');
  record('transition', String(work.id), '--status', 'pending');
  const active = join(root, 'tasks/active.json');
  const records = JSON.parse(readFileSync(active));
  records[0].title = 'Manually revised';
  records[0].id = 70;
  writeFileSync(active, JSON.stringify(records));
  ok(cli('validate'));
  assert.equal(record('create', '--title', 'Fresh ID without a hook').id, 71);
  ok(cli('hook', '--install'));
  ok(cli('hook', '--install'));
  const valid = readFileSync(active);
  writeFileSync(active, '{broken');
  ok(git('add', 'tasks'));
  const index = ok(git('write-tree'));
  const rejected = git('commit', '-qm', 'Invalid');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /INVALID_JSON/);
  assert.equal(ok(git('write-tree')), index);
  // A valid worktree does not make the staged malformed JSON valid: this hook is explicitly worktree-only.
  writeFileSync(active, valid);
  ok(git('commit', '-qm', 'Working tree passes, index differs'));
  assert.equal(ok(git('show', 'HEAD:tasks/active.json')), '{broken');
  ok(git('add', 'tasks'));
  writeFileSync(active, '{unstaged-invalid');
  assert.notEqual(git('commit', '-qm', 'Valid index, invalid worktree').status, 0);
  writeFileSync(active, valid);
  ok(cli('validate'));
  ok(git('add', 'tasks'));
  ok(git('commit', '-qm', 'Valid snapshot'));
  ok(cli('hook', '--remove'));
  ok(cli('hook', '--remove'));
  assert.equal(existsSync(join(root, '.git/hooks/pre-commit')), false);
  ok(execute(process.execPath, [installer, 'uninstall', '--bin-dir', bin], root, env));
  assert.equal(existsSync(join(bin, 'tasks')), false);
  assert.equal(existsSync(join(root, '.gitignore')), false);
});

test('configured hooks, foreign hooks, modified ownership and shared locations are preserved', (t) => {
  const { root, git, cli } = repo(t);
  const hooks = join(root, 'custom hooks');
  ok(git('config', 'core.hooksPath', 'custom hooks'));
  ok(cli('hook', '--project-path', root, '--install'));
  const hook = join(hooks, 'pre-commit');
  assert.equal(existsSync(hook), true);
  chmodSync(hook, 0o644);
  ok(cli('hook', '--install'));
  assert.equal(statSync(hook).mode & 0o111, 0o111);
  const owned = readFileSync(hook);
  ok(cli('hook', root, '--remove'));
  const target = join(root, 'hook-target');
  writeFileSync(target, owned);
  symlinkSync(target, hook);
  for (const action of ['--install', '--remove']) {
    assert.match(cli('hook', action).stderr, /^HOOK_CONFLICT:/);
    assert.deepEqual(readFileSync(target), owned);
  }
  rmSync(hook);
  rmSync(target);
  symlinkSync(target, hook);
  assert.match(cli('hook', '--install').stderr, /^HOOK_CONFLICT:/);
  assert.match(cli('hook', '--remove').stderr, /^HOOK_CONFLICT:/);
  rmSync(hook);
  const foreign = '#!/bin/sh\nexit 23\n';
  writeFileSync(hook, foreign, { mode: 0o644 });
  for (const action of ['--install', '--remove']) {
    const result = cli('hook', action);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^HOOK_CONFLICT:.*\nnode .*validate-task-stores.mjs.*\|\| exit \$\?/);
    assert.equal(readFileSync(hook, 'utf8'), foreign);
  }
  chmodSync(hook, 0o755);
  assert.equal(git('commit', '--allow-empty', '-qm', 'Foreign check remains').status, 1);
  rmSync(hook);
  ok(cli('hook', '--install'));
  writeFileSync(hook, `${readFileSync(hook, 'utf8')}# operator addition\n`);
  assert.match(cli('hook', '--remove').stderr, /^HOOK_CONFLICT:/);
  const other = repo(t);
  ok(git('config', 'core.hooksPath', other.root));
  assert.match(cli('hook', '--install').stderr, /Shared\/external hook location/);
  assert.equal(existsSync(join(other.root, 'pre-commit')), false);
  symlinkSync(other.root, join(root, 'linked-hooks'));
  ok(git('config', 'core.hooksPath', 'linked-hooks'));
  assert.match(cli('hook', '--install').stderr, /Shared\/external hook location/);
  ok(git('config', 'core.hooksPath', hooks));
  mkdirSync(join(root, 'nested'));
  assert.match(cli('hook', join(root, 'nested'), '--install').stderr, /nested projects require manual/);
  assert.match(cli('hook', '--install', '--remove').stderr, /^INVALID_INPUT:/);
  assert.match(cli('hook', root, '--project-path', root, '--install').stderr, /^INVALID_INPUT:/);
  const registry = join(root, 'registry.json');
  writeFileSync(registry, JSON.stringify({ projects: { named: root } }));
  assert.match(cli('hook', '--project', 'named', '--config', registry, '--remove').stderr, /Existing or modified hook/);
});


test('existing linked worktrees require manual integration without changing their shared hook', (t) => {
  const { root, git, cli } = repo(t);
  ok(cli('create', '--title', 'Main task'));
  ok(git('add', 'tasks'));
  ok(git('commit', '-qm', 'Initial tasks'));
  const linked = join(root, 'linked');
  ok(git('worktree', 'add', '-qb', 'linked', linked));
  const hook = join(root, '.git/hooks/pre-commit');
  const rejected = cli('hook', '--install');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Repository has linked worktrees/);
  assert.equal(existsSync(hook), false);
  const foreign = '#!/bin/sh\nexit 27\n';
  writeFileSync(hook, foreign, { mode: 0o755 });
  assert.equal(cli('hook', '--install').status, 1);
  assert.equal(cli('hook', '--remove').status, 1);
  assert.equal(readFileSync(hook, 'utf8'), foreign);
  // The supplied manual command selects the invoking worktree, not the main checkout.
  const command = rejected.stderr.split('\n').find((line) => line.startsWith('node '));
  writeFileSync(hook, `#!/bin/sh\n${command}\n`);
  const active = join(linked, 'tasks/active.json');
  const valid = readFileSync(active);
  writeFileSync(active, '{invalid-linked');
  ok(execute('git', ['add', 'tasks'], linked));
  const invalid = execute('git', ['commit', '-qm', 'Invalid linked data'], linked);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /INVALID_JSON/);
  writeFileSync(active, valid);
  ok(execute('git', ['add', 'tasks'], linked));
  ok(execute('git', ['commit', '--allow-empty', '-qm', 'Valid linked data'], linked));
});

test('a worktree added after installation cannot silently validate another checkout', (t) => {
  const { root, git, cli } = repo(t);
  ok(cli('create', '--title', 'Main task'));
  ok(git('add', 'tasks'));
  ok(git('commit', '-qm', 'Initial tasks'));
  ok(cli('hook', '--install'));
  const linked = join(root, 'later-linked');
  ok(git('worktree', 'add', '-qb', 'later-linked', linked));
  writeFileSync(join(linked, 'tasks/active.json'), '{invalid-linked');
  ok(execute('git', ['add', 'tasks'], linked));
  const rejected = execute('git', ['commit', '-qm', 'Invalid linked data'], linked);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /HOOK_CONFLICT: This hook belongs to another working tree/);
  ok(git('commit', '--allow-empty', '-qm', 'Main checkout still works'));
  ok(cli('hook', '--remove'));
  assert.equal(existsSync(join(root, '.git/hooks/pre-commit')), false);
});
