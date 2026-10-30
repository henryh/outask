import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { distributionVersion } from '../../src/version.mjs';
import { isolateUserHome } from '../../tests/helpers/registry-isolation.mjs';
import { cleanupProjectLocks } from '../../tests/helpers/cleanup-project-locks.mjs';

const artifact = resolve(process.argv[2]);
const temporary = mkdtempSync(join(tmpdir(), 'outask-npm-smoke-'));
const prefix = join(temporary, 'prefix 東京 person');
const project = join(temporary, 'project 東京 person');
const home = join(temporary, 'home');
const npmrc = join(temporary, 'npmrc');
const env = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'AppData/Local'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), TASK_TRACKER_CONFIG: undefined,
  npm_config_userconfig: npmrc, NPM_CONFIG_USERCONFIG: npmrc, npm_config_cache: join(temporary, 'cache'),
  PATH: [process.platform === 'win32' ? prefix : join(prefix, 'bin'), dirname(process.execPath), process.env.PATH].join(delimiter) };
if (process.platform === 'win32') {
  isolateUserHome(home);
  env.OUTASK_TEST_USER_HOME = home;
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${new URL('../../tests/helpers/registry-isolation.mjs', import.meta.url).href}`.trim();
}
mkdirSync(project, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(npmrc, '');
let server;
let client;
let previousClient;

function run(command, args, cwd = temporary) {
  if (process.platform === 'win32' && command === 'npm') {
    args = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args];
    command = process.execPath;
  }
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, timeout: 120000, windowsVerbatimArguments: process.platform === 'win32' && command.toLowerCase().endsWith('cmd.exe') });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolveRun(stdout) : reject(new Error(`${command} ${args.join(' ')}: ${code}\n${stderr}\n${stdout}`)));
  });
}

function commandVersion(command) {
  if (process.platform === 'win32') {
    const shim = join(prefix, `${command}.cmd`);
    return run('cmd.exe', ['/d', '/s', '/c', `""${shim}" --version"`]);
  }
  return run(join(prefix, 'bin', command), ['--version']);
}

async function connect(entry) {
  const connection = new Client({ name: 'outask-npm-smoke', version: '1.0.0' });
  await connection.connect(new StdioClientTransport({ command: process.platform === 'win32' ? process.execPath : 'outask', args: process.platform === 'win32' ? [entry, 'mcp'] : ['mcp'], env, cwd: project }));
  return connection;
}

async function call(connection, name, args = {}) {
  const result = await connection.callTool({ name, arguments: { project_path: project, ...args } });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result.structuredContent;
}

try {
  const config = join(home, '.config/outask/config.json');
  mkdirSync(dirname(config), { recursive: true }); writeFileSync(config, '{}\n');
  const skill = join(home, '.codex/skills/example/SKILL.md');
  mkdirSync(dirname(skill), { recursive: true }); writeFileSync(skill, 'preserve skill\n');
  const contents = await run('tar', ['-tzf', artifact]);
  assert.doesNotMatch(contents, /(?:^|\/)(?:tests|tasks|\.git|references)\//m);
  assert.match(contents, /package\/node_modules\/@modelcontextprotocol\/server\/package.json/);
  const manifest = JSON.parse(await run('tar', ['-xOf', artifact, 'package/package.json']));
  assert.deepEqual(manifest.bin, { outask: 'bin/outask', tasks: 'bin/tasks' });
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.scripts, undefined, 'installation must use npm native lifecycle');
  const extracted = join(temporary, 'old');
  mkdirSync(extracted);
  await run('tar', ['-xzf', artifact, '-C', extracted]);
  const old = { ...manifest, version: '0.0.0' };
  writeFileSync(join(extracted, 'package/package.json'), JSON.stringify(old));
  const adapterVersion = JSON.parse(readFileSync(join(extracted, 'package/mcp/package.json'))).version;
  const oldServer = join(extracted, 'package/mcp/server.mjs');
  const originalServer = readFileSync(oldServer, 'utf8');
  const previousServer = originalServer.replace(`version: '${adapterVersion}'`, `version: '${old.version}'`);
  assert.notEqual(previousServer, originalServer, 'older fixture must identify its loaded MCP code');
  writeFileSync(oldServer, previousServer);
  const oldArtifact = JSON.parse(await run('npm', ['pack', '--json', '--ignore-scripts'], join(extracted, 'package')))[0].filename;
  await run('npm', ['install', '-g', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(extracted, 'package', oldArtifact)]);
  assert.equal((await commandVersion('outask')).trim(), 'Outask v0.0');

  const oldEntry = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', manifest.name, 'bin/outask');
  await run(process.execPath, [oldEntry, 'create', '--title', 'preserved npm task'], project);
  const previousRecords = readFileSync(join(project, 'tasks/active.json'));
  previousClient = await connect(oldEntry);
  assert.equal(previousClient.getServerVersion().version, old.version);
  assert.match(JSON.stringify(await call(previousClient, 'list_tasks')), /preserved npm task/);

  const bytes = readFileSync(artifact);
  let tarball;
  server = createServer((request, response) => {
    if (request.url === '/artifact.tgz') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(bytes); return;
    }
    if (decodeURIComponent(request.url.split('?')[0]) === `/${manifest.name}`) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: manifest.name, 'dist-tags': { latest: manifest.version }, versions: {
        [manifest.version]: { ...manifest, dist: { tarball, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } },
      } })); return;
    }
    response.writeHead(404); response.end('{}');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const registry = `http://127.0.0.1:${server.address().port}`;
  tarball = `${registry}/artifact.tgz`;
  await run('npm', ['update', '-g', manifest.name, '--prefix', prefix, '--registry', registry, '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.deepEqual(readFileSync(join(project, 'tasks/active.json')), previousRecords);
  assert.equal(readFileSync(config, 'utf8'), '{}\n');
  assert.equal(readFileSync(skill, 'utf8'), 'preserve skill\n');
  for (const command of ['outask', 'tasks']) {
    assert.equal((await commandVersion(command)).trim(), `Outask v${distributionVersion(manifest.version)}`);
  }
  assert.equal(previousClient.getServerVersion().version, old.version);
  assert.match(JSON.stringify(await call(previousClient, 'list_tasks')), /preserved npm task/);
  await call(previousClient, 'create_task', { task: { title: 'Live MCP write after npm update' } });
  const packageRoot = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', manifest.name);
  const entry = join(packageRoot, 'bin/outask');
  await assert.rejects(run(process.execPath, [join(packageRoot, 'scripts/install-release.mjs'), 'update']), /INVALID_RELEASE/);
  assert.equal((await commandVersion('outask')).trim(), `Outask v${distributionVersion(manifest.version)}`);
  await run(process.execPath, [entry, 'create', '--title', 'npm lifecycle task'], project);
  const listed = JSON.parse(await run(process.execPath, [entry, 'list', '--format', 'json'], project));
  assert.match(JSON.stringify(listed), /npm lifecycle task/);
  client = await connect(entry);
  assert.equal(client.getServerVersion().version, adapterVersion);
  const result = await call(client, 'list_tasks');
  assert.match(JSON.stringify(result), /npm lifecycle task/);
  assert.match(JSON.stringify(result), /Live MCP write after npm update/);
  await call(client, 'create_task', { task: { title: 'Fresh MCP write after npm update' } });
  assert.match(JSON.stringify(await call(previousClient, 'list_tasks')), /Fresh MCP write after npm update/);
  const records = readFileSync(join(project, 'tasks/active.json'));
  await client.close(); client = undefined;
  await run('npm', ['uninstall', '-g', manifest.name, '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(existsSync(packageRoot), false);
  for (const command of ['outask', 'tasks']) {
    assert.equal(existsSync(join(prefix, process.platform === 'win32' ? `${command}.cmd` : `bin/${command}`)), false);
  }
  assert.deepEqual(readFileSync(join(project, 'tasks/active.json')), records);
  assert.match(JSON.stringify(await call(previousClient, 'list_tasks')), /Fresh MCP write after npm update/);
  await call(previousClient, 'create_task', { task: { title: 'Live MCP write after npm uninstall' } });
  assert.match(readFileSync(join(project, 'tasks/active.json'), 'utf8'), /Live MCP write after npm uninstall/);
  await previousClient.close(); previousClient = undefined;
  assert.equal(readFileSync(config, 'utf8'), '{}\n');
  assert.equal(readFileSync(skill, 'utf8'), 'preserve skill\n');
  console.log(`npm lifecycle: PASS (${process.platform}-${process.arch}, Node ${process.versions.node}, ${manifest.name}@${manifest.version}, SHA256 ${createHash('sha256').update(bytes).digest('hex')}; packed contents, global install/update/uninstall, CLI aliases, live MCP through update/uninstall, fresh updated MCP, preserved data)`);
} finally {
  if (client) await client.close();
  if (previousClient) await previousClient.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  cleanupProjectLocks(project);
  rmSync(temporary, { recursive: true, force: true });
}
