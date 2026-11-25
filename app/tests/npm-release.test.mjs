import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNpmPack } from '../scripts/npm-pack.mjs';
import { publicationPlan, waitForPublication } from '../../scripts/npm-release.mjs';

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

function visibilityFixture(responses, timeoutMs = 180000) {
  let elapsed = 0;
  let reads = 0;
  const options = {
    timeoutMs,
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
    read: async () => {
      const response = responses[Math.min(reads++, responses.length - 1)];
      if (response instanceof Error) throw response;
      return response;
    },
  };
  return { options, get reads() { return reads; }, get elapsed() { return elapsed; } };
}

test('npm waits for the approved version and tag after an accepted publish', async () => {
  const tagLag = { ...owned, versions: { [candidate.version]: { dist: { integrity: candidate.integrity } } }, 'dist-tags': { latest: '1.5.0' } };
  const visible = { ...tagLag, 'dist-tags': { latest: candidate.version } };
  const temporaryError = Object.assign(new Error('npm registry returned HTTP 503'), { status: 503 });
  const fixture = visibilityFixture([owned, temporaryError, tagLag, visible]);
  await waitForPublication({ ...candidate, tag: 'latest' }, fixture.options);
  assert.equal(fixture.reads, 4);
  assert.equal(fixture.elapsed, 15000);
});

test('npm visibility timeout names the last pending state or registry error', async () => {
  for (const [response, last] of [[owned, /version not visible/],
    [{ ...owned, versions: { [candidate.version]: { dist: { integrity: candidate.integrity } } }, 'dist-tags': { latest: '1.5.0' } }, /latest points to 1\.5\.0/],
    [Object.assign(new Error('npm registry returned HTTP 503'), { status: 503 }), /HTTP 503/]]) {
    const fixture = visibilityFixture([response], 10000);
    await assert.rejects(waitForPublication({ ...candidate, tag: 'latest' }, fixture.options),
      (error) => /fixture-package@1\.6\.0 visibility timed out after 10s/.test(error.message) && last.test(error.message));
    assert.equal(fixture.reads, 2);
  }
});

test('npm default visibility deadline is three minutes', async () => {
  const fixture = visibilityFixture([owned]);
  await assert.rejects(waitForPublication({ ...candidate, tag: 'latest' }, fixture.options), /timed out after 180s/);
  assert.equal(fixture.elapsed, 180000);
  assert.equal(fixture.reads, 36);
});

test('npm publication verification rejects different bytes and permanent registry errors immediately', async () => {
  const wrong = { ...owned, versions: { [candidate.version]: { dist: { integrity: 'sha512-other' } } } };
  const forbidden = Object.assign(new Error('npm registry returned HTTP 401'), { status: 401 });
  for (const [response, expected] of [[wrong, /integrity differs/], [forbidden, /HTTP 401/]]) {
    const fixture = visibilityFixture([response]);
    await assert.rejects(waitForPublication({ ...candidate, tag: 'latest' }, fixture.options), expected);
    assert.equal(fixture.reads, 1);
    assert.equal(fixture.elapsed, 0);
  }
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
