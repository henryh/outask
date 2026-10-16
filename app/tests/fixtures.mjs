import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectLockPath } from '../src/project-lock.mjs';

export const task = (id, extra = {}) => ({ id, title: `Task ${id}`, status: 'pending', ...extra });

export function fixture(context, active = Array.from({ length: 12 }, (_, index) => task(index + 1, {
  blockers: [], scope: 'Private task details. '.repeat(700), acceptance: ['Inspect the requested task'],
})), config) {
  const root = mkdtempSync(join(tmpdir(), 'task-tracker-read-'));
  context.after(() => {
    rmSync(projectLockPath(root), { force: true });
    rmSync(`${projectLockPath(root)}-journal`, { force: true });
    // Windows may retain a terminated child's directory handles briefly.
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 5 : 0, retryDelay: 100 });
  });
  mkdirSync(join(root, 'tasks'));
  // General fixtures model prepared projects; first-use tests remove this file explicitly.
  writeStore(root, '.task-tracker.json', {});
  writeStore(root, 'active.json', active);
  writeStore(root, 'done.json', [task(99, { status: 'done', completed_at: '2026-09-17T00:00:00Z' })]);
  if (config) {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify(config, null, 2));
  }
  return root;
}

export function writeStore(root, name, tasks) {
  writeFileSync(join(root, 'tasks', name), `${JSON.stringify(tasks, null, 2)}\n`);
}

export function run(name, args, extra = {}) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url)), ...args], {
    encoding: 'utf8', timeout: 10000, ...extra,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

export function list(root, ...args) {
  const result = run('list-tasks', [root, ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

export function detail(root, id, ...args) {
  const result = run('get-task', [root, String(id), ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

export function snapshot(root) {
  return Object.fromEntries(readdirSync(join(root, 'tasks')).sort().map((file) => [file, readFileSync(join(root, 'tasks', file))]));
}
