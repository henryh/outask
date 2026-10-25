import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionVersion } from '../src/version.mjs';
import { scheduleSearchRefresh, searchIndexPaths } from '../src/search-index.mjs';
import { searchTasks } from '../src/search.mjs';
import { fixture, task } from './fixtures.mjs';
import { test } from 'node:test';
import { windowsLauncher, launcherEntry } from '../scripts/install-launcher.mjs';
import { configurePath } from '../scripts/install-path.mjs';

test('managed Windows launchers preserve spaces, Unicode and literal percent signs', () => {
  const entry = 'C:\\Users\\東京 person\\100% ready\\app\\bin\\tasks';
  const launcher = windowsLauncher(entry);
  assert.match(launcher, /^[\x00-\x7f]*$/);
  assert.equal(launcherEntry(launcher), entry);
  assert.equal(launcherEntry(launcher + 'rem unrelated edit\r\n'), undefined);
  assert.equal(launcherEntry('node "unrelated" %*\r\n'), undefined);
});

test('Windows PATH failures leave an immediately usable launcher and reopening guidance', () => {
  const messages = configurePath('C:\\Users\\東京 person\\OutaskAI\\bin', { platform: 'win32', env: { PATH: '' } });
  assert.ok(messages.some((message) => /Run immediately in PowerShell: & ".*tasks.cmd" --help/.test(message)));
  assert.ok(messages.some((message) => /Run immediately in cmd.exe: ".*tasks.cmd" --help/.test(message)));
  assert.ok(messages.some((message) => /user PATH setup failed/.test(message)));
  assert.ok(messages.some((message) => /already-open terminal keeps its existing PATH/.test(message)));
});

test('Windows Node bootstrap preserves CLI options and JSON arguments from a Unicode application path', (t) => {
  const project = fixture(t, []);
  const temporary = mkdtempSync(join(tmpdir(), 'outask-bootstrap-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 5 : 0, retryDelay: 100 }));
  const alias = join(temporary, '東京 app 100% ready');
  symlinkSync(fileURLToPath(new URL('..', import.meta.url)), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const entry = join(alias, 'bin/tasks');
  const code = windowsLauncher(entry).match(/^node -e "([^"]+)" -- %\*\r?$/m)[1];
  const invoke = (...args) => {
    const result = spawnSync(process.execPath, ['-e', code, '--', ...args], { cwd: project, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
  assert.equal(invoke('--version').trim(), `Outask AI v${distributionVersion(version)}`);
  assert.match(invoke('--help'), /Usage: tasks/);
  const task = JSON.parse(invoke('create', '--json', JSON.stringify({ title: '東京 task', extra: { preserved: true } })));
  assert.equal(task.title, '東京 task');
  assert.deepEqual(task.extra, { preserved: true });
  const listed = JSON.parse(invoke('list', '--fields', 'all', '--format', 'json'));
  assert.deepEqual(listed.tasks, [task]);
});

test('detached refresh uses the OS account home and resolves a custom schema from the project', { timeout: 15000 }, async (t) => {
  let worker;
  let exited;
  t.after(async () => {
    if (!worker) return;
    worker.ref();
    if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
    await exited;
  });
  const root = fixture(t, [task(1, { title: 'Detached schema needle' })]);
  mkdirSync(join(root, 'docs'));
  const schemaPath = 'docs/custom schema.json';
  writeFileSync(join(root, schemaPath), JSON.stringify({ stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' } }));
  const cache = mkdtempSync(join(tmpdir(), 'outask-worker-cache-'));
  t.after(() => rmSync(cache, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 5 : 0, retryDelay: 100 }));
  const marker = join(cache, 'worker-cwd.txt');
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  const spawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    // Observe the real child's initial cwd, then execute the actual refresh worker.
    const bootstrap = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.cwd());import(require('node:url').pathToFileURL(process.argv[1]).href);`;
    worker = spawn(command, ['-e', bootstrap, '--', ...args], options);
    exited = once(worker, 'exit');
    return worker;
  });
  const previous = process.cwd();
  syncBuiltinESMExports();
  try {
    process.chdir(root);
    assert.equal(scheduleSearchRefresh('.', { detached: true, schemaPath, env }), true);
  } finally {
    process.chdir(previous);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.ok(exited, 'The actual detached process must have been started');
  // Production unrefs synchronously; this observer must retain the child until exit.
  worker.ref();
  const [status] = await exited;
  assert.equal(status, 0);
  assert.equal(readFileSync(marker, 'utf8'), userInfo().homedir);
  assert.equal(existsSync(searchIndexPaths(root, env).pointer), true);
  const previousCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  try {
    const page = searchTasks(root, 'Detached schema needle', { schemaPath });
    assert.deepEqual(page.tasks.map(({ id }) => id), [1]);
    assert.equal(Object.hasOwn(page, 'advisories'), false, 'The worker index must match the explicitly selected project schema');
  } finally {
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCache;
  }
});
