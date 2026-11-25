import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareScopedPackage, publicationPlan, waitForPublication, scopedName, registry } from '../../scripts/github-packages-release.mjs';
import { version } from '../../scripts/release-config.mjs';

function tar(...args) {
  const result = spawnSync('tar', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('GitHub package keeps the accepted files and launch commands with scoped metadata', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'outask-gpr-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'package');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  const manifest = { name: 'outask', version: version(), repository: { type: 'git', url: 'git+https://github.com/henryh/outask.git', directory: 'app' }, publishConfig: { registry: 'https://registry.npmjs.org/' }, bin: { outask: 'bin/outask', tasks: 'bin/tasks' } };
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(packageRoot, 'package-lock.json'), JSON.stringify({ name: 'outask', version: version(), packages: { '': { name: 'outask', version: version() } } }));
  writeFileSync(join(packageRoot, 'bin/outask'), 'launch payload\n');
  writeFileSync(join(packageRoot, 'bin/tasks'), 'alias payload\n');
  const source = join(root, 'source.tgz');
  const scoped = join(root, 'scoped.tgz');
  tar('-czf', source, '-C', root, 'package');
  const candidate = prepareScopedPackage(source, scoped);
  assert.equal(candidate.name, scopedName);
  assert.equal(candidate.version, version());
  assert.deepEqual(tar('-tzf', source).trim().split('\n').sort(), tar('-tzf', scoped).trim().split('\n').sort());
  assert.equal(tar('-xOzf', scoped, 'package/bin/outask'), 'launch payload\n');
  assert.equal(tar('-xOzf', scoped, 'package/bin/tasks'), 'alias payload\n');
  const out = join(root, 'out');
  mkdirSync(out);
  tar('-xzf', scoped, '-C', out);
  const actual = JSON.parse(readFileSync(join(out, 'package/package.json')));
  const lock = JSON.parse(readFileSync(join(out, 'package/package-lock.json')));
  assert.equal(actual.name, scopedName);
  assert.deepEqual(actual.publishConfig, { access: 'public', registry });
  assert.deepEqual(actual.bin, manifest.bin);
  assert.equal(actual.repository.url, manifest.repository.url);
  assert.equal(lock.name, scopedName);
  assert.equal(lock.packages[''].name, scopedName);
  const second = join(root, 'second.tgz');
  assert.deepEqual(prepareScopedPackage(source, second), candidate);
});

test('GitHub package reruns accept only matching version bytes', () => {
  const candidate = { version: version(), integrity: 'sha512-approved' };
  assert.equal(publicationPlan(undefined, candidate), 'publish');
  assert.equal(publicationPlan({ name: scopedName, versions: {} }, candidate), 'publish');
  assert.equal(publicationPlan({ name: scopedName, versions: { [candidate.version]: { dist: { integrity: candidate.integrity } } } }, candidate), 'existing');
  assert.throws(() => publicationPlan({ name: scopedName, versions: { [candidate.version]: { dist: { integrity: 'sha512-other' } } } }, candidate), /different content/);
});

test('GitHub package waits for matching visible bytes and rejects conflicts', async () => {
  const candidate = { version: version(), integrity: 'sha512-approved' };
  let elapsed = 0;
  let reads = 0;
  const options = { now: () => elapsed, sleep: async ms => { elapsed += ms; }, timeoutMs: 15000 };
  await waitForPublication(candidate, async () => ++reads < 3 ? undefined : { name: scopedName, versions: { [candidate.version]: { dist: { integrity: candidate.integrity } } } }, options);
  assert.equal(reads, 3);
  await assert.rejects(waitForPublication(candidate, async () => ({ name: scopedName, versions: { [candidate.version]: { dist: { integrity: 'sha512-other' } } } }), options), /different content/);
});
