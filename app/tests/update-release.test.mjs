import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { latestAsset, latestReleaseUrl, updateRelease, updateTarget } from '../scripts/update-release.mjs';

function release(target = 'linux-x64', version = '1.4') {
  const name = `Outask-${version}-${target}.tar.gz`;
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: [{ name, state: 'uploaded',
    browser_download_url: `https://github.com/henryh/outask/releases/download/v${version}/${name}` }] };
}

test('Latest selects the exact native archive and excludes drafts, prereleases and missing assets', () => {
  for (const [platform, arch, target] of [['linux', 'x64', 'linux-x64'], ['darwin', 'arm64', 'macos-arm64'], ['win32', 'x64', 'windows-x64']]) {
    assert.equal(updateTarget(platform, arch), target);
    assert.equal(latestAsset(release(target), target).name, `Outask-1.4-${target}.tar.gz`);
  }
  assert.throws(() => updateTarget('darwin', 'x64'), /Unsupported platform/);
  for (const invalid of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.4-rc.1' }, { assets: [] }]) {
    assert.throws(() => latestAsset({ ...release(), ...invalid }, 'linux-x64'));
  }
  const redirected = release();
  redirected.assets[0].browser_download_url = 'https://example.org/archive';
  assert.throws(() => latestAsset(redirected, 'linux-x64'), /no supported archive/);
});

function installation(t) {
  const work = mkdtempSync(join(tmpdir(), 'outask-update-test-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const destination = join(work, 'installed');
  mkdirSync(destination);
  const metadata = JSON.stringify({ version: '1.3', target: 'linux-x64' });
  writeFileSync(join(destination, 'release.json'), metadata);
  writeFileSync(join(destination, 'working'), 'previous working application');
  return { work, destination, metadata, options: { destination, bin: join(work, 'bin'), releases: work, target: 'linux-x64', log() {} },
    preserved() {
      assert.equal(readFileSync(join(destination, 'release.json'), 'utf8'), metadata);
      assert.equal(readFileSync(join(destination, 'working'), 'utf8'), 'previous working application');
    } };
}

test('current version does not download or reinstall', async t => {
  const f = installation(t), calls = [], messages = [];
  await updateRelease({ ...f.options, log: message => messages.push(message), fetchRelease: async url => {
    calls.push(url); return Response.json(release('linux-x64', '1.3'));
  } });
  assert.deepEqual(calls, [latestReleaseUrl]);
  assert.deepEqual(messages, ['Outask v1.3 is already current.']);
  f.preserved();
});

test('resolution and download failures retain the installed application with actionable diagnostics', async t => {
  const f = installation(t);
  for (const fetchRelease of [
    async () => new Response('', { status: 403 }),
    async () => { throw new Error('network unavailable'); },
    async url => url === latestReleaseUrl ? Response.json(release()) : new Response('', { status: 404 }),
  ]) {
    await assert.rejects(updateRelease({ ...f.options, fetchRelease }), /UPDATE_FAILED.*retry update/);
    f.preserved();
  }
});

test('invalid archive and installer failure leave the previous application intact', async t => {
  const f = installation(t);
  const source = join(f.work, 'Outask');
  mkdirSync(join(source, 'app/scripts'), { recursive: true });
  writeFileSync(join(source, 'release.json'), JSON.stringify({ version: '1.4', target: 'linux-x64' }));
  writeFileSync(join(source, 'app/scripts/install-release.mjs'), "console.error('INSTALL_EXISTS: fixture installation denied'); process.exitCode = 1;");
  const archive = join(f.work, 'fixture.tar.gz');
  const packed = spawnSync('tar', ['-czf', archive, '-C', f.work, 'Outask'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  for (const bytes of [Buffer.from('invalid archive'), readFileSync(archive)]) {
    const latest = release(); latest.assets[0].size = bytes.length;
    const fetchRelease = async url => url === latestReleaseUrl ? Response.json(latest) : new Response(bytes);
    await assert.rejects(updateRelease({ ...f.options, fetchRelease }), /UPDATE_FAILED: could not (extract latest archive|install latest release)/);
    f.preserved();
  }
});

test('incomplete or corrupted downloads are rejected before extracting or installing', async t => {
  const f = installation(t), bytes = Buffer.from('downloaded bytes');
  for (const integrity of [{ size: bytes.length + 1 }, { size: bytes.length, digest: 'sha256:incorrect' }]) {
    const latest = release(); Object.assign(latest.assets[0], integrity);
    await assert.rejects(updateRelease({ ...f.options, fetchRelease: async url =>
      url === latestReleaseUrl ? Response.json(latest) : new Response(bytes) }), /UPDATE_FAILED: could not download.*differs from GitHub/);
    f.preserved();
  }
});
