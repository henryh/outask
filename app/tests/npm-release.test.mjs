import assert from 'node:assert/strict';
import test from 'node:test';
import { publicationPlan } from '../../scripts/npm-release.mjs';

const candidate = { name: 'fixture-package', version: '1.6.0', integrity: 'sha512-approved', owner: 'confirmed-owner' };
const owned = { name: candidate.name, maintainers: [{ name: candidate.owner }], versions: {} };

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
