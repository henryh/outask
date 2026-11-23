import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNpmPack } from '../scripts/npm-pack.mjs';
import { publicationPlan } from '../../scripts/npm-release.mjs';

const candidate = { name: 'fixture-package', version: '1.6.0', integrity: 'sha512-approved', owner: 'confirmed-owner' };
const owned = { name: candidate.name, maintainers: [{ name: candidate.owner }], versions: {} };

test('npm pack reports one archive as an array or a package-keyed object', () => {
  const archive = { name: 'fixture-package', filename: 'fixture-package-1.6.0.tgz', size: 123 };
  assert.deepEqual(parseNpmPack(JSON.stringify([archive])), archive);
  assert.deepEqual(parseNpmPack(JSON.stringify({ [archive.name]: archive })), archive);
});

test('npm pack rejects invalid JSON and missing, incomplete or ambiguous archive records', () => {
  assert.throws(() => parseNpmPack(''), { code: 'INVALID_RELEASE', message: /returned invalid JSON/ });
  const archive = { filename: 'fixture.tgz', size: 123 };
  for (const report of [{}, [null], [{ size: 123 }], [{ filename: 'fixture.tgz' }], { a: archive, b: archive }]) {
    assert.throws(() => parseNpmPack(JSON.stringify(report)), { code: 'INVALID_RELEASE', message: /one archive/ });
  }
});

test('npm first publication hands off only absent packages; occupied names require confirmed ownership', () => {
  assert.deepEqual(publicationPlan(undefined, candidate), { action: 'bootstrap' });
  assert.throws(() => publicationPlan(owned, { ...candidate, owner: undefined }), /confirmed npm package maintainer/);
  assert.throws(() => publicationPlan({ ...owned, maintainers: [{ name: 'another-owner' }] }, candidate), /verify ownership/);
  assert.deepEqual(publicationPlan(owned, candidate), { action: 'publish', tag: 'latest' });
  assert.deepEqual(publicationPlan(owned, { ...candidate, version: '1.6.0-rc.1' }), { action: 'publish', tag: 'next' });
});

test('npm retries accept only immutable approved bytes and the expected distribution tag', () => {
  const existing = { ...owned, versions: { [candidate.version]: { dist: { integrity: candidate.integrity } } }, 'dist-tags': { latest: candidate.version } };
  assert.deepEqual(publicationPlan(existing, candidate), { action: 'existing', tag: 'latest' });
  assert.throws(() => publicationPlan(existing, { ...candidate, integrity: 'sha512-other' }), /immutable npm version differs/);
  assert.throws(() => publicationPlan({ ...existing, 'dist-tags': { latest: '1.5.0' } }, candidate), /latest does not select/);
});

test('npm publisher refuses a local invocation before registry or credential access', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('../../scripts/npm-release.mjs', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  const result = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: undefined },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires the approved owner-merged Release workflow/);
});
