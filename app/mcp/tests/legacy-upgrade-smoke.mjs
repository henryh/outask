import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { windowsLauncher } from '../../scripts/install-launcher.mjs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Exercise the unmodified published updater and its former default locations.
// The fixture owns its HOME/LOCALAPPDATA; the Windows registry preload inherited
// from native smoke confines every PATH mutation to the test-owned registry key.
export async function legacyUpgrade({ temporary, source, archive, metadata, env, target, project, invoke }) {
  const windows = process.platform === 'win32';
  const home = join(temporary, 'legacy home 東京');
  const local = join(home, 'AppData/Local');
  const releases = windows ? join(local, 'Programs') : process.platform === 'darwin'
    ? join(home, 'Library/Application Support') : join(home, '.local/share/task-tracker/releases');
  const previous = join(releases, 'OutaskAI');
  const bin = windows ? join(local, 'OutaskAI/bin') : join(home, '.local/bin');
  const current = windows ? join(local, 'Programs/Outask') : process.platform === 'darwin'
    ? join(home, 'Library/Application Support/Outask') : join(home, '.local/share/outask');
  const currentBin = windows ? join(current, 'commands') : bin;
  cpSync(source, previous, { recursive: true, verbatimSymlinks: true,
    ...(windows ? { filter: () => true } : {}) });
  writeFileSync(join(previous, 'release.json'), JSON.stringify({ version: '0.0.1', target }));
  const manifest = join(previous, 'app/package.json');
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), name: 'task-tracker-local' }));
  const updater = join(previous, 'app/scripts/update-release.mjs');
  cpSync(new URL('../../tests/helpers/legacy-update-release.mjs', import.meta.url), updater);
  const registryReader = join(previous, 'app/src/config.mjs');
  cpSync(new URL('../../tests/helpers/legacy-config.mjs', import.meta.url), registryReader);
  mkdirSync(bin, { recursive: true });
  const oldCommand = join(bin, windows ? 'tasks.cmd' : 'tasks');
  if (windows) writeFileSync(oldCommand, windowsLauncher(join(previous, 'app/bin/tasks')).replace('rem Outask managed launcher', 'rem Outask AI managed launcher'));
  else symlinkSync(join(previous, 'app/bin/tasks'), oldCommand);
  const oldConfig = join(home, '.config/task-tracker/config.json');
  mkdirSync(dirname(oldConfig), { recursive: true });
  const settings = '{"projects":{},"unknown":{"retained":[1,2]}}\n';
  writeFileSync(oldConfig, settings);
  writeFileSync(join(previous, 'user-owned.txt'), 'preserve user content');
  const fixture = join(temporary, 'legacy-latest.json');
  writeFileSync(fixture, JSON.stringify({ version: metadata.version, target, brand: 'OutaskAI',
    archive: join(dirname(archive), `OutaskAI-${metadata.version}-${target}.tar.gz`) }));
  const legacyEnv = { ...env, HOME: home, USERPROFILE: home, LOCALAPPDATA: local,
    XDG_CONFIG_HOME: undefined, XDG_CACHE_HOME: undefined, TASK_TRACKER_CONFIG: undefined,
    OUTASK_UPDATE_FIXTURE: fixture,
    NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --import=${new URL('../../tests/helpers/latest-fetch.mjs', import.meta.url).href}`.trim() };
  const code = `import { updateRelease } from ${JSON.stringify(pathToFileURL(updater).href)};\n`
    + `import { readConfig } from ${JSON.stringify(pathToFileURL(registryReader).href)};\n`
    + `import assert from 'node:assert/strict'; const before = readConfig();\n`
    + `await updateRelease(${JSON.stringify({ destination: previous, bin, releases, target })});\n`
    + `assert.deepEqual(readConfig().settings, before.settings, 'The loaded legacy reader must retain its registry');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: legacyEnv, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(join(current, 'config.json'), 'utf8'), settings);
  assert.equal(existsSync(oldConfig), true);
  assert.equal(readFileSync(oldConfig, 'utf8'), settings);
  assert.equal(statSync(oldConfig).ino, statSync(join(current, 'config.json')).ino);
  assert.equal(statSync(oldConfig).dev, statSync(join(current, 'config.json')).dev);
  assert.equal(existsSync(join(previous, 'app/package.json')), false);
  assert.equal(readFileSync(join(previous, 'user-owned.txt'), 'utf8'), 'preserve user content');
  for (const alias of ['outask', 'tasks', 'outaskai']) {
    const command = join(currentBin, windows ? `${alias}.cmd` : alias);
    assert.equal(existsSync(command), true, alias);
    if (!windows) assert.equal(readlinkSync(command), join(current, 'app/bin/tasks'));
    const version = spawnSync(process.execPath, [join(current, 'app/bin', alias), '--version'], { env: legacyEnv, encoding: 'utf8', timeout: 10000 });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), `Outask v${metadata.version}`);
  }
  const compatible = spawnSync(process.execPath, [join(previous, 'app/bin/tasks'), '--version'], { env: legacyEnv, encoding: 'utf8', timeout: 10000 });
  assert.equal(compatible.status, 0, compatible.stderr);
  assert.equal(compatible.stdout.trim(), `Outask v${metadata.version}`);
  const validation = spawnSync(process.execPath, [join(previous, 'app/scripts/validate-task-stores.mjs'), project, '--format', 'json'],
    { env: legacyEnv, encoding: 'utf8', timeout: 10000 });
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).valid, true);
  const previousCommand = invoke(oldCommand, ['--version'], legacyEnv);
  assert.equal(previousCommand.status, 0, previousCommand.stderr);
  assert.equal(previousCommand.stdout.trim(), `Outask v${metadata.version}`);
  const installer = { 'linux-x64': 'install.sh', 'macos-arm64': 'Install.command', 'windows-x64': 'Install.cmd' }[target];
  const previousInstaller = invoke(join(previous, installer), ['--help'], legacyEnv);
  assert.equal(previousInstaller.status, 0, previousInstaller.stderr);
  assert.match(previousInstaller.stdout, /Outask installer/);
  const reinstall = invoke(join(previous, installer), ['install'], {
    ...legacyEnv, PATH: join(previous, 'app/bin') + delimiter + legacyEnv.PATH,
  });
  assert.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout);
  assert.equal(statSync(oldConfig).ino, statSync(join(current, 'config.json')).ino);
  assert.equal(readFileSync(oldConfig, 'utf8'), readFileSync(join(current, 'config.json'), 'utf8'));
  const client = new Client({ name: 'legacy-absolute-client-path', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(previous, 'app/bin/tasks'), 'mcp'],
    cwd: project, env: legacyEnv, stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion().name, 'outask');
    const read = await client.callTool({ name: 'list_tasks', arguments: { project_path: project, fields: ['id'], no_cache: true } });
    assert.notEqual(read.isError, true, JSON.stringify(read));
    assert.ok(read.structuredContent.tasks.length > 0);
  } finally { await client.close(); }
  const uninstalled = invoke(join(current, installer), ['uninstall'], legacyEnv);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
}
