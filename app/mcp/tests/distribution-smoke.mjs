import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { projectLockPath } from '../../src/project-lock.mjs';
import { distributionVersion } from '../../src/version.mjs';
import { hostTarget } from '../../../scripts/release-config.mjs';
import { isolateRegistry } from '../../tests/helpers/registry-isolation.mjs';
import { legacyUpgrade } from './legacy-upgrade-smoke.mjs';

const windows = process.platform === 'win32';
const registryKey = `Software\\OutaskTest-${randomUUID()}`;
if (windows) isolateRegistry(registryKey);
const target = hostTarget();
const installerName = windows ? 'Install.cmd' : process.platform === 'darwin' ? 'Install.command' : 'install.sh';
assert.equal(process.argv.length, 3, 'Pass the native host test archive path');
const archive = resolve(process.argv[2]);
const archiveDirectory = basename(archive).startsWith('OutaskAI-') ? 'OutaskAI' : 'Outask';
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'outask-installed-smoke-')));
const home = join(temporary, 'home 東京 person');
const downloads = join(temporary, 'downloads');
const project = join(temporary, 'project 東京 with spaces');
const bin = windows ? join(home, 'AppData/Local/Programs/Outask/commands') : join(home, '.local/bin');
const releases = windows ? join(home, 'AppData/Local/Programs') : process.platform === 'darwin' ? join(home, 'Library/Application Support') : join(home, '.local/share');
const application = join(releases, process.platform === 'linux' ? 'outask' : 'Outask');
const config = join(application, 'config.json');
const oldConfig = join(home, '.config/task-tracker/config.json');
const tools = join(temporary, 'tools');
const env = {
  ...process.env, USERPROFILE: windows ? home : process.env.USERPROFILE, HOME: home, SHELL: process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash', ZDOTDIR: undefined, LOCALAPPDATA: join(home, 'AppData/Local'), XDG_CONFIG_HOME: undefined, XDG_CACHE_HOME: undefined,
  PATH: windows ? [dirname(process.execPath), join(process.env.SystemRoot, 'System32'), process.env.SystemRoot,
    join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';') : `${tools}:/usr/bin:/bin`,
};
if (windows) {
  env.OUTASK_TEST_REGISTRY_KEY = registryKey;
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${new URL('../../tests/helpers/registry-isolation.mjs', import.meta.url).href}`.trim();
}
delete env.TASK_TRACKER_CONFIG;

function invoke(command, args = [], selectedEnv = env) {
  if (windows && command.endsWith('.cmd')) {
    // File inputs avoid cmd.exe/Windows PowerShell JSON quoting differences.
    const json = args.indexOf('--json');
    if (json !== -1) {
      const input = join(temporary, 'CLI input 東京.json');
      writeFileSync(input, args[json + 1]);
      args = [...args.slice(0, json), '--input', input, ...args.slice(json + 2)];
    }
    const script = '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $a = @(ConvertFrom-Json $env:OUTASK_ARGUMENTS); & $env:OUTASK_COMMAND @a; exit $LASTEXITCODE';
    selectedEnv = { ...selectedEnv, OUTASK_COMMAND: command, OUTASK_ARGUMENTS: JSON.stringify(args) };
    command = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script];
  }
  const result = spawnSync(command, args, { cwd: project, env: selectedEnv, encoding: 'utf8', timeout: 60000, windowsVerbatimArguments: windows && command.toLowerCase().endsWith('cmd.exe') });
  assert.ifError(result.error);
  return result;
}

function run(command, args = []) {
  const result = invoke(command, args);
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const command = join(bin, windows ? 'tasks.cmd' : 'tasks');
const cli = (...args) => JSON.parse(run(command, args));
const read = (path) => readFileSync(join(project, path), 'utf8');
const write = (path, data) => writeFileSync(join(project, path), data);
let client;
let lock;
let stderr = '';
let evidence;
let registryBackup;
let commandEnv = env;
let shellNode;
let macosPrerequisites;
const extraLocks = [];
const powershell = windows ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : undefined;
function documentedInstall(source, shell) {
  const command = shell === 'powershell' ? powershell : join(process.env.SystemRoot, 'System32/cmd.exe');
  const args = shell === 'powershell'
    ? ['-NoProfile', '-NonInteractive', '-Command', './Install.cmd; exit $LASTEXITCODE']
    : ['/d', '/c', 'Install.cmd'];
  const result = spawnSync(command, args, { cwd: source, env, encoding: 'utf8', timeout: 60000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PATH configured/);
}
function registry(script) { return run(powershell, ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ' + script]); }
try {
  for (const directory of [home, downloads, tools, join(home, '.config/task-tracker'), join(project, 'tasks'), join(project, 'docs')]) {
    mkdirSync(directory, { recursive: true });
  }
  lock = projectLockPath(project);
  if (windows) {
    registry("$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); try { $k.SetValue('Path','C:/Unrelated fixture;%USERPROFILE%/existing-tools',[Microsoft.Win32.RegistryValueKind]::ExpandString) } finally { $k.Dispose() }");
    registryBackup = JSON.parse(registry("$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); try { $present=$k.GetValueNames() -contains 'Path'; @{ present=$present; value=$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); kind=$(if($present){[int]$k.GetValueKind('Path')}else{2}) } | ConvertTo-Json -Compress } finally { $k.Dispose() }"));
  } else symlinkSync(process.execPath, join(tools, 'node'));
  const original = { id: 7, title: 'Existing task', status: 'pending', team: 'ops', custom: { keep: ['original'] } };
  const history = `${JSON.stringify([{ id: 80, title: 'Retained history', status: 'cancelled', extra: { keep: true } }], null, 2)}\n`;
  const schema = `${JSON.stringify({ stores: {
    'active.json': { statuses: ['pending', 'in_progress'], required_fields: ['team'] },
    'done.json': { statuses: ['done'], required_fields: ['team'] },
    'archive.json': { statuses: ['cancelled'] },
  } }, null, 2)}\n`;
  write('tasks/active.json', `${JSON.stringify([original], null, 2)}\n`);
  write('tasks/archive.json', history);
  write('tasks/task-schema.json', schema);
  write('docs/notes.txt', 'User project document\n');
  const configuration = `${JSON.stringify({ projects: { example: project }, slow_query_ms: 0, custom: { keep: true } }, null, 2)}\n`;
  writeFileSync(oldConfig, configuration);

  run('tar', ['-xzf', archive, '-C', downloads]);
  const source = join(downloads, archiveDirectory);
  const metadata = JSON.parse(readFileSync(join(source, 'release.json'), 'utf8'));
  const packageJson = JSON.parse(readFileSync(join(source, 'app/package.json'), 'utf8'));
  assert.equal(metadata.target, target, 'Archive target must match the native Node host');
  assert.equal(metadata.version, distributionVersion(packageJson.version));
  assert.equal(basename(archive), `${archiveDirectory}-${metadata.version}-${target}.tar.gz`);
  const name = process.platform === 'linux' ? 'outask' : 'Outask';
  const architecture = windows ? registry('$env:PROCESSOR_ARCHITECTURE').trim() : run('uname', ['-m']).trim();
  assert.equal(architecture, windows ? 'AMD64' : process.platform === 'darwin' ? 'arm64' : 'x86_64', 'OS architecture must match native Node execution');
  const osVersion = process.platform === 'darwin' ? run('sw_vers', ['-productVersion']).trim() : release();
  if (process.platform === 'darwin') {
    const reportedDylib = '/opt/homebrew/opt/simdjson/lib/libsimdjson.33.dylib';
    const nodeLibraries = run('/usr/bin/otool', ['-L', process.execPath]).trim().split(/\r?\n/).slice(1).map((line) => line.trim());
    assert.ok(nodeLibraries.length, 'otool must report the native Node runtime dependencies');
    for (const library of nodeLibraries) {
      assert.doesNotMatch(library, /\/(?:opt\/homebrew|usr\/local\/(?:opt|Cellar))\//, 'Native acceptance must use Node without Homebrew library dependencies');
    }
    macosPrerequisites = { reportedDylib: { path: reportedDylib, present: existsSync(reportedDylib) }, nodeLibraries };
  }
  assert.deepEqual(readdirSync(source).filter((name) => /^install/i.test(name)), [installerName]);
  const installer = join(source, installerName);
  const missingNode = invoke(installer, [], { ...env, PATH: '' });
  assert.notEqual(missingNode.status, 0);
  assert.match(missingNode.stderr, /DEPENDENCY_MISSING: install Node.js/);
  if (process.platform === 'linux') {
    const missingDirname = invoke(installer, [], { ...env, PATH: tools });
    assert.notEqual(missingDirname.status, 0);
    assert.match(missingDirname.stderr, /DEPENDENCY_MISSING: dirname/);
  }
  const manifest = join(source, 'app/package.json');
  const originalManifest = readFileSync(manifest, 'utf8');
  writeFileSync(manifest, JSON.stringify({ ...packageJson, engines: { node: '>=999.0.0' } }));
  const incompatibleRuntime = invoke(installer);
  assert.notEqual(incompatibleRuntime.status, 0);
  assert.match(incompatibleRuntime.stderr, /INCOMPATIBLE_RUNTIME/);
  writeFileSync(manifest, originalManifest);
  assert.equal(existsSync(releases), false);
  assert.equal(existsSync(bin), false);

  const localHelper = fileURLToPath(new URL('../../../scripts/install-local-release.mjs', import.meta.url));
  const helperHome = join(temporary, 'helper home');
  mkdirSync(helperHome);
  const helperBin = join(home, 'custom helper bin');
  const helperReleases = join(home, 'custom helper releases');
  const helperEnv = {
    ...env, HOME: helperHome, USERPROFILE: helperHome, LOCALAPPDATA: join(helperHome, 'AppData/Local'), BIN_DIR: helperBin, RELEASE_ROOT: helperReleases,
    PATH: windows ? env.PATH : `${dirname(process.execPath)}:${env.PATH}`,
  };
  const localInstall = invoke(process.execPath, [localHelper], helperEnv);
  assert.equal(localInstall.status, 0, localInstall.stderr || localInstall.stdout);
  assert.match(localInstall.stdout, /Installed Outask/);
  assert.equal(existsSync(join(helperBin, windows ? 'tasks.cmd' : 'tasks')), true);
  assert.equal(existsSync(join(helperReleases, name, 'app/bin/tasks')), true);
  assert.equal(existsSync(bin), false, 'Explicit helper overrides must not write the default command directory');
  assert.equal(existsSync(releases), false, 'Explicit helper overrides must not write the default application directory');
  assert.deepEqual(JSON.parse(read('tasks/active.json')), [original]);
  assert.equal(readFileSync(oldConfig, 'utf8'), configuration);
  const helperUninstall = invoke(join(helperReleases, name, installerName), ['uninstall',
    '--bin-dir', helperBin, '--release-root', helperReleases], helperEnv);
  assert.equal(helperUninstall.status, 0, helperUninstall.stderr || helperUninstall.stdout);
  assert.equal(existsSync(join(helperBin, windows ? 'tasks.cmd' : 'tasks')), false,
    'The helper launcher must not mask the default command in later PATH checks');

  await legacyUpgrade({ temporary, source, archive, metadata, env, target, project, invoke });

  if (!windows) {
    assert.equal(env.PATH.split(delimiter).includes(bin), false, 'First installation must not inherit the installed command directory');
    assert.equal(existsSync(join(home, process.platform === 'darwin' ? '.zprofile' : '.bashrc')), false, 'First installation must start with fresh shell startup files');
  }
  if (windows) documentedInstall(source, 'powershell'); else run(installer);
  assert.equal(existsSync(oldConfig), true, 'The legacy registry filename must continue to resolve after migration');
  assert.equal(readFileSync(config, 'utf8'), configuration);
  if (!windows) assert.equal(readlinkSync(command), join(releases, name, 'app/bin/tasks'));
  if (!windows) {
    // macOS login startup can prepend a system Node ahead of the matrix runtime.
    // Restore only the Node fixture; the installer profile must still supply tasks.
    const script = `export PATH="$OUTASK_SMOKE_TOOLS:$PATH"; discovered=$(command -v tasks) && reported=$(tasks --version) && node -e 'console.log("OUTASK_FRESH_SHELL:" + JSON.stringify({ command: process.argv[1], version: process.argv[2], path: process.env.PATH, home: process.env.HOME, node: { execPath: process.execPath, version: process.version } }))' "$discovered" "$reported"`;
    const shell = invoke(env.SHELL, [process.platform === 'darwin' ? '-lc' : '-ic', script], { ...env, OUTASK_SMOKE_TOOLS: tools });
    assert.equal(shell.status, 0, `Fresh shell could not run the installed command:\n${shell.stdout}\n${shell.stderr}`);
    // System shell startup may print a banner independently of the test command.
    const output = shell.stdout.split(/\r?\n/).find((line) => line.startsWith('OUTASK_FRESH_SHELL:'));
    assert.ok(output, `Fresh shell did not report its command environment:\n${shell.stdout}\n${shell.stderr}`);
    const inherited = JSON.parse(output.slice('OUTASK_FRESH_SHELL:'.length));
    assert.equal(inherited.command, command, 'A new shell must discover the installed tasks by name');
    assert.equal(inherited.version, `Outask v${metadata.version}`);
    assert.equal(inherited.home, home, 'Fresh shell must use the isolated installation HOME');
    assert.equal(inherited.node.execPath, process.execPath, 'Fresh shell must use the selected matrix Node');
    assert.equal(inherited.node.version, process.version);
    assert.ok(inherited.path.split(delimiter).includes(bin), 'Shell startup must add the installed command directory');
    shellNode = inherited.node;
    commandEnv = { ...env, PATH: inherited.path };
  }
  if (windows) documentedInstall(source, 'cmd'); else run(installer);
  if (!windows) assert.equal(readlinkSync(command), join(releases, name, 'app/bin/tasks'));
  for (const alias of ['outask', 'tasks', 'outaskai']) {
    const entry = join(bin, windows ? `${alias}.cmd` : alias);
    for (const args of [['--version'], ['--help'], ['list', '--no-cache', '--format', 'json'], ['get', '999999', '--no-cache']]) {
      const expected = invoke(command, args);
      const actual = invoke(entry, args);
      assert.equal(actual.status, expected.status, alias);
      assert.equal(actual.stdout, expected.stdout, alias);
      assert.equal(actual.stderr, expected.stderr, alias);
    }
  }
  if (windows) {
    const savedPath = registry("$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); try { $k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $k.Dispose() }").trim();
    const kind = Number(registry("$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); try { [int]$k.GetValueKind('Path') } finally { $k.Dispose() }").trim());
    assert.equal(kind, registryBackup.kind, 'Persisted user PATH retains its registry value type');
    const entries = savedPath.split(';');
    assert.equal(entries.filter((p) => p.toLowerCase() === bin.toLowerCase()).length, 1);
    for (const entry of String(registryBackup.value).split(';').filter(Boolean)) assert.ok(entries.includes(entry));
    const expandedPath = registry("[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','User'))").trim();
    const freshEnv = { ...env, PATH: expandedPath + ';' + env.PATH };
    const discovered = invoke(join(process.env.SystemRoot, 'System32/where.exe'), ['tasks'], freshEnv);
    assert.equal(discovered.status, 0, discovered.stderr);
    assert.equal(discovered.stdout.trim().split(/\r?\n/)[0].toLowerCase(), command.toLowerCase());
    assert.equal(invoke(join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/c', 'tasks --version'], freshEnv).stdout.trim(), `Outask v${metadata.version}`);
    assert.match(readFileSync(command, 'utf8'), /^[\x00-\x7f]*$/, 'The managed batch launcher must be independent of the console code page');
    // Save/restore the test console code page; the launcher itself must leave 437 intact.
    const legacyScript = `for /f "tokens=2 delims=:" %c in ('chcp') do set "OUTASK_OLD_CP=%c" & chcp 437 >nul & call "%OUTASK_COMMAND%" --version & set "OUTASK_EXIT=!errorlevel!" & chcp & chcp !OUTASK_OLD_CP! >nul & exit /b !OUTASK_EXIT!`;
    const legacy = invoke(join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/v:on', '/c', legacyScript], { ...freshEnv, OUTASK_COMMAND: command });
    assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout);
    assert.ok(legacy.stdout.split(/\r?\n/).some((line) => line.trim() === `Outask v${metadata.version}`));
    assert.match(legacy.stdout, /\b437\b/, 'Running a launcher in a Unicode install directory must preserve CP437');
    assert.equal(invoke(powershell, ['-NoProfile', '-Command', 'tasks --version; exit $LASTEXITCODE'], freshEnv).stdout.trim(), `Outask v${metadata.version}`);
  }
  rmSync(downloads, { recursive: true, force: true });

  for (const option of ['--version', '-v']) assert.equal(run(command, [option]).trim(), `Outask v${metadata.version}`);
  const rejected = invoke(command, ['create', '--json', JSON.stringify({ title: 'Missing required field' })]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /INVALID_STORE/);
  assert.deepEqual(JSON.parse(read('tasks/active.json')), [original]);

  const extension = { owner: 'ops', nested: { keep: [1, 'two'] } };
  const created = cli('create', '--json', JSON.stringify({ title: 'Installed task 東京 café', team: 'ops', extra: extension }));
  assert.equal(created.id, 81);
  assert.deepEqual(created.extra, extension);
  const listed = cli('list', '--fields', 'all', '--format', 'json');
  assert.deepEqual(listed.tasks.find((task) => task.id === original.id), original);
  assert.deepEqual(listed.tasks.find((task) => task.id === created.id), created);
  assert.ok(cli('search', '東京', '--fields', 'id', '--format', 'json').tasks.some((task) => task.id === created.id));
  const updated = cli('update', String(created.id), '--json', JSON.stringify({ set: { title: 'Updated task' } }));
  assert.equal(updated.title, 'Updated task');
  assert.deepEqual(updated.extra, extension);
  const completed = cli('transition', String(created.id), '--status', 'done');
  assert.equal(completed.status, 'done');
  assert.deepEqual(completed.extra, extension);
  assert.equal(completed.team, 'ops');
  assert.equal(cli('validate', '--format', 'json').valid, true);

  client = new Client({ name: 'outask-distribution-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: windows ? process.execPath : 'tasks', args: windows ? [join(releases, name, 'app/bin/tasks'), 'mcp'] : ['mcp'], cwd: project, env: commandEnv, stderr: 'pipe' });
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, 'outask');
  for (const alias of ['outask', 'tasks', 'outaskai']) {
    const aliasClient = new Client({ name: 'outask-alias-acceptance', version: '1.0.0' });
    const aliasTransport = new StdioClientTransport({ command: windows ? powershell : alias,
      args: windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; & $env:OUTASK_ALIAS mcp; exit $LASTEXITCODE'] : ['mcp'],
      cwd: project, env: { ...commandEnv, OUTASK_ALIAS: join(bin, `${alias}.cmd`) }, stderr: 'pipe' });
    try {
      await aliasClient.connect(aliasTransport);
      assert.equal(aliasClient.getServerVersion().name, 'outask', alias);
      if (process.platform === 'linux') {
        assert.equal(run('ps', ['-p', String(aliasTransport.pid), '-o', 'comm=']).trim(), 'outask', alias);
      }
      const result = await aliasClient.callTool({ name: 'get_task', arguments: { project_path: project, id: original.id, no_cache: true } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.deepEqual(result.structuredContent, original);
    } finally { await aliasClient.close(); }
  }
  async function call(name, args, errorCode) {
    const result = await client.callTool({ name, arguments: args });
    if (errorCode) {
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.equal(result.structuredContent.error.code, errorCode);
    } else assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  }
  const freshProject = join(temporary, 'Fresh project 東京');
  mkdirSync(freshProject);
  extraLocks.push(projectLockPath(freshProject));
  const freshPage = cli('list', '--project-path', freshProject, '--store', 'all', '--no-cache', '--format', 'json');
  assert.deepEqual(freshPage.tasks, []);
  assert.equal(freshPage.total, 0);
  const freshSelection = { project_path: freshProject, stores: ['all'], no_cache: true };
  assert.deepEqual(await call('list_tasks', { ...freshSelection, count: true, limit: 50, fields: ['all'] }), { count: 0 });
  await call('get_task', { ...freshSelection, id: 1 }, 'TASK_NOT_FOUND');
  assert.deepEqual(readdirSync(join(freshProject, 'tasks')), ['.task-tracker.json']);
  const firstTask = await call('create_task', { project_path: freshProject, task: { title: 'First task', extra: { keep: true } } });
  assert.equal(firstTask.id, 1);
  assert.deepEqual(cli('get', '1', '--project-path', freshProject, '--no-cache', '--format', 'json'), firstTask);
  assert.deepEqual(await call('list_tasks', { ...freshSelection, count: true }), { count: 1 });
  const freshActive = readFileSync(join(freshProject, 'tasks/active.json'));
  rmSync(join(freshProject, 'tasks/active.json'));
  await call('list_tasks', { ...freshSelection, count: true }, 'READ_ERROR');
  writeFileSync(join(freshProject, 'tasks/active.json'), freshActive);
  assert.ok((await call('search_tasks', { query: 'Updated', stores: ['all'], fields: ['id'] })).tasks.some((task) => task.id === created.id));
  assert.deepEqual(await call('get_task', { id: created.id, stores: ['all'], fields: ['all'] }), completed);
  await call('create_task', { task: { title: 'MCP missing required field' } }, 'INVALID_STORE');
  assert.deepEqual(JSON.parse(read('tasks/active.json')), [original]);
  const mcpCreated = await call('create_task', { task: { title: 'MCP task', team: 'ops', extra: extension } });
  assert.deepEqual(cli('get', String(mcpCreated.id), '--fields', 'all', '--format', 'json'), mcpCreated);
  const mcpUpdated = await call('update_task', { id: mcpCreated.id, patch: { set: { title: 'MCP updated task' } } });
  assert.deepEqual(cli('get', String(mcpCreated.id), '--fields', 'all', '--format', 'json'), mcpUpdated);
  assert.deepEqual(mcpUpdated.extra, extension);
  const mcpCompleted = cli('transition', String(mcpCreated.id), '--status', 'done');
  assert.deepEqual(await call('get_task', { id: mcpCreated.id, stores: ['all'], fields: ['all'] }), mcpCompleted);
  assert.equal((await call('validate_project', {})).valid, true);
  if (windows) await checkWriters(call, join(releases, name, 'app'));
  const originalServerVersion = client.getServerVersion();

  assert.deepEqual(JSON.parse(read('tasks/active.json')), [original]);
  assert.deepEqual(JSON.parse(read('tasks/done.json')), [completed, mcpCompleted]);
  assert.equal(read('tasks/archive.json'), history);
  assert.equal(read('tasks/task-schema.json'), schema);
  assert.equal(read('docs/notes.txt'), 'User project document\n');
  assert.equal(readFileSync(config, 'utf8'), configuration);
  const retained = new Map(['tasks/active.json', 'tasks/done.json', 'tasks/archive.json', 'tasks/task-schema.json', 'docs/notes.txt']
    .map((path) => [path, read(path)]));

  writeFileSync(join(releases, name, 'app/scripts/obsolete.mjs'), 'old program');
  writeFileSync(join(releases, name, 'user-note.txt'), 'Retain local note');
  const localDirectory = join('local 東京 notes', 'nested');
  mkdirSync(join(releases, name, localDirectory), { recursive: true });
  writeFileSync(join(releases, name, localDirectory, 'note.txt'), 'Retain nested local note');

  // Serve a new native archive through a fixture of GitHub Latest, then run the packaged update action.
  mkdirSync(downloads);
  run('tar', ['-xzf', archive, '-C', downloads]);
  const updateVersion = '99.0.1';
  writeFileSync(join(source, 'release.json'), JSON.stringify({ version: updateVersion, target }));
  packageJson.version = updateVersion;
  writeFileSync(join(source, 'app/package.json'), JSON.stringify(packageJson));
  // Distinguish newly loaded adapter bytes without changing its production metadata contract.
  const serverPath = join(source, 'app/mcp/server.mjs');
  writeFileSync(serverPath, readFileSync(serverPath, 'utf8').replace("version: '0.1.0'", `version: '${updateVersion}'`));
  const latestArchive = join(temporary, `${archiveDirectory}-${updateVersion}-${target}.tar.gz`);
  run('tar', ['-czf', latestArchive, '-C', downloads, archiveDirectory]);
  const updateFixture = join(temporary, 'latest.json');
  const writeLatest = (failure = false) => writeFileSync(updateFixture, JSON.stringify({ version: failure ? '99.0.2' : updateVersion, target, archive: latestArchive, brand: archiveDirectory, failure }));
  writeLatest();
  const updateEnv = { ...env, OUTASK_UPDATE_FIXTURE: updateFixture,
    NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --import=${pathToFileURL(fileURLToPath(new URL('../../tests/helpers/latest-fetch.mjs', import.meta.url))).href}`.trim() };
  const updateInstaller = join(releases, name, installerName);
  const candidateEntry = join(source, 'app/bin/tasks');
  const validEntry = readFileSync(candidateEntry);
  writeFileSync(candidateEntry, "throw new Error('fixture startup failure');\n");
  run('tar', ['-czf', latestArchive, '-C', downloads, archiveDirectory]);
  const rejectedInstall = invoke(updateInstaller, ['update'], updateEnv);
  assert.notEqual(rejectedInstall.status, 0);
  assert.match(rejectedInstall.stderr, /UPDATE_FAILED.*install latest release/);
  assert.equal(run(command, ['--version']).trim(), `Outask v${metadata.version}`);
  writeFileSync(candidateEntry, validEntry);
  run('tar', ['-czf', latestArchive, '-C', downloads, archiveDirectory]);
  const updateResult = invoke(updateInstaller, ['update'], updateEnv);
  assert.equal(updateResult.status, 0, updateResult.stderr || updateResult.stdout);
  assert.match(updateResult.stdout, /Updated to Outask v99.0.1/);
  const current = invoke(updateInstaller, ['update'], updateEnv);
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /already current/);
  for (const failure of [true, 'download']) {
    writeLatest(failure);
    const failedUpdate = invoke(updateInstaller, ['update'], updateEnv);
    assert.notEqual(failedUpdate.status, 0);
    assert.match(failedUpdate.stderr, /UPDATE_FAILED.*HTTP 503/);
    assert.equal(run(command, ['--version']).trim(), `Outask v${updateVersion}`);
  }
  const updatedInstall = join(releases, process.platform === 'linux' ? 'outask' : 'Outask');
  if (!windows) assert.equal(readlinkSync(command), join(updatedInstall, 'app/bin/tasks'));
  assert.equal(existsSync(join(updatedInstall, 'app/scripts/obsolete.mjs')), false);
  assert.equal(readFileSync(join(updatedInstall, 'user-note.txt'), 'utf8'), 'Retain local note');
  assert.equal(readFileSync(join(updatedInstall, localDirectory, 'note.txt'), 'utf8'), 'Retain nested local note');
  rmSync(downloads, { recursive: true, force: true });
  for (const option of ['--version', '-v']) assert.equal(run(command, [option]).trim(), `Outask v${updateVersion}`);
  assert.deepEqual(client.getServerVersion(), originalServerVersion);
  assert.deepEqual(await call('get_task', { id: original.id, fields: ['all'], no_cache: true }), original);
  const afterUpdate = await call('create_task', { project_path: freshProject, task: { title: 'Existing MCP writes after update' } });
  assert.deepEqual(cli('get', String(afterUpdate.id), '--project-path', freshProject, '--no-cache', '--format', 'json'), afterUpdate);
  const freshClient = new Client({ name: 'outask-updated-smoke', version: '1.0.0' });
  const freshTransport = new StdioClientTransport({ command: windows ? process.execPath : 'tasks', args: windows ? [join(updatedInstall, 'app/bin/tasks'), 'mcp'] : ['mcp'], cwd: project, env: commandEnv, stderr: 'pipe' });
  freshTransport.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await freshClient.connect(freshTransport);
    assert.equal(freshClient.getServerVersion().version, updateVersion);
    const result = await freshClient.callTool({ name: 'get_task', arguments: { project_path: freshProject, id: afterUpdate.id, fields: ['all'], no_cache: true } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(result.structuredContent, afterUpdate);
  } finally { await freshClient.close(); }
  assert.equal((await call('validate_project', {})).valid, true);
  await client.close();
  client = undefined;
  assert.equal(stderr, '');
  assert.equal(cli('validate', '--format', 'json').valid, true);
  if (windows) {
    const managedCommand = readFileSync(command, 'utf8');
    writeFileSync(command, '@echo unrelated user command\r\n');
    for (const action of ['install', 'uninstall']) {
      const collision = invoke(join(updatedInstall, installerName), [action]);
      assert.equal(collision.status, 1);
      assert.match(collision.stderr, /COMMAND_EXISTS/);
      assert.equal(readFileSync(command, 'utf8'), '@echo unrelated user command\r\n');
    }
    writeFileSync(command, managedCommand);
  }
  run(join(updatedInstall, installerName), ['uninstall']);
  for (const alias of ['outask', 'tasks', 'outaskai']) assert.equal(existsSync(join(bin, windows ? `${alias}.cmd` : alias)), false);
  assert.equal(existsSync(updatedInstall), true);
  for (const [path, content] of retained) assert.equal(read(path), content);
  assert.equal(readFileSync(config, 'utf8'), configuration);
  evidence = {
    result: 'PASS', os: { platform: process.platform, version: osVersion, architecture },
    node: { version: process.version, platform: process.platform, architecture: process.arch },
    ...(macosPrerequisites ? { macosPrerequisites } : {}),
    artifact: { version: metadata.version, target, format: archiveDirectory, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') },
    ...(!windows ? { shell: { command: env.SHELL, startup: process.platform === 'darwin' ? 'login' : 'interactive', node: shellNode } } : {}),
    checks: ['permanent-aliases-and-canonical-identity', 'published-legacy-updater-migration', 'single-platform-installer', 'fresh-project-reads-and-first-create', 'missing-previous-store-rejected', ...(windows ? ['powershell-cmd-launch', 'unicode-install-cp437-preservation', 'persistent-user-path', 'concurrent-cli-mcp-writes', 'termination-recovery', 'unicode-and-spaces'] : ['fresh-shell-command-path', 'mcp-by-command-name']), 'search', 'local-release-helper-overrides', 'clean-and-repeat-install', 'missing-dependencies', 'incompatible-runtime', 'download-removal', 'cli-lifecycle', 'shared-mcp-storage-validation', 'required-and-unknown-fields', 'latest-update-current-resolution-download-install-failures', 'update-uninstall-preservation', 'live-mcp-read-write-through-update', 'fresh-cli-mcp-use-update'],
  };
} catch (error) {
  if (stderr) process.stderr.write(stderr);
  throw error;
} finally {
  try { await client?.close(); } finally {
    if (windows && registryBackup) {
      registry(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${registryKey}', $false)`);
    }
    for (const path of extraLocks) {
      rmSync(path, { force: true });
      rmSync(`${path}-journal`, { force: true });
    }
    if (lock) {
      rmSync(lock, { force: true });
      rmSync(`${lock}-journal`, { force: true });
    }
    rmSync(temporary, { recursive: true, force: true, maxRetries: windows ? 5 : 0, retryDelay: 100 });
  }
}

console.log(JSON.stringify({ distribution_smoke: evidence }));

async function checkWriters(call, app) {
  const concurrent = join(temporary, 'Concurrent 東京 project');
  mkdirSync(concurrent);
  extraLocks.push(projectLockPath(concurrent));
  const entry = join(app, 'bin/tasks');
  const attempt = (index) => new Promise((resolveAttempt, reject) => {
    const child = spawn(process.execPath, [entry, 'create', '--project-path', concurrent, '--title', `Concurrent CLI ${index}`], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolveAttempt({ status, stdout, stderr }));
  });
  // Public writers may fail fast with PROJECT_BUSY; each contender retries that code only.
  const cliWrite = async (index) => {
    for (const deadline = Date.now() + 10000; Date.now() < deadline;) {
      const result = await attempt(index);
      if (result.status === 0) return JSON.parse(result.stdout);
      assert.match(result.stderr, /PROJECT_BUSY/);
    }
    assert.fail('CLI write did not acquire the lock');
  };
  const mcpWrite = async (index) => {
    for (const deadline = Date.now() + 10000; Date.now() < deadline;) {
      const result = await client.callTool({ name: 'create_task', arguments: { project_path: concurrent, task: { title: `Concurrent MCP ${index}` } } });
      if (!result.isError) return result.structuredContent;
      assert.equal(result.structuredContent.error.code, 'PROJECT_BUSY');
      await new Promise((resolveRetry) => setImmediate(resolveRetry));
    }
    assert.fail('MCP write did not acquire the lock');
  };
  const writes = await Promise.all([cliWrite(1), cliWrite(2), mcpWrite(1), mcpWrite(2)]);
  assert.equal(new Set(writes.map((task) => task.id)).size, 4);
  assert.equal((await call('validate_project', { project_path: concurrent })).valid, true);
  assert.equal((await call('list_tasks', { project_path: concurrent })).tasks.length, 4);
  const lockModule = pathToFileURL(join(app, 'src/project-lock.mjs')).href;
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withProjectLock } from ${JSON.stringify(lockModule)};
    withProjectLock({root:process.argv[1], directory:process.argv[1]+'/tasks'}, 'test', () => {
      process.send('held'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
    });
  `, concurrent], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(holder, 'exit');
  try {
    await Promise.race([once(holder, 'message'), exited.then(() => assert.fail('lock holder exited early'))]);
    await call('create_task', { project_path: concurrent, task: { title: 'Blocked by live holder' } }, 'PROJECT_BUSY');
  } finally { holder.kill('SIGKILL'); await exited; }
  await call('create_task', { project_path: concurrent, task: { title: 'After holder death' } });
  assert.equal((await call('validate_project', { project_path: concurrent })).valid, true);
}
