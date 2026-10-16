import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { distributionVersion } from '../src/version.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(readFileSync(join(repo, 'app/package.json'))).version;
const releaseVersion = distributionVersion(version);
let root;
let archives;
function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.ifError(result.error);
  return result;
}
function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
function windowWorker(launcher) {
  return JSON.parse(launcher.match(/^const script = (".+");$/m)[1]);
}

function terminal(command, key, env) {
  const args = process.platform === 'darwin'
    ? ['-q', '/dev/null', '/bin/sh', '-c', command]
    : ['-q', '-e', '-c', command, '/dev/null'];
  return new Promise((resolveTerminal, reject) => {
    const child = spawn('script', args, { env, timeout: 10000 });
    let output = '';
    let sent = false;
    child.on('error', reject);
    child.stdout.on('data', (data) => {
      output += data;
      if (!sent && output.includes('Press any key')) {
        sent = true;
        child.stdin.write(key);
      }
    });
    child.stderr.on('data', (data) => { output += data; });
    child.on('close', (status, signal) => {
      if (signal) reject(new Error(`Terminal fixture interrupted: ${signal}\n${output}`));
      else resolveTerminal({ status, output });
    });
  });
}

function versionedBuild(t, packageVersion) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'task-tracker-versioned-release-test-'));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  cpSync(join(repo, 'app'), join(fixtureRoot, 'app'), {
    recursive: true,
    filter: (source) => !source.includes('/node_modules/') && !source.endsWith('/node_modules')
      && !source.includes('/tests/') && !source.endsWith('/tests'),
  });
  const packagePath = join(fixtureRoot, 'app/package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  packageJson.version = packageVersion;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const lockPath = join(fixtureRoot, 'app/package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = packageVersion;
  lock.packages[''].version = packageVersion;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const outDir = join(fixtureRoot, 'dist');
  const result = JSON.parse(ok(run(process.execPath, [join(fixtureRoot, 'app/scripts/release.mjs'), '--out-dir', outDir, '--target', 'linux-x64'])));
  return { fixtureRoot, outDir, result };
}
before(() => {
  root = mkdtempSync(join(tmpdir(), 'task-tracker-release-test-'));
  archives = process.env.TASK_TRACKER_RELEASE_DIR || join(root, 'dist');
  if (!process.env.TASK_TRACKER_RELEASE_DIR) ok(run(process.execPath, [join(repo, 'app/scripts/release.mjs'), '--out-dir', archives, '--target', 'linux-x64', '--target', 'macos-arm64', '--target', 'windows-x64']));
});
after(() => rmSync(root, { recursive: true, force: true }));
function fixture(t, target = 'linux-x64') {
  const home = realpathSync(mkdtempSync(join(root, 'home ')));
  const downloads = join(home, 'Downloads');
  mkdirSync(downloads);
  ok(run('tar', ['-xzf', join(archives, `OutaskAI-${releaseVersion}-${target}.tar.gz`), '-C', downloads]));
  const source = join(downloads, 'OutaskAI');
  const bin = join(home, '.local/bin');
  const releases = process.platform === 'darwin' ? join(home, 'Library/Application Support') : join(home, '.local/share/task-tracker/releases');
  const installed = join(releases, 'OutaskAI');
  const tools = join(home, 'tools');
  mkdirSync(tools);
  symlinkSync(process.execPath, join(tools, 'node'));
  const env = { ...process.env, HOME: home, SHELL: '/bin/bash', ZDOTDIR: undefined, PATH: `${bin}:${tools}:/usr/bin:/bin` };
  const install = (...args) => run(join(source, 'install.sh'), args, { env });
  return { home, downloads, source, bin, releases, installed, env, install, tools };
}

test('builders reject unsupported targets before creating artifacts', () => {
  const outDir = join(root, 'unsupported-target');
  for (const [script, args, env] of [
    ['app/scripts/release.mjs', ['--target', 'unsupported-platform', '--out-dir', outDir], process.env],
    ['scripts/release-build.mjs', [], { ...process.env, TARGETS: 'unsupported-platform' }],
  ]) {
    const result = run(process.execPath, [join(repo, script), ...args], { env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /INVALID_INPUT: target must be one of: linux-x64, macos-arm64/);
  }
  assert.equal(existsSync(outDir), false);
});

test('archives contain app resources without runtimes, HTTP, plugins, development stores or checksums', () => {
  for (const target of ['linux-x64', 'macos-arm64', 'windows-x64']) {
    const archive = join(archives, `OutaskAI-${releaseVersion}-${target}.tar.gz`);
    const entries = ok(run('tar', ['-tzf', archive])).split('\n').filter(Boolean);
    assert.deepEqual([...new Set(entries.map((path) => path.split('/')[0]))], ['OutaskAI']);
    assert.deepEqual(JSON.parse(ok(run('tar', ['-xOf', archive, 'OutaskAI/release.json']))), { version: releaseVersion, target });
    assert.ok(entries.some((path) => path.endsWith('/install.sh')));
    assert.equal(entries.includes('OutaskAI/install.cmd'), target === 'windows-x64');
    assert.ok(entries.includes('OutaskAI/install-launcher.mjs'));
    assert.ok(entries.some((path) => /\/node_modules\/.+\/(?:LICENSE|License|license)(?:\.[^/]*)?$/.test(path)));
    assert.equal(entries.includes('OutaskAI/Install.command'), target === 'macos-arm64');
    assert.ok(entries.some((path) => path.endsWith('/app/cli.mjs')));
    assert.ok(entries.some((path) => path.endsWith('/app/scripts/schema.mjs')));
    assert.ok(entries.some((path) => path.endsWith('/app/scripts/search-tasks.mjs')));
    assert.ok(entries.some((path) => path.endsWith('/app/scripts/get-tasks.mjs')));
    assert.ok(entries.some((path) => path.endsWith('/app/scripts/continuation.mjs')));
    assert.ok(entries.some((path) => path.endsWith('/app/node_modules/jsonc-parser/package.json')));
    assert.ok(!entries.some((path) => /\/(?:runtime|tasks|tests|references|\.git|plugin[^/]*)(?:\/|$)|\/http.mjs$|SHA256SUMS/.test(path.replace(/\/app\/bin\/tasks$/, '/entry').replace(/\/bin\/tasks$/, '/entry'))));
  }
  assert.equal(existsSync(join(archives, 'SHA256SUMS')), false);
});

test('archive README starts with installation and covers runtime, use, PATH, update and removal', () => {
  const nodeRange = JSON.parse(readFileSync(join(repo, 'app/package.json'), 'utf8')).engines.node;
  for (const target of ['linux-x64', 'macos-arm64']) {
    const archive = `OutaskAI-${releaseVersion}-${target}.tar.gz`;
    const readme = ok(run('tar', ['-xOf', join(archives, archive), 'OutaskAI/README.md']));
    assert.ok(readme.startsWith(`# Outask AI v${releaseVersion} (`));
    const runtime = readme.indexOf(nodeRange);
    assert.ok(runtime >= 0);
    assert.ok(readme.indexOf('Extract this archive in a directory you will keep') >= 0 && readme.indexOf('Extract this archive') < runtime);
    assert.ok(readme.indexOf('./install.sh') >= 0 && readme.indexOf('./install.sh') < runtime);
    assert.match(readme, /configures PATH for future\nterminals/);
    assert.match(readme, target === 'macos-arm64' ? /Library\/Application Support\/OutaskAI/ : /task-tracker\/releases\/OutaskAI/);
    if (target === 'macos-arm64') {
      assert.match(readme, /press any key/);
      assert.match(readme, /If the window stays open, use Cmd\+W/);
    }
    assert.match(readme, /## Use/);
    assert.match(readme, /tasks create --title "Write release notes"/);
    assert.match(readme, /tasks list --format table/);
    assert.match(readme, /tasks validate/);
    assert.match(readme, /Run `tasks --help` for all commands/);
    assert.match(readme, /## Update and remove/);
    assert.match(readme, /To update, download the new archive, extract it in a directory you will keep/);
    assert.match(readme, /Updates replace the managed application files/);
    assert.match(readme, /To uninstall, run \.\/install\.sh uninstall/);
  }
});

test('build output and archive boundary use derived zero and non-zero patch identifiers', (t) => {
  for (const [packageVersion, expected] of [['0.12.0', '0.12'], ['0.12.1', '0.12.1']]) {
    const { result } = versionedBuild(t, packageVersion);
    assert.equal(result.version, expected);
    assert.equal(result.artifacts.length, 1);
    const archive = result.artifacts[0].archive;
    assert.equal(archive.endsWith(`/OutaskAI-${expected}-linux-x64.tar.gz`), true);
    const rootName = 'OutaskAI';
    assert.equal(JSON.parse(ok(run('tar', ['-xOf', archive, `${rootName}/release.json`]))).version, expected);
    assert.equal(JSON.parse(ok(run('tar', ['-xOf', archive, `${rootName}/app/package.json`]))).version, packageVersion);
    assert.match(ok(run('tar', ['-xOf', archive, `${rootName}/README.md`])), new RegExp(`^# Outask AI v${expected.replaceAll('.', '\\.')}`));
  }
});

test('release builds install both dependency trees through a symlinked output directory', () => {
  const destination = join(root, 'release-output');
  const linked = join(root, 'linked output');
  mkdirSync(destination);
  symlinkSync(destination, linked);
  const result = JSON.parse(ok(run(process.execPath, [join(repo, 'app/scripts/release.mjs'),
    '--target', 'linux-x64', '--out-dir', linked])));
  const archive = result.artifacts[0].archive;
  assert.equal(archive, join(linked, `OutaskAI-${releaseVersion}-linux-x64.tar.gz`));
  const entries = ok(run('tar', ['-tzf', archive])).split('\n');
  assert.ok(entries.some((path) => path.endsWith('/app/node_modules/jsonc-parser/package.json')));
  assert.ok(entries.some((path) => path.endsWith('/app/mcp/node_modules/@modelcontextprotocol/server/package.json')));
});

test('download install, repeat, update and uninstall preserve project data and survive download removal', (t) => {
  const f = fixture(t);
  assert.match(ok(f.install()), /Installed/);
  assert.match(ok(f.install()), /Installed/);
  const developmentBin = join(f.home, 'development-bin');
  ok(run(process.execPath, [join(repo, 'app/scripts/install-cli.mjs'), 'install', '--bin-dir', developmentBin], { env: f.env }));
  assert.equal(readlinkSync(join(developmentBin, 'tasks')), join(repo, 'app/bin/tasks'));
  const task = (...args) => run(join(f.bin, 'tasks'), args, { env: f.env });
  assert.doesNotMatch(ok(task('--help')), /^  (?:http|plugin)\s/im);
  const schemaProject = join(f.home, 'schema-project');
  mkdirSync(schemaProject);
  const effective = JSON.parse(ok(task('schema', schemaProject)));
  assert.deepEqual(JSON.parse(ok(task('schema', schemaProject, '--write'))), effective);
  assert.deepEqual(JSON.parse(readFileSync(join(schemaProject, 'tasks/task-schema.json'))), effective);
  const project = join(f.home, 'project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  const schema = { stores: { 'active.json': { statuses: ['pending', 'in_progress'], required_fields: ['team'] }, 'done.json': { statuses: ['done'], required_fields: ['team'] } } };
  writeFileSync(join(project, 'docs/task-schema.json'), JSON.stringify(schema));
  ok(task('create', project, '--json', JSON.stringify({ title: 'Installed task', team: 'ops', extra: { keep: true } })));
  ok(task('list', project));
  ok(task('update', project, '1', '--json', JSON.stringify({ set: { title: 'Updated task' } })));
  ok(task('transition', project, '1', '--status', 'done'));
  ok(task('validate', project));
  const data = readFileSync(join(project, 'tasks/done.json'), 'utf8');
  const saved = JSON.parse(data)[0];
  assert.equal(saved.id, 1);
  assert.deepEqual(saved.extra, { keep: true });
  assert.equal(saved.team, 'ops');
  writeFileSync(join(f.installed, 'app/scripts/obsolete.mjs'), 'old program');
  writeFileSync(join(f.installed, 'user-note.txt'), 'keep user content');
  // A newly extracted version uses the same install/update path.
  writeFileSync(join(f.source, 'release.json'), JSON.stringify({ version: '99.0.0', target: 'linux-x64' }));
  ok(f.install());
  const newer = join(f.releases, 'OutaskAI');
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(newer, 'app/bin/tasks'));
  assert.equal(existsSync(join(newer, 'app/scripts/obsolete.mjs')), false);
  assert.equal(readFileSync(join(newer, 'user-note.txt'), 'utf8'), 'keep user content');
  ok(run(join(newer, 'install.sh'), [], { env: f.env }));
  assert.equal(readFileSync(join(newer, 'user-note.txt'), 'utf8'), 'keep user content');
  rmSync(f.downloads, { recursive: true });
  ok(task('--help'));
  ok(task('validate', project));
  ok(run(join(newer, 'install.sh'), ['uninstall'], { env: f.env }));
  assert.equal(existsSync(join(f.bin, 'tasks')), false);
  assert.equal(readFileSync(join(project, 'tasks/done.json'), 'utf8'), data);
  assert.deepEqual(JSON.parse(readFileSync(join(project, 'docs/task-schema.json'))), schema);
});

test('preflight rejects missing Node and incompatible Node before writing installation', (t) => {
  const f = fixture(t);
  const empty = join(f.home, 'empty');
  mkdirSync(empty);
  let result = run(join(f.source, 'install.sh'), [], { env: { ...f.env, PATH: empty } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DEPENDENCY_MISSING/);
  symlinkSync('/usr/bin/dirname', join(empty, 'dirname'));
  writeFileSync(join(empty, 'node'), '#!/bin/sh\necho "INCOMPATIBLE_RUNTIME: test old Node" >&2\nexit 1\n', { mode: 0o755 });
  result = run(join(f.source, 'install.sh'), [], { env: { ...f.env, PATH: empty } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INCOMPATIBLE_RUNTIME/);
  assert.equal(existsSync(f.releases), false);
  assert.equal(existsSync(f.bin), false);
});

test('failed staged startup keeps the installed application and user files usable', (t) => {
  const f = fixture(t);
  ok(f.install());
  writeFileSync(join(f.installed, 'user-note.txt'), 'retain this');
  writeFileSync(join(f.source, 'app/bin/tasks'), 'invalid JavaScript syntax !');
  const result = f.install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INVALID_RELEASE: staged application failed startup/);
  assert.equal(ok(run(join(f.bin, 'tasks'), ['--version'], { env: f.env })).trim(), releaseVersion);
  assert.equal(readFileSync(join(f.installed, 'user-note.txt'), 'utf8'), 'retain this');
});

test('failed command replacement rolls back the application directory', (t) => {
  const f = fixture(t);
  ok(f.install());
  writeFileSync(join(f.installed, 'user-note.txt'), 'retain this');
  writeFileSync(join(f.source, 'release.json'), JSON.stringify({ version: '99.0.0', target: 'linux-x64' }));
  // Simulate a filesystem refusal at the command swap, after the directory swap.
  const module = `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (to === process.env.TEST_COMMAND_PATH) throw new Error('simulated command replacement refusal');
  return rename(from, to);
};
syncBuiltinESMExports();
const entry = process.argv[1];
process.argv.splice(1, 1);
await import(entry);`;
  const result = run(process.execPath, ['--input-type=module', '-e', module, join(f.source, 'install.mjs')],
    { env: { ...f.env, TEST_COMMAND_PATH: join(f.bin, 'tasks') } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated command replacement refusal/);
  assert.equal(JSON.parse(readFileSync(join(f.installed, 'release.json'), 'utf8')).version, releaseVersion);
  assert.equal(ok(run(join(f.bin, 'tasks'), ['--version'], { env: f.env })).trim(), releaseVersion);
  assert.equal(readFileSync(join(f.installed, 'user-note.txt'), 'utf8'), 'retain this');
});

test('installer refuses an unrelated destination before replacing user files', (t) => {
  const f = fixture(t);
  mkdirSync(f.installed, { recursive: true });
  writeFileSync(join(f.installed, 'user-note.txt'), 'retain this');
  const result = f.install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INSTALL_EXISTS/);
  assert.equal(readFileSync(join(f.installed, 'user-note.txt'), 'utf8'), 'retain this');
  assert.equal(existsSync(f.bin), false);
});

test('legacy versioned installations migrate the command without deleting old copies', (t) => {
  const f = fixture(t);
  ok(f.install());
  const legacy = join(f.releases, `task-tracker-${releaseVersion}-linux-x64`);
  renameSync(f.installed, legacy);
  rmSync(join(f.bin, 'tasks'));
  symlinkSync(join(legacy, 'app/bin/tasks'), join(f.bin, 'tasks'));
  writeFileSync(join(legacy, 'user-note.txt'), 'legacy user content');
  ok(f.install());
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(f.installed, 'app/bin/tasks'));
  assert.equal(readFileSync(join(legacy, 'user-note.txt'), 'utf8'), 'legacy user content');
  assert.equal(ok(run(join(legacy, 'app/bin/tasks'), ['--version'], { env: f.env })).trim(), releaseVersion);
});

test('custom root is the installation parent and ownership requires the selected root', (t) => {
  const f = fixture(t);
  const parent = join(f.home, 'custom parent');
  ok(f.install('--release-root', parent));
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(parent, 'OutaskAI/app/bin/tasks'));
  const rejected = f.install();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /COMMAND_EXISTS/);
  assert.equal(existsSync(f.installed), false);
  ok(f.install('--release-root', parent));
  ok(run(process.execPath, [join(repo, 'app/scripts/install-cli.mjs'), 'install', '--bin-dir', f.bin, '--release-root', parent], { env: f.env }));
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(repo, 'app/bin/tasks'));
});

test('macOS Finder launcher delegates installation from paths containing spaces', (t) => {
  const f = fixture(t, 'macos-arm64');
  const launcher = join(f.source, 'Install.command');
  ok(run('/bin/bash', ['-n', launcher]));
  ok(run(launcher, [], { env: f.env }));
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(f.installed, 'app/bin/tasks'));
  // The wrapper must preserve a failed install's diagnostic and exit status.
  writeFileSync(join(f.source, 'install.sh'), '#!/bin/sh\necho "DEPENDENCY_MISSING: install Node.js and put node on PATH" >&2\nexit 1\n', { mode: 0o755 });
  const missing = run(launcher, [], { env: f.env });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DEPENDENCY_MISSING: install Node.js/);
});

test('Finder launcher accepts one non-Return key and preserves terminal state and failed diagnostics', async (t) => {
  const f = fixture(t, 'macos-arm64');
  const launcher = join(f.source, 'Install.command');
  const quoted = "'" + launcher.replaceAll("'", "'\\''") + "'";
  const command = `saved=$(stty -g); ${quoted}; result=$?; if [ "$(stty -g)" = "$saved" ]; then echo TTY_RESTORED; fi; echo WRAPPER_STATUS:$result`;
  const env = { ...f.env, TERM_PROGRAM: 'OutaskTest' };
  for (const status of [0, 1]) {
    writeFileSync(join(f.source, 'install.sh'), `#!/bin/sh\necho INSTALL_RESULT_${status}\nexit ${status}\n`, { mode: 0o755 });
    const result = await terminal(command, 'x', env);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /TTY_RESTORED/);
    assert.match(result.output, new RegExp(`WRAPPER_STATUS:${status}`));
    assert.match(result.output, new RegExp(`INSTALL_RESULT_${status}`));
    assert.match(result.output, status === 0 ? /Cmd\+W/ : /Installation failed.*close this window when ready/);
  }
  if (process.platform === 'darwin') {
    const script = windowWorker(readFileSync(launcher, 'utf8'));
    const path = join(f.home, 'close.applescript');
    writeFileSync(path, script);
    ok(run('/usr/bin/osacompile', ['-o', join(f.home, 'close.scpt'), path]));
  }
});

test('window closure process query distinguishes absence from permissions, errors and malformed results', (t) => {
  const f = fixture(t, 'macos-arm64');
  const launcher = readFileSync(join(f.source, 'Install.command'), 'utf8');
  const query = JSON.parse(windowWorker(launcher).match(/^  set query to (".+")$/m)[1]);
  const probe = (script, pid) => ok(run('/bin/sh', ['-c', script, 'probe', String(pid)]));
  assert.equal(probe(query, process.pid), 'alive');
  const exited = ok(run('/bin/sh', ['-c', 'printf "%s" "$$"']));
  assert.equal(probe(query, exited), 'absent');
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const ps = join(f.home, 'query ps');
  for (const { status, out = '', err = '' } of [
    { status: 1, err: 'Operation not permitted\n' },
    { status: 1, err: '\n' },
    { status: 2 },
    { status: 0, out: 'not-a-pid\n' },
    { status: 0, out: `${process.pid}\n`, err: 'query warning\n' },
  ]) {
    writeFileSync(ps, `#!/bin/sh\nprintf '%s' ${quote(out)}\nprintf '%s' ${quote(err)} >&2\nexit ${status}\n`, { mode: 0o755 });
    assert.equal(probe(query.replace('/bin/ps', quote(ps)), process.pid), 'unknown');
  }
});

test('window worker detaches from a real terminal and spawn errors remain nonfatal', async (t) => {
  const f = fixture(t, 'macos-arm64');
  const launcher = readFileSync(join(f.source, 'Install.command'), 'utf8');
  const source = launcher.split("<<'NODE'\n")[1].split('\nNODE')[0];
  const report = join(f.home, "worker's result.json");
  // Substitute only the GUI program with a Node process to observe detachment.
  const observer = `const fs = require('node:fs');
const ps = require('node:child_process').spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'tty='], { encoding: 'utf8' });
const report = process.argv[1];
fs.writeFileSync(report + '.tmp', JSON.stringify({ tty: ps.stdout.trim(), status: ps.status, inputTTY: !!process.stdin.isTTY, outputTTY: !!process.stdout.isTTY, argument: process.argv[2] }));
fs.renameSync(report + '.tmp', report);`;
  const observed = source.replace(/^const script = .+;$/m, `const script = ${JSON.stringify(observer)};`)
    .replace("'/usr/bin/osascript'", 'process.execPath')
    + `\nimport { spawnSync } from 'node:child_process';\nconsole.log('PARENT_TTY:' + spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'tty='], { encoding: 'utf8' }).stdout.trim());`;
  const path = join(f.home, 'observe-worker.mjs');
  writeFileSync(path, observed);
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const result = await terminal(`node ${quote(path)} ${quote(report)} ${quote('structured argument')}`, '', f.env);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /PARENT_TTY:\S+/);
  assert.doesNotMatch(result.output, /PARENT_TTY:\?+/);
  const deadline = Date.now() + 5000;
  while (!existsSync(report) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const evidence = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(evidence.status, 0);
  assert.match(evidence.tty, /^\?{1,2}$/);
  assert.equal(evidence.inputTTY, false);
  assert.equal(evidence.outputTTY, false);
  assert.equal(evidence.argument, 'structured argument');
  const failed = run(process.execPath, ['--input-type=module', '-'], {
    input: source.replace("'/usr/bin/osascript'", "'/unavailable-OutaskAI-window-worker'"), env: f.env,
  });
  ok(failed);
  assert.match(failed.stderr, /Automatic window closure unavailable.*Cmd\+W/);
});

test('a manual wrapper ending does not authorise closure while its Terminal session shell lives', async (t) => {
  const f = fixture(t, 'macos-arm64');
  const launcher = join(f.source, 'Install.command');
  writeFileSync(join(f.source, 'install.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const hook = join(f.home, 'observe-session.bash');
  const trace = join(f.home, 'session.pid');
  const wrapper = join(f.home, 'wrapper.pid');
  // Observe the generated Bash launcher's guard without changing production code.
  writeFileSync(hook, `trap 'if [ "\${session_complete-false}" = true ]; then printf "%s\\n" "\${session_pid-}" > "$SESSION_TRACE"; fi' DEBUG\n`);
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const inner = `echo $$ > "$WRAPPER_PID"; ${quote(launcher)}; true`;
  const command = `session=$$; sh -c ${quote(inner)}; wrapper=$(cat "$WRAPPER_PID"); if ! kill -0 "$wrapper" 2>/dev/null; then echo WRAPPER_ENDED; fi; if kill -0 "$session"; then echo SESSION_ALIVE; fi; echo EXPECTED_SESSION:$session`;
  const result = await terminal(command, 'x', { ...f.env, TERM_PROGRAM: 'OutaskTest', BASH_ENV: hook, SESSION_TRACE: trace, WRAPPER_PID: wrapper });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /WRAPPER_ENDED/);
  assert.match(result.output, /SESSION_ALIVE/);
  assert.equal(readFileSync(trace, 'utf8').trim(), result.output.match(/EXPECTED_SESSION:(\d+)/)[1]);
});

test('macOS directory selection recognises its stable destination and previous default root', (t) => {
  const f = fixture(t, 'macos-arm64');
  const legacy = join(f.home, '.local/share/task-tracker/releases', `task-tracker-${releaseVersion}-macos-arm64`);
  cpSync(f.source, legacy, { recursive: true });
  mkdirSync(f.bin, { recursive: true });
  symlinkSync(join(legacy, 'app/bin/tasks'), join(f.bin, 'tasks'));
  // Test platform-dependent path selection; native acceptance runs separately on macOS.
  const module = "Object.defineProperty(process, 'platform', { value: 'darwin' }); const entry = process.argv[1]; process.argv.splice(1, 1); await import(entry);";
  ok(run(process.execPath, ['--input-type=module', '-e', module, join(f.source, 'install.mjs')], { env: f.env }));
  const installed = join(f.home, 'Library/Application Support/OutaskAI');
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(installed, 'app/bin/tasks'));
  assert.equal(existsSync(legacy), true);
  ok(run(process.execPath, ['--input-type=module', '-e', module, join(repo, 'app/scripts/install-cli.mjs'),
    'install', '--bin-dir', f.bin], { env: f.env }));
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(repo, 'app/bin/tasks'));
});

test('development installer recognises a release in an explicit custom release root', (t) => {
  const f = fixture(t);
  const actualRoot = join(f.home, 'release-storage');
  const customRoot = join(f.home, 'custom-releases');
  const customBin = join(f.home, 'custom-bin');
  mkdirSync(actualRoot);
  symlinkSync(actualRoot, customRoot);
  ok(f.install('--release-root', customRoot, '--bin-dir', customBin));
  const developmentBin = join(f.home, 'development-bin');
  ok(run(process.execPath, [join(repo, 'app/scripts/install-cli.mjs'), 'install', '--bin-dir', developmentBin, '--release-root', customRoot], {
    env: { ...f.env, PATH: `${customBin}:${f.env.PATH}` },
  }));
  assert.equal(readlinkSync(join(developmentBin, 'tasks')), join(repo, 'app/bin/tasks'));
});

test('CLI install does not require optional MCP dependencies and reports PATH action', (t) => {
  const f = fixture(t);
  rmSync(join(f.source, 'app/mcp/node_modules'), { recursive: true });
  const env = { ...f.env, PATH: `${f.tools}:/usr/bin:/bin` };
  const result = run(join(f.source, 'install.sh'), [], { env });
  const output = ok(result);
  assert.match(output, /PATH configured in/);
  assert.match(output, /Open a new terminal/);
  assert.match(output, /Run immediately:/);
  assert.doesNotMatch(output, /export PATH=/);
  const profile = join(f.home, '.bashrc');
  const original = readFileSync(profile, 'utf8');
  ok(run(join(f.source, 'install.sh'), [], { env }));
  assert.equal(readFileSync(profile, 'utf8'), original);
  assert.equal(ok(run('/bin/bash', ['-c', '. "$1"; tasks --version', 'bash', profile], { env })).trim(), releaseVersion);
  rmSync(profile);
  mkdirSync(profile);
  assert.match(ok(run(join(f.source, 'install.sh'), [], { env })), /Command installed.*PATH setup failed/);
  ok(run(join(f.bin, 'tasks'), ['--help'], { env }));
});

test('installer preserves unrelated commands including dangling symlinks and PATH collisions', (t) => {
  const f = fixture(t);
  mkdirSync(f.bin, { recursive: true });
  const target = join(f.bin, 'tasks');
  writeFileSync(target, 'unrelated');
  assert.match(f.install().stderr, /COMMAND_EXISTS/);
  assert.equal(readFileSync(target, 'utf8'), 'unrelated');
  rmSync(target);
  symlinkSync('/absent/unrelated', target);
  assert.match(f.install().stderr, /COMMAND_EXISTS/);
  assert.equal(readlinkSync(target), '/absent/unrelated');
  rmSync(target);
  writeFileSync(join(f.tools, 'tasks'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.match(f.install().stderr, /COMMAND_EXISTS/);
  assert.equal(existsSync(f.releases), false);
});

test('installer migrates existing checkout and previous release command links', (t) => {
  const f = fixture(t);
  mkdirSync(f.bin, { recursive: true });
  symlinkSync(join(repo, 'app/bin/tasks'), join(f.bin, 'tasks'));
  ok(f.install());
  rmSync(join(f.bin, 'tasks'));
  const old = join(f.releases, 'task-tracker-0.0.1-linux-x64');
  cpSync(f.source, old, { recursive: true });
  writeFileSync(join(old, 'release.json'), JSON.stringify({ version: '0.0.1', target: 'linux-x64' }));
  writeFileSync(join(old, 'bin/tasks'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  symlinkSync(join(old, 'bin/tasks'), join(f.bin, 'tasks'));
  ok(f.install());
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(f.installed, 'app/bin/tasks'));
  assert.equal(existsSync(join(old, 'bin/tasks')), true);
});

test('Windows archive describes native installation, persistent user PATH and packaged MCP', () => {
  const archive = join(archives, `OutaskAI-${releaseVersion}-windows-x64.tar.gz`);
  const readme = ok(run('tar', ['-xOf', archive, 'OutaskAI/README.md']));
  assert.match(readme, /PowerShell: `\.\/install.cmd`/);
  assert.match(readme, /cmd.exe: `install.cmd`/);
  assert.match(readme, /AppData\\Local\\Programs\\OutaskAI/);
  assert.match(readme, /existing user PATH entries/);
  assert.match(readme, /already-open session/);
  assert.match(readme, /unrelated files, project tasks and configuration are preserved/);
  assert.match(readme, /For packaged MCP, configure command node/);
  const installer = ok(run('tar', ['-xOf', archive, 'OutaskAI/install.cmd']));
  assert.match(installer, /DEPENDENCY_MISSING/);
  assert.match(installer, /runtime.cjs/);
  assert.match(installer, /install.mjs/);
});
