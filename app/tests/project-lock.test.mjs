import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, parse, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withProjectLock, projectLockPath, lockInsideProject } from '../src/project-lock.mjs';
import { createTask } from '../src/create.mjs';
import { validateProject } from '../src/validation.mjs';
import { fixture, run, snapshot, task } from './fixtures.mjs';

const module = new URL('../src/project-lock.mjs', import.meta.url).href;
const cli = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const project = (root) => ({ root, directory: join(root, 'tasks') });

async function holder(t, root) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withProjectLock } from ${JSON.stringify(module)};
    withProjectLock({root: process.argv[1], directory: process.argv[1] + '/tasks'}, 'test', () => {
      process.send('held');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    });
  `, root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, TMPDIR: root, XDG_CACHE_HOME: root, HOME: root } });
  const ended = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await ended; });
  await Promise.race([once(child, 'message'), ended.then(() => { throw new Error('holder exited before acquiring lock'); })]);
  return { child, ended };
}

test('live OS locks exclude aliases and public writers; SIGKILL releases without cleanup', { timeout: 15000 }, async (t) => {
  const root = fixture(t, [task(1, { extension: { preserved: true } })]);
  const other = fixture(t, []);
  const alias = join(other, 'alias');
  symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const before = snapshot(root);
  const lock = await holder(t, root);
  assert.equal(projectLockPath(root), projectLockPath(alias));
  assert.throws(() => validateProject(alias), { code: 'PROJECT_BUSY' });
  const started = Date.now();
  const busy = spawnSync(process.execPath, [cli, 'create', '--project-path', alias, '--title', 'Blocked'], { encoding: 'utf8', timeout: 8000 });
  assert.equal(busy.status, 1, busy.stderr);
  assert.match(busy.stderr, /PROJECT_BUSY/);
  assert.ok(Date.now() - started < 7500);
  assert.deepEqual(snapshot(root), before);
  assert.equal(createTask(other, { title: 'Independent project' }).title, 'Independent project');
  assert.equal(existsSync(join(root, 'tasks/.task-tracker.json.lock')), false);
  const path = projectLockPath(root);
  assert.ok(!path.startsWith(root + '/'));
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  lock.child.kill('SIGKILL');
  await lock.ended;
  assert.ok(existsSync(path));
  const recovered = spawnSync(process.execPath, [cli, 'create', '--project-path', alias, '--title', 'After owner death'], { encoding: 'utf8', timeout: 8000 });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'tasks/active.json')))[0].extension.preserved, true);
});

test('normal completion and exceptions release the retained coordination file', (t) => {
  const root = fixture(t, []);
  assert.equal(withProjectLock(project(root), 'return', () => 42), 42);
  const failure = new Error('callback failed');
  assert.throws(() => withProjectLock(project(root), 'throw', () => { throw failure; }), (error) => error === failure);
  assert.ok(existsSync(projectLockPath(root)));
  assert.equal(createTask(root, { title: 'After exception' }).title, 'After exception');
});

test('a rejected second connection in the same process preserves OS exclusion', (t) => {
  const root = fixture(t, [task(1)]);
  withProjectLock(project(root), 'holder', () => {
    assert.throws(() => validateProject(root), { code: 'PROJECT_BUSY' });
    const competing = run('validate-task-stores', [root]);
    assert.equal(competing.status, 1);
    assert.match(competing.stderr, /PROJECT_BUSY/);
  });
  assert.equal(run('validate-task-stores', [root]).status, 0);
});

test('legacy locks fail closed and are never deleted or interpreted as dead owners', (t) => {
  const root = fixture(t, []);
  const path = join(root, 'tasks/.task-tracker.json.lock');
  writeFileSync(path, 'legacy bytes');
  const before = snapshot(root);
  assert.throws(() => createTask(root, { title: 'Rejected' }), (error) => error.code === 'PROJECT_BUSY' && /stop all older writers/.test(error.message));
  assert.deepEqual(snapshot(root), before);
  unlinkSync(path);
  assert.equal(createTask(root, { title: 'After coordinated upgrade' }).title, 'After coordinated upgrade');
});

test('damaged external coordination fails closed without altering task data', (t) => {
  const root = fixture(t, [task(1)]);
  writeFileSync(projectLockPath(root), 'not a SQLite database');
  const before = snapshot(root);
  assert.throws(() => createTask(root, { title: 'Rejected' }), { code: 'WRITE_ERROR' });
  assert.deepEqual(snapshot(root), before);
});

test('a project containing the fixed coordination directory is rejected clearly', () => {
  assert.throws(() => withProjectLock(project(process.platform === 'win32' ? join(userInfo().homedir, 'AppData/Local/OutaskAI') : '/var/tmp'), 'test', () => assert.fail('must not enter')),
    { code: 'WRITE_ERROR', message: 'project lock directory must be outside the project' });
});

test('Windows lock containment allows another drive and rejects actual project descendants', () => {
  const directory = 'C:\\Users\\owner\\AppData\\Local\\OutaskAI\\locks';
  assert.equal(lockInsideProject('D:\\work\\project', directory, win32), false);
  assert.equal(lockInsideProject('C:\\work\\project', directory, win32), false);
  assert.equal(lockInsideProject('C:\\Users\\owner', directory, win32), true);
  assert.equal(lockInsideProject(directory, directory, win32), true);
});

test('native writes coordinate when the project and OS user profile are on different volumes', { skip: process.platform !== 'win32' }, (t) => {
  const root = fixture(t, []);
  const lock = projectLockPath(root);
  if (parse(root).root.toLowerCase() === parse(lock).root.toLowerCase()) {
    t.skip('This Windows host places the fixture and user profile on the same volume');
    return;
  }
  assert.equal(createTask(root, { title: 'Cross-volume write' }).id, 100);
  assert.equal(validateProject(root).valid, true);
});
