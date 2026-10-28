import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { cleanupProjectLocks } from './helpers/cleanup-project-locks.mjs';

const resources = new WeakMap();
// Direct node --test runs need the same isolation as make test. No lifecycle
// fixture may inherit the operator's profiles, registry selection or caches.
const testHome = mkdtempSync(join(tmpdir(), 'outask-test-home-'));
process.env.HOME = testHome;
if (process.platform === 'win32') {
  process.env.USERPROFILE = testHome;
  process.env.LOCALAPPDATA = join(testHome, 'AppData/Local');
} else process.env.PATH = [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
process.env.XDG_CONFIG_HOME = join(testHome, '.config');
process.env.XDG_CACHE_HOME = join(testHome, '.cache');
delete process.env.TASK_TRACKER_CONFIG;
delete process.env.ZDOTDIR;
after(() => rmSync(testHome, { recursive: true, force: true,
  maxRetries: process.platform === 'win32' ? 5 : 0, retryDelay: 100 }));

export function beforeFixtureCleanup(context, callback) {
  const state = resources.get(context);
  if (state) state.callbacks.push(callback);
  else context.after(callback);
}

export const task = (id, extra = {}) => ({ id, title: `Task ${id}`, status: 'pending', ...extra });

export function fixture(context, active = Array.from({ length: 12 }, (_, index) => task(index + 1, {
  blockers: [], scope: 'Private task details. '.repeat(700), acceptance: ['Inspect the requested task'],
})), config) {
  const root = mkdtempSync(join(tmpdir(), 'task-tracker-read-'));
  if (!resources.has(context)) resources.set(context, { callbacks: [], failed: false });
  context.after(async () => {
    const state = resources.get(context);
    if (state.failed) throw new Error('Fixture retained because a client failed to close');
    const closed = await Promise.allSettled(state.callbacks.splice(0).map(callback => Promise.resolve().then(callback)));
    const failure = closed.find(result => result.status === 'rejected');
    if (failure) { state.failed = true; throw failure.reason; }
    cleanupProjectLocks(root);
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
