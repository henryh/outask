import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { distributionVersion } from '../src/version.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(readFileSync(join(repo, 'app/package.json'))).version;
const releaseVersion = distributionVersion(version);
const installerEntries = { 'linux-x64': 'install.sh', 'macos-arm64': 'Install.command', 'windows-x64': 'Install.cmd' };
const internalInstaller = (source) => join(source, 'app/scripts/install-release.mjs');
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

function terminal(command, interaction, env) {
  const args = process.platform === 'darwin'
    ? ['-q', '/dev/null', '/bin/sh', '-c', command]
    : ['-q', '-e', '-c', command, '/dev/null'];
  const interactions = Array.isArray(interaction)
    ? interaction
    : [{ prompt: 'Press any key', input: interaction }];
  return new Promise((resolveTerminal, reject) => {
    const child = spawn('script', args, { env, timeout: 10000 });
    let output = '';
    let nextInteraction = 0;
    child.on('error', reject);
    child.stdout.on('data', (data) => {
      output += data;
      while (nextInteraction < interactions.length && output.includes(interactions[nextInteraction].prompt)) {
        child.stdin.write(interactions[nextInteraction].input);
        nextInteraction += 1;
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
  const install = (...args) => target === 'windows-x64'
    ? run(process.execPath, [internalInstaller(source), ...args], { env })
    : run(join(source, installerEntries[target]), args, { env });
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
    const publicInstallers = entries.filter((path) => /^OutaskAI\/install[^/]*$/i.test(path));
    assert.deepEqual(publicInstallers, [`OutaskAI/${installerEntries[target]}`], target);
    for (const helper of ['install-release.mjs', 'install-path.mjs', 'install-launcher.mjs']) {
      assert.ok(entries.includes(`OutaskAI/app/scripts/${helper}`), `${target}: ${helper}`);
    }
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

test('each archive README and installer help describe only their destination platform', (t) => {
  const nodeRange = JSON.parse(readFileSync(join(repo, 'app/package.json'), 'utf8')).engines.node;
  const platforms = {
    'linux-x64': {
      name: 'Linux x64', application: '~/.local/share/task-tracker/releases/OutaskAI',
      foreign: /macOS|Apple|Windows|PowerShell|cmd\.exe|Install\.cmd|Install\.command|Library\/Application Support|AppData/,
    },
    'macos-arm64': {
      name: 'macOS Apple silicon', application: '~/Library/Application Support/OutaskAI',
      foreign: /Linux|Windows|PowerShell|cmd\.exe|Install\.cmd|install\.sh|\.local\/share\/task-tracker\/releases|AppData/,
    },
    'windows-x64': {
      name: 'Windows x64', application: '%USERPROFILE%\\AppData\\Local\\Programs\\OutaskAI',
      foreign: /Linux|macOS|Apple|install\.sh|Install\.command|~\/|\.local\/|Library\/Application Support/,
    },
  };
  for (const [target, platform] of Object.entries(platforms)) {
    const f = fixture(t, target);
    const readme = readFileSync(join(f.source, 'README.md'), 'utf8');
    // Metadata, rather than the host OS, must determine cross-built archive help.
    const help = ok(f.install('--help'));
    assert.ok(readme.startsWith(`# Outask AI v${releaseVersion} (${platform.name})\n`));
    assert.ok(readme.trimEnd().split('\n').length < 200, target);
    assert.ok(readme.includes(`Node.js ${nodeRange}`));
    assert.match(help, /Node\.js\s+(?:>=)?22\.23\.3\b/);
    for (const instructions of [readme, help]) {
      assert.ok(instructions.includes(platform.name));
      assert.ok(instructions.includes(platform.application));
      assert.doesNotMatch(instructions, platform.foreign);
    }
    assert.ok(readme.indexOf(nodeRange) < readme.indexOf(installerEntries[target]), target);
    assert.match(readme, /^tasks create --title (?:"[^"\n]+"|'[^'\n]+'|\S+)$/m);
    assert.match(readme, /^tasks list(?: --format table)?$/m);
    assert.ok(readme.includes(`https://github.com/henryh/outask/blob/v${releaseVersion}/app/mcp/README.md`));
    assert.ok(readme.includes(`https://github.com/henryh/outask/blob/v${releaseVersion}/app/README.md`));
    assert.match(help, /\[--bin-dir <directory>\] \[--release-root <parent-directory>\]/);
    if (target === 'windows-x64') {
      assert.match(readme, /PowerShell: `\.\/Install\.cmd`/);
      assert.match(readme, /cmd.exe: `Install\.cmd`/);
      const config = JSON.parse(readme.match(/```json\n([\s\S]*?)\n```/)[1]);
      assert.deepEqual(config, { command: 'node', args: ['C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\OutaskAI\\app\\bin\\tasks', 'mcp'] });
      assert.ok(readme.includes('& "$env:USERPROFILE\\AppData\\Local\\Programs\\OutaskAI\\Install.cmd" uninstall'));
      assert.ok(readme.includes('"%USERPROFILE%\\AppData\\Local\\Programs\\OutaskAI\\Install.cmd" uninstall'));
      assert.match(help, /\.\/Install\.cmd \(PowerShell\), Install\.cmd \(cmd\.exe\)/);
    } else {
      assert.ok(readme.includes(`\`\`\`sh\n./${installerEntries[target]}\n\`\`\``), target);
      assert.match(readme, /codex mcp add tasks -- tasks mcp\ncodex mcp list/);
      assert.equal((readme.match(/codex mcp add/g) || []).length, 1);
      const installed = platform.application.replace('~', '$HOME');
      assert.ok(readme.includes(`"${installed}/${installerEntries[target]}" uninstall`));
      assert.ok(help.includes(`Usage: ./${installerEntries[target]} [install|uninstall]`));
      for (const [, commands] of readme.matchAll(/```sh\n([\s\S]*?)\n```/g)) ok(run('/bin/sh', ['-n'], { input: commands }));
    }
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

test('managed upgrades replace the previous root installers and preserve user data and unknown files', (t) => {
  for (const target of Object.keys(installerEntries)) {
    const f = fixture(t, target);
    // Reconstruct the previous managed layout without depending on an old download.
    cpSync(f.source, f.installed, { recursive: true });
    rmSync(join(f.installed, installerEntries[target]));
    const oldInstallers = ['install.mjs', 'install-path.mjs', 'install-launcher.mjs', 'install.sh',
      ...(target === 'macos-arm64' ? ['Install.command'] : target === 'windows-x64' ? ['install.cmd'] : [])];
    for (const name of oldInstallers) writeFileSync(join(f.installed, name), `Previous managed ${name}\n`);
    for (const helper of ['install-release.mjs', 'install-path.mjs', 'install-launcher.mjs']) {
      rmSync(join(f.installed, 'app/scripts', helper), { force: true });
    }
    writeFileSync(join(f.installed, 'release.json'), JSON.stringify({ version: '0.0.1', target }));
    mkdirSync(f.bin, { recursive: true });
    symlinkSync(join(f.installed, 'app/bin/tasks'), join(f.bin, 'tasks'));
    const project = join(f.home, 'project');
    mkdirSync(project);
    ok(run(join(f.bin, 'tasks'), ['create', project, '--json', JSON.stringify({ title: 'Existing task', extra: { retained: ['unknown', 42] } })], { env: f.env }));
    const dataPath = join(project, 'tasks/active.json');
    const data = readFileSync(dataPath, 'utf8');
    const userFiles = {
      'user-note.txt': 'retain user content\n',
      'install-custom.mjs': 'retain similarly named unknown file\n',
      'user-data/settings.json': '{"unknown":{"retained":true}}\n',
    };
    for (const [name, content] of Object.entries(userFiles)) {
      mkdirSync(dirname(join(f.installed, name)), { recursive: true });
      writeFileSync(join(f.installed, name), content);
    }
    const config = join(f.home, '.codex/config.toml');
    mkdirSync(dirname(config));
    const configuration = '[mcp_servers.existing]\ncommand = "keep-this"\n';
    writeFileSync(config, configuration);
    assert.match(ok(f.install()), /Installed/);
    assert.equal(readlinkSync(join(f.bin, 'tasks')), join(f.installed, 'app/bin/tasks'));
    assert.equal(JSON.parse(readFileSync(join(f.installed, 'release.json'), 'utf8')).version, releaseVersion);
    const installedNames = readdirSync(f.installed);
    for (const name of oldInstallers.filter((name) => name !== installerEntries[target])) {
      assert.equal(installedNames.includes(name), false, `${target}: obsolete ${name}`);
    }
    assert.equal(installedNames.includes(installerEntries[target]), true, target);
    for (const helper of ['install-release.mjs', 'install-path.mjs', 'install-launcher.mjs']) {
      assert.equal(existsSync(join(f.installed, 'app/scripts', helper)), true, `${target}: ${helper}`);
    }
    for (const [name, content] of Object.entries(userFiles)) assert.equal(readFileSync(join(f.installed, name), 'utf8'), content, `${target}: ${name}`);
    assert.equal(readFileSync(dataPath, 'utf8'), data, target);
    assert.deepEqual(JSON.parse(data)[0].extra, { retained: ['unknown', 42] });
    assert.equal(readFileSync(config, 'utf8'), configuration, target);
    ok(run(join(f.bin, 'tasks'), ['validate', project], { env: f.env }));
  }
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
  assert.equal(ok(run(join(f.bin, 'tasks'), ['--version'], { env: f.env })).trim(), `Outask AI v${releaseVersion}`);
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
  const result = run(process.execPath, ['--input-type=module', '-e', module, internalInstaller(f.source)],
    { env: { ...f.env, TEST_COMMAND_PATH: join(f.bin, 'tasks') } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated command replacement refusal/);
  assert.equal(JSON.parse(readFileSync(join(f.installed, 'release.json'), 'utf8')).version, releaseVersion);
  assert.equal(ok(run(join(f.bin, 'tasks'), ['--version'], { env: f.env })).trim(), `Outask AI v${releaseVersion}`);
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
  // Legacy installer filenames and release metadata alone do not prove ownership.
  writeFileSync(join(f.installed, 'release.json'), JSON.stringify({ version: '0.0.1', target: 'linux-x64' }));
  mkdirSync(join(f.installed, 'app'));
  writeFileSync(join(f.installed, 'app/package.json'), JSON.stringify({ name: 'unrelated-application' }));
  writeFileSync(join(f.installed, 'install.mjs'), 'retain unrelated installer');
  const metadataOnly = f.install();
  assert.notEqual(metadataOnly.status, 0);
  assert.match(metadataOnly.stderr, /INSTALL_EXISTS/);
  assert.equal(readFileSync(join(f.installed, 'user-note.txt'), 'utf8'), 'retain this');
  assert.equal(readFileSync(join(f.installed, 'install.mjs'), 'utf8'), 'retain unrelated installer');
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
  assert.equal(ok(run(join(legacy, 'app/bin/tasks'), ['--version'], { env: f.env })).trim(), `Outask AI v${releaseVersion}`);
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
  // A failed runtime preflight must stop before invoking the managed installer.
  rmSync(join(f.tools, 'node'));
  writeFileSync(join(f.tools, 'node'), '#!/bin/sh\ncase "$1" in */app/runtime.cjs) echo "INCOMPATIBLE_RUNTIME: test old Node" >&2; exit 17 ;; *) echo "INSTALLER_REACHED" >&2; exit 23 ;; esac\n', { mode: 0o755 });
  const incompatible = run(launcher, [], { env: f.env });
  assert.equal(incompatible.status, 17);
  assert.match(incompatible.stderr, /INCOMPATIBLE_RUNTIME: Node.js/);
  assert.doesNotMatch(incompatible.stderr, /INSTALLER_REACHED/);
  rmSync(join(f.tools, 'node'));
  symlinkSync(process.execPath, join(f.tools, 'node'));
  // The wrapper must preserve a failed install's diagnostic and exit status.
  writeFileSync(internalInstaller(f.source), 'console.error("DEPENDENCY_MISSING: install Node.js and put node on PATH"); process.exit(7);\n');
  const missing = run(launcher, [], { env: f.env });
  assert.equal(missing.status, 7);
  assert.match(missing.stderr, /DEPENDENCY_MISSING: install Node.js/);
});

test('Finder launcher identifies a missing Node library and preserves its diagnostic', (t) => {
  const f = fixture(t, 'macos-arm64');
  rmSync(join(f.tools, 'node'));
  writeFileSync(join(f.tools, 'node'), '#!/bin/sh\necho "dyld: Library not loaded: /opt/homebrew/opt/simdjson/lib/libsimdjson.33.dylib" >&2\nexit 134\n', { mode: 0o755 });
  const result = f.install();
  assert.equal(result.status, 134);
  assert.match(result.stderr, /DEPENDENCY_LIBRARY_MISSING/);
  assert.ok(result.stderr.includes(join(f.tools, 'node')));
  assert.match(result.stderr, /Missing library: \/opt\/homebrew\/opt\/simdjson\/lib\/libsimdjson\.33\.dylib/);
  assert.match(result.stderr, /Original Node\.js diagnostic:/);
  assert.match(result.stderr, /dyld: Library not loaded:/);
  assert.match(result.stderr, /https:\/\/nodejs.org\/en\/download/);
  assert.match(result.stderr, /Homebrew is optional/);
  assert.equal(existsSync(f.installed), false);
});

test('Finder launcher gives NVM repair instructions without loading shell profiles', (t) => {
  const f = fixture(t, 'macos-arm64');
  const nvmBin = join(f.home, '.nvm/versions/node/v22.23.3/bin');
  mkdirSync(nvmBin, { recursive: true });
  writeFileSync(join(nvmBin, 'node'), '#!/bin/sh\necho "dyld: Library not loaded: /missing/libnode-test.dylib" >&2\nexit 134\n', { mode: 0o755 });
  const result = run(join(f.source, 'Install.command'), [], {
    env: { ...f.env, PATH: `${nvmBin}:/usr/bin:/bin` },
  });
  assert.equal(result.status, 134);
  assert.match(result.stderr, /Node\.js is managed by NVM/);
  assert.match(result.stderr, /nvm install 'lts\/\*'/);
  assert.match(result.stderr, /nvm alias default 'lts\/\*'/);
  assert.doesNotMatch(result.stderr, /Homebrew can repair/);
  assert.equal(existsSync(f.installed), false);
});

test('Finder launcher repairs a broken Homebrew Node only after confirmation', async (t) => {
  const f = fixture(t, 'macos-arm64');
  const prefix = join(f.home, 'homebrew-node@22');
  const node = join(prefix, 'bin/node');
  const repaired = join(f.home, 'homebrew-repaired');
  mkdirSync(dirname(node), { recursive: true });
  writeFileSync(node, '#!/bin/sh\necho "dyld: Library not loaded: /opt/homebrew/opt/simdjson/lib/libsimdjson.34.dylib" >&2\nexit 134\n', { mode: 0o755 });
  writeFileSync(join(f.tools, 'brew'), `#!/bin/sh
if [ "$1" = list ] && [ "$2" = --formula ]; then
  echo node@22
elif [ "$1" = --prefix ] && [ "$2" = --installed ] && [ "$3" = node@22 ]; then
  echo '${prefix}'
elif [ "$1" = reinstall ] && [ "$2" = --formula ] && [ "$3" = node@22 ]; then
  /bin/rm -f '${node}'
  /bin/ln -s '${process.execPath}' '${node}'
  : > '${repaired}'
else
  exit 64
fi
`, { mode: 0o755 });
  const launcher = join(f.source, 'Install.command');
  const quoted = "'" + launcher.replaceAll("'", "'\\''") + "'";
  const result = await terminal(quoted, [
    { prompt: 'Run this Homebrew command now?', input: 'y\n' },
    { prompt: 'Press any key', input: 'x' },
  ], { ...f.env, PATH: `${dirname(node)}:${f.tools}:/usr/bin:/bin`, TERM_PROGRAM: 'OutaskTest' });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /DEPENDENCY_LIBRARY_MISSING/);
  assert.match(result.output, /brew reinstall --formula node@22/);
  assert.equal(existsSync(repaired), true);
  assert.equal(readlinkSync(join(f.bin, 'tasks')), join(f.installed, 'app/bin/tasks'));
});

test('Finder launcher checks minimum Node and accepts newer versions outside Homebrew', (t) => {
  for (const [version, accepted] of [['22.23.2', false], ['22.23.3', true], ['24.0.0', true]]) {
    const f = fixture(t, 'macos-arm64');
    rmSync(join(f.tools, 'node'));
    // Run the shipped version check with a controlled runtime version, then use real Node.
    const node = "'" + process.execPath.replaceAll("'", "'\\''") + "'";
    writeFileSync(join(f.tools, 'node'), `#!/bin/sh
case "$1" in
  */app/runtime.cjs) exec ${node} -e 'Object.defineProperty(process.versions, "node", {value: "${version}"}); require(process.argv[1])' "$1" ;;
  *) exec ${node} "$@" ;;
esac
`, { mode: 0o755 });
    const result = f.install();
    assert.equal(result.status === 0, accepted, result.stderr);
    assert.equal(existsSync(f.installed), accepted);
    if (!accepted) {
      assert.match(result.stderr, /INCOMPATIBLE_RUNTIME/);
      assert.match(result.stderr, /Install or upgrade Node.js/);
    }
  }
});

test('Finder launcher rejects missing Node and dirname before writing installation', (t) => {
  const f = fixture(t, 'macos-arm64');
  const hook = join(f.home, 'dependency-lookup.bash');
  const unexpectedBrew = join(f.home, 'unexpected-brew');
  writeFileSync(join(f.tools, 'brew'), `#!/bin/sh\n: > '${unexpectedBrew}'\nexit 99\n`, { mode: 0o755 });
  // Override only lookup to isolate each missing dependency from host programs.
  writeFileSync(hook, `command() {
  if [ "$1" = -v ] && [ "$2" = "$TEST_MISSING_DEPENDENCY" ]; then return 1; fi
  builtin command "$@"
}
`);
  for (const dependency of ['node', 'dirname']) {
    const result = run(join(f.source, 'Install.command'), [], {
      env: { ...f.env, BASH_ENV: hook, TEST_MISSING_DEPENDENCY: dependency },
    });
    assert.equal(result.status, 1, dependency);
    assert.match(result.stderr, /DEPENDENCY_MISSING/);
    assert.match(result.stderr, dependency === 'node' ? /install Node\.js/ : /dirname is required/);
    if (dependency === 'node') {
      assert.match(result.stderr, /brew install --formula node/);
      assert.equal(existsSync(unexpectedBrew), false);
    }
    assert.equal(existsSync(f.releases), false, dependency);
    assert.equal(existsSync(f.bin), false, dependency);
  }
});

test('Finder launcher accepts one non-Return key and preserves terminal state and failed diagnostics', async (t) => {
  const f = fixture(t, 'macos-arm64');
  const launcher = join(f.source, 'Install.command');
  const quoted = "'" + launcher.replaceAll("'", "'\\''") + "'";
  const command = `saved=$(stty -g); ${quoted}; result=$?; if [ "$(stty -g)" = "$saved" ]; then echo TTY_RESTORED; fi; echo WRAPPER_STATUS:$result`;
  const env = { ...f.env, TERM_PROGRAM: 'OutaskTest' };
  for (const status of [0, 1]) {
    writeFileSync(internalInstaller(f.source), `console.log('INSTALL_RESULT_${status}'); process.exit(${status});\n`);
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
  writeFileSync(internalInstaller(f.source), 'process.exit(0);\n');
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
  ok(run(process.execPath, ['--input-type=module', '-e', module, internalInstaller(f.source)], { env: f.env }));
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
  assert.equal(ok(run('/bin/bash', ['-c', '. "$1"; tasks --version', 'bash', profile], { env })).trim(), `Outask AI v${releaseVersion}`);
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

test('installer ignores an unrelated non-searchable PATH directory', {
  skip: process.getuid?.() === 0 ? 'Root bypasses POSIX directory search permissions; run this regression as an unprivileged user.' : false,
}, (t) => {
  const f = fixture(t);
  const restricted = join(f.home, 'restricted path');
  mkdirSync(restricted);
  chmodSync(restricted, 0o000);
  try {
    assert.throws(() => lstatSync(join(restricted, 'tasks')), { code: 'EACCES' });
    const env = { ...f.env, PATH: `${restricted}:${f.env.PATH}` };
    assert.match(ok(run(join(f.source, 'install.sh'), [], { env })), /Installed OutaskAI/);
    assert.equal(ok(run(join(f.bin, 'tasks'), ['--version'], { env })).trim(), `Outask AI v${releaseVersion}`);
  } finally {
    chmodSync(restricted, 0o700);
  }
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

test('Windows archive installer checks Node before delegating to the managed installer', () => {
  const archive = join(archives, `OutaskAI-${releaseVersion}-windows-x64.tar.gz`);
  const installer = ok(run('tar', ['-xOf', archive, 'OutaskAI/Install.cmd']));
  assert.match(installer, /DEPENDENCY_MISSING/);
  assert.match(installer, /runtime.cjs/);
  assert.match(installer, /app\\scripts\\install-release\.mjs/);
});
