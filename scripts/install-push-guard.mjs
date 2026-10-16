#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim());
  return result.stdout.trim();
}

try {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/install-push-guard.mjs (from this repository)');
  const checkout = realpathSync(git('rev-parse', '--show-toplevel'));
  const common = realpathSync(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (configured.error || ![0, 1].includes(configured.status)) {
    throw configured.error ?? new Error(configured.stderr.trim());
  }
  const worktrees = git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '));
  if (configured.status === 0 || worktrees.length !== 1 || common !== join(checkout, '.git') || lstatSync(join(checkout, '.git')).isSymbolicLink()) {
    throw new Error('Custom/shared hooks location: integrate scripts/pre-push.sh into your hook manager manually; Git configuration was not changed. See docs/contributing.md.');
  }
  const directory = join(common, 'hooks');
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new Error('Symlinked hooks directory: integrate manually; no hooks were changed. See docs/contributing.md.');
  }
  const hook = join(directory, 'pre-push');
  const source = readFileSync(new URL('./pre-push.sh', import.meta.url));
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(hook, source, { flag: 'wx', mode: 0o755 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!lstatSync(hook).isFile() || !readFileSync(hook).equals(source)) {
      throw new Error('Existing pre-push hook preserved: integrate scripts/pre-push.sh manually. See docs/contributing.md.');
    }
  }
  chmodSync(hook, 0o755);
  console.log('Local main push guard installed. Existing pre-commit hooks and Git configuration are unchanged.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
