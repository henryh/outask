import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installation } from '../../scripts/self-update.mjs';
import { windowsLauncher } from '../../scripts/install-launcher.mjs';
import { compareVersions } from '../../src/version.mjs';
import { latestReleaseUrl, updateRelease, updateTarget } from '../../scripts/update-release.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const windows = process.platform === 'win32';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'outask-self-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function appAt(root, { source = false, version = '1.8.0' } = {}) {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  cpSync(join(repo, 'src'), join(root, 'src'), { recursive: true, filter: () => true });
  for (const name of ['self-update', 'update-release', 'install-launcher']) cpSync(join(repo, `scripts/${name}.mjs`), join(root, `scripts/${name}.mjs`));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'outask', type: 'module', version, private: source }));
  if (source) writeFileSync(join(root, 'scripts/install-cli.mjs'), '');
  const entry = "import('../scripts/self-update.mjs').then(({main})=>main(process.argv.slice(2))).catch(e=>{console.error(e.message);process.exitCode=1});\n";
  for (const command of ['tasks', 'outask']) writeFileSync(join(root, 'bin', command), entry);
}

function linkArchive(bin, app) {
  mkdirSync(bin, { recursive: true });
  for (const name of ['tasks', 'outask']) {
    const command = join(bin, windows ? `${name}.cmd` : name);
    if (windows) writeFileSync(command, windowsLauncher(join(app, 'bin/tasks')));
    else symlinkSync(join(app, 'bin/tasks'), command);
  }
}

function snapshot(root) {
  const result = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    result[entry.name] = entry.isDirectory() ? snapshot(path) : createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return result;
}

test('version precedence handles compact tags, numeric components, prereleases and build metadata', () => {
  for (const [a, b, expected] of [
    ['1.8', '1.8.0', 0], ['1.9.0', '1.10.0', -1], ['2.0.0', '1.99.99', 1],
    ['1.8.0-rc.2', '1.8.0-rc.10', -1], ['1.8.0-rc.10', '1.8.0', -1],
    ['1.8.0+one', '1.8.0+two', 0], ['1.8.0-alpha', '1.8.0-alpha.1', -1],
  ]) assert.equal(compareVersions(a, b), expected);
  assert.throws(() => compareVersions('latest', '1.8.0'), /Invalid Outask version/);
});

test('archive checks fetch metadata only, preserve files and never downgrade newer versions', async t => {
  const root = fixture(t), target = updateTarget();
  const metadata = join(root, 'release.json');
  for (const current of ['1.7.1', '1.8', '1.9.0']) {
    writeFileSync(metadata, JSON.stringify({ version: current, target }));
    const before = snapshot(root), calls = [];
    const name = `Outask-1.8-${target}.tar.gz`;
    const result = await updateRelease({ destination: root, target, check: current === '1.7.1', log() {}, fetchRelease: async url => {
      calls.push(url);
      assert.equal(url, latestReleaseUrl);
      return Response.json({ draft: false, prerelease: false, tag_name: 'v1.8', assets: [{ name, state: 'uploaded', browser_download_url: `https://github.com/henryh/outask/releases/download/v1.8/${name}` }] });
    } });
    assert.equal(result.available, current === '1.7.1');
    assert.deepEqual(calls, [latestReleaseUrl]);
    assert.deepEqual(snapshot(root), before);
  }
});

test('failed checks preserve the installed application', async t => {
  const root = fixture(t);
  writeFileSync(join(root, 'release.json'), JSON.stringify({ version: '1.7.1', target: updateTarget() }));
  const before = snapshot(root);
  await assert.rejects(updateRelease({ destination: root, check: true, fetchRelease: async () => { throw Error('offline'); } }), /UPDATE_FAILED.*offline/);
  assert.deepEqual(snapshot(root), before);
});

test('archive discovery retains custom command directories and selects the running copy', t => {
  const root = fixture(t);
  for (const label of ['first', 'second']) {
    const destination = join(root, label, 'Outask'), app = join(destination, 'app'), bin = join(root, `${label} commands 東京`);
    appAt(app); linkArchive(bin, app);
    writeFileSync(join(destination, 'release.json'), JSON.stringify({ version: '1.8', target: updateTarget(), bin }));
    const selected = installation(app);
    assert.equal(selected.kind, 'archive');
    assert.equal(selected.bin, bin);
    assert.equal(selected.root, destination);
  }
});

test('archive discovery supports existing metadata without a bin field through owned PATH commands', t => {
  const root = fixture(t), app = join(root, 'Outask/app'), bin = join(root, 'legacy commands');
  appAt(app); linkArchive(bin, app);
  writeFileSync(join(dirname(app), 'release.json'), JSON.stringify({ version: '1.8', target: updateTarget() }));
  const previous = process.env.PATH;
  try {
    process.env.PATH = `${bin}${delimiter}${previous}`;
    assert.equal(installation(app).bin, bin);
  } finally { process.env.PATH = previous; }
});

test('global npm discovery preserves the owning prefix and distinguishes local npm/npx', t => {
  const root = fixture(t), prefix = join(root, 'npm prefix 東京');
  const app = join(prefix, windows ? 'node_modules/outask' : 'lib/node_modules/outask');
  appAt(app);
  if (windows) writeFileSync(join(prefix, 'outask.cmd'), '@echo off\r\nnode "%~dp0%\\node_modules\\outask\\bin\\outask" %*\r\n');
  else { mkdirSync(join(prefix, 'bin')); symlinkSync(join(app, 'bin/outask'), join(prefix, 'bin/outask')); }
  assert.equal(installation(app).kind, 'npm');
  assert.equal(installation(app).prefix, prefix);
  const local = join(root, '_npx/example/node_modules/outask');
  appAt(local);
  assert.equal(installation(local).kind, 'local');
});

test('source, local and unknown contexts give guidance without changing their files', t => {
  const root = fixture(t);
  for (const [name, source, kind, pattern] of [
    ['checkout/app', true, 'source', /Source checkout:.*Git workflow/],
    ['project/node_modules/outask', false, 'local', /Local npm\/npx.*npm/],
    ['copied-program', false, 'unknown', /original installer or package manager/],
  ]) {
    const app = join(root, name); appAt(app, { source });
    assert.equal(installation(app).kind, kind);
    const before = snapshot(app);
    for (const args of [['self', 'update'], ['self', 'update', '--check']]) {
      // The fixture entry forwards the self subcommand's arguments directly.
      const result = spawnSync(process.execPath, [join(app, 'bin/outask'), ...args.slice(1)], { encoding: 'utf8', cwd: root });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stdout, pattern);
      assert.deepEqual(snapshot(app), before);
    }
  }
});

test('installed archive --check exposes exit codes without downloads, tar or file changes', t => {
  const root = fixture(t), app = join(root, 'Outask/app');
  appAt(app);
  const target = updateTarget();
  writeFileSync(join(dirname(app), 'release.json'), JSON.stringify({ version: '1.8', target }));
  const preload = join(root, 'fetch.mjs');
  for (const [latest, expected] of [['1.9', 10], ['1.8', 0], ['1.7', 0], ['offline', 1]]) {
    writeFileSync(preload, latest === 'offline' ? "globalThis.fetch=async()=>{throw Error('offline')};" : `globalThis.fetch=async url=>{if(!url.endsWith('/releases/latest'))throw Error('download forbidden');return Response.json({draft:false,prerelease:false,tag_name:'v${latest}',assets:[{name:'Outask-${latest}-${target}.tar.gz',state:'uploaded',browser_download_url:'https://github.com/henryh/outask/releases/download/v${latest}/Outask-${latest}-${target}.tar.gz'}]})};`);
    const before = snapshot(join(root, 'Outask'));
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(app, 'bin/tasks'), 'update', '--check'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    assert.deepEqual(snapshot(join(root, 'Outask')), before);
  }
});

test('self command rejects invalid input before update discovery and requires no project', () => {
  const cli = join(repo, 'bin/outask');
  for (const args of [['self'], ['self', 'update', '42'], ['self', 'update', '--project', 'other'], ['self', 'install']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: tmpdir() });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INVALID_INPUT/);
  }
  const help = spawnSync(process.execPath, [cli, 'self', 'update', '--help'], { encoding: 'utf8', cwd: tmpdir() });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--check/);
});
