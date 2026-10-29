import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { archiveChecksums, parseChecksums, verifyArchive } from '../../scripts/release-checksums.mjs';
import { archiveName, hostTarget, targets } from '../../scripts/release-config.mjs';
import { approvedNotes } from './helpers/release-fixture.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const version = '1.6';

function archives(t) {
  const root = mkdtempSync(join(tmpdir(), 'outask-checksums-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const target of targets) writeFileSync(join(root, archiveName(target, version)), `accepted ${target} bytes`);
  return root;
}

test('SHA256SUMS deterministically lists exactly the three final archive digests', t => {
  const root = archives(t);
  writeFileSync(join(root, archiveName('linux-x64', version)), 'abc');
  const checksums = archiveChecksums(root, version);
  assert.ok(checksums.startsWith(`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  Outask-${version}-linux-x64.tar.gz\n`));
  assert.equal(archiveChecksums(root, version), checksums);
  assert.equal(checksums.split('\n').length, 4);
  const entries = parseChecksums(checksums, version);
  assert.deepEqual([...entries.keys()], targets.map(target => archiveName(target, version)));
  for (const target of targets) {
    const name = archiveName(target, version);
    verifyArchive(readFileSync(join(root, name)), name, checksums, version);
  }
  rmSync(join(root, archiveName(targets[2], version)));
  assert.throws(() => archiveChecksums(root, version), /ENOENT/);
});

test('checksum validation rejects malformed, missing, duplicate and unexpected entries and tampering', t => {
  const root = archives(t), checksums = archiveChecksums(root, version);
  const lines = checksums.trimEnd().split('\n');
  for (const invalid of [
    checksums.trimEnd(), checksums.replace('  Outask', ' Outask'), checksums.replace(/^[a-f0-9]/, 'z'),
    lines.slice(1).join('\n') + '\n', `${checksums}${lines[0]}\n`,
    checksums.replace('linux-x64.tar.gz', 'unsupported.tar.gz'), `${checksums}\n`,
  ]) assert.throws(() => parseChecksums(invalid, version), /SHA256SUMS/);
  assert.throws(() => verifyArchive(Buffer.from('tampered'), archiveName(targets[0], version), checksums, version), /mismatch/);
});

test('downloaded acceptance verifies checksums before running installed smoke', t => {
  const root = archives(t);
  for (const directory of ['scripts', 'app/src', 'app/scripts', 'app/mcp/tests', 'docs', 'tools']) mkdirSync(join(root, directory), { recursive: true });
  for (const name of ['scripts/ci.mjs', 'scripts/release-checksums.mjs', 'scripts/release-config.mjs', 'scripts/release-notes.mjs', 'app/src/errors.mjs', 'app/src/limits.mjs', 'app/src/fields.mjs', 'app/src/response.mjs', 'app/src/version.mjs']) cpSync(join(repo, name), join(root, name));
  writeFileSync(join(root, 'app/package.json'), JSON.stringify({ version: '1.6.0', type: 'module' }));
  const notes = join(root, 'docs/release-notes.md');
  writeFileSync(notes, approvedNotes(version, { checksums: true }));
  writeFileSync(join(root, 'SHA256SUMS'), archiveChecksums(root, version));
  const marker = join(root, 'smoke-ran');
  writeFileSync(join(root, 'app/mcp/tests/distribution-smoke.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'yes');`);
  writeFileSync(join(root, 'tools/gh'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
const name = args[args.indexOf('--pattern') + 1];
fs.copyFileSync(path.join(process.env.DOWNLOAD_SOURCE, name), path.join(args[args.indexOf('--dir') + 1], name));
`, { mode: 0o755 });
  const invoke = () => spawnSync(process.execPath, ['scripts/ci.mjs', 'downloaded'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, REPO: 'owner/project', PATH: join(root, 'tools'), DOWNLOAD_SOURCE: root },
  });
  const good = invoke();
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /Published archive SHA256: PASS/);
  assert.ok(existsSync(marker));
  rmSync(marker);
  const checksumPath = join(root, 'SHA256SUMS'), valid = readFileSync(checksumPath, 'utf8');
  const wrongDigest = valid.split('\n').map(line => line.endsWith(archiveName(hostTarget(), version)) ? line.replace(/^[a-f0-9]{64}/, '0'.repeat(64)) : line).join('\n');
  for (const invalid of [wrongDigest, valid.split('\n').slice(1).join('\n')]) {
    writeFileSync(checksumPath, invalid);
    const result = invoke();
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(marker));
  }
  writeFileSync(checksumPath, valid);
  writeFileSync(join(root, archiveName(hostTarget(), version)), 'tampered');
  assert.notEqual(invoke().status, 0);
  assert.ok(!existsSync(marker));
  rmSync(checksumPath);
  assert.notEqual(invoke().status, 0);
  assert.ok(!existsSync(marker));
  writeFileSync(notes, approvedNotes(version));
  const historical = invoke();
  assert.equal(historical.status, 0, historical.stderr);
  assert.ok(existsSync(marker));
});
