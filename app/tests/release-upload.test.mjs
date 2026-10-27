import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { distributionVersion } from '../src/version.mjs';
import { approvedNotes } from './helpers/release-fixture.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(t, packageVersion = '0.16.0') {
  const root = mkdtempSync(join(tmpdir(), 'outask-upload-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['app/scripts', 'app/src', 'scripts', 'dist', 'tools']) mkdirSync(join(root, dir), { recursive: true });
  for (const name of ['scripts/release-upload.mjs', 'scripts/release-notes.mjs', 'scripts/release-config.mjs', 'app/scripts/output.mjs', 'app/src/errors.mjs', 'app/src/limits.mjs', 'app/src/fields.mjs', 'app/src/response.mjs', 'app/src/version.mjs']) cpSync(join(repo, name), join(root, name));
  writeFileSync(join(root, 'app/package.json'), JSON.stringify({version: packageVersion}));
  const version = distributionVersion(packageVersion);
  const assets = ['linux-x64', 'macos-arm64', 'windows-x64'].map((target) => {
    const name = `Outask-${version}-${target}.tar.gz`;
    writeFileSync(join(root, 'dist', name), 'verified archive');
    return { name, size: 16, state: 'uploaded', digest: `sha256:${createHash('sha256').update('verified archive').digest('hex')}` };
  });
  const notes = join(root, 'notes.md'), state = join(root, 'state.json'), log = join(root, 'calls.jsonl');
  writeFileSync(join(root, 'tools/git'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'status') { console.log(process.env.DIRTY ? ' M app/cli.mjs' : ''); process.exit(0); }
if (args.includes('--verify')) process.exit(process.env.MISSING_TAG || args.at(-1) !== 'v${version}' ? 1 : 0);
console.log(args[1] === 'HEAD' && process.env.MISMATCH ? 'different' : 'release-commit');
`, { mode: 0o755 });
  writeFileSync(join(root, 'tools/gh'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
let state = JSON.parse(fs.readFileSync(process.env.RELEASE_STATE, 'utf8'));
if (args[0] === 'api') {
  if (args[1].includes('/releases/tags/') && state?.draft) { console.error('HTTP 404: draft lookup by tag is unavailable'); process.exit(1); }
  if (args[1].endsWith('/releases/latest')) { console.log(JSON.stringify({tag_name: process.env.WRONG_LATEST || 'v${version}'})); process.exit(0); }
  if (!state || (!args[1].includes('/releases/tags/') && args[1] !== 'https://api.github.com/repos/owner/project/releases/' + state.id)) process.exit(1);
  console.log(JSON.stringify(state)); process.exit(0);
}
if (args[1] === 'view') {
  if (!state) process.exit(1);
  if (args.includes('--json')) {
    if (args[args.indexOf('--json') + 1] !== 'apiUrl') process.exit(1);
    console.log('https://api.github.com/repos/owner/project/releases/' + state.id);
  }
  process.exit(0);
}
if (args[1] === 'create') state = {id: 42, draft: true, assets: [], name: args[args.indexOf('--title')+1], body: fs.readFileSync(args[args.indexOf('--notes-file')+1], 'utf8')};
if (args[1] === 'upload') {
  if (process.env.UPLOAD_FAIL) process.exit(1);
  if (process.env.MUTATE_NOTES) fs.writeFileSync(process.env.SOURCE_NOTES, 'changed after validation\\n');
  for (const file of args.filter(a => a.endsWith('.tar.gz'))) {
    const bytes = fs.readFileSync(file);
    state.assets.push({name: path.basename(file), size: bytes.length, state: 'uploaded', digest: 'sha256:' + require('node:crypto').createHash('sha256').update(bytes).digest('hex')});
  }
}
if (args[1] === 'edit') state.draft = false;
fs.writeFileSync(process.env.RELEASE_STATE, JSON.stringify(state));
`, { mode: 0o755 });
  return { root, notes, assets, version,
    invoke({ existing = null, notesText = approvedNotes(version), ...env } = {}) {
      rmSync(log, { force: true }); writeFileSync(notes, notesText); writeFileSync(state, JSON.stringify(existing));
      const result = spawnSync(process.execPath, ['scripts/release-upload.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, REPO: 'owner/project', TARGETS: '', RELEASE_NOTES_FILE: notes, SOURCE_NOTES: notes, PATH: join(root, 'tools'), CALL_LOG: log, RELEASE_STATE: state, ...env } });
      assert.ifError(result.error);
      return { ...result, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [], release: JSON.parse(readFileSync(state, 'utf8')) };
    },
    existing(assets = [], draft = true) { return { id: 42, draft, assets, name: `Outask v${version}`, body: approvedNotes(version) }; },
  };
}
const mutations = (result) => result.calls.filter(args => ['create', 'upload', 'edit', 'delete-asset'].includes(args[1]));

test('recovery preserves the title, assets and exact notes of an already-published legacy release', t => {
  const f = fixture(t, '1.4.0');
  writeFileSync(join(f.root, 'app/package.json'), JSON.stringify({ name: 'task-tracker-local', version: '1.4.0' }));
  const assets = f.assets.map(asset => {
    const name = asset.name.replace('Outask-', 'OutaskAI-');
    renameSync(join(f.root, 'dist', asset.name), join(f.root, 'dist', name));
    return { ...asset, name };
  });
  const notes = approvedNotes(f.version).replaceAll('Outask-', 'OutaskAI-').replace('Outask ', 'Outask AI ').replaceAll('outask ', 'tasks ');
  const existing = { id: 42, draft: false, assets, name: 'Outask AI v1.4', body: notes };
  const result = f.invoke({ existing, notesText: notes });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.release, existing);
  assert.deepEqual(mutations(result), []);
});

test('publication stages all verified archives in a draft with the exact approved notes before publishing', t => {
  const f = fixture(t);
  const result = f.invoke({ MUTATE_NOTES: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(mutations(result).map(args => args[1]), ['create', 'upload', 'edit']);
  assert.ok(result.calls.find(args => args[1] === 'create').includes('--draft'));
  assert.ok(!result.calls.find(args => args[1] === 'create').includes('--prerelease'));
  assert.ok(result.calls.find(args => args[1] === 'edit').includes('--latest'));
  assert.ok(result.calls.some(args => args[0] === 'api' && args[1] === 'repos/owner/project/releases/latest'));
  assert.equal(result.release.body, approvedNotes(f.version));
  assert.equal(result.release.name, 'Outask v0.16');
  assert.equal(result.release.draft, false);
  assert.equal(result.release.assets.length, 3);
  assert.equal(readFileSync(f.notes, 'utf8'), 'changed after validation\n');
});

test('failed publication leaves a draft and retry uploads only missing assets', t => {
  const f = fixture(t);
  const failed = f.invoke({ UPLOAD_FAIL: '1' });
  assert.notEqual(failed.status, 0);
  assert.equal(failed.release.draft, true);
  assert.deepEqual(mutations(failed).map(args => args[1]), ['create', 'upload']);
  const result = f.invoke({ existing: f.existing([f.assets[0]]) });
  assert.equal(result.status, 0, result.stderr);
  const upload = result.calls.find(args => args[1] === 'upload');
  assert.equal(upload.filter(arg => arg.endsWith('.tar.gz')).length, 2);
  assert.ok(!upload.includes('--clobber'));
});

test('retry of a published release is read-only and mismatches never replace contents', t => {
  const f = fixture(t);
  const existing = f.existing(f.assets, false);
  const identical = f.invoke({ existing });
  assert.equal(identical.status, 0, identical.stderr);
  assert.equal(mutations(identical).length, 0);
  for (const changed of [
    {...existing, body: 'other notes'},
    {...existing, name: 'other title'},
    {...existing, assets: f.assets.slice(1)},
    {...existing, assets: [{...f.assets[0], digest: 'sha256:other'}, ...f.assets.slice(1)]},
    {...existing, assets: [...f.assets, {name: 'unexpected'}]},
  ]) {
    const result = f.invoke({existing: changed});
    assert.notEqual(result.status, 0);
    assert.equal(mutations(result).length, 0);
  }
});

test('partial platform uploads retain the draft until all three archives are present', t => {
  const f = fixture(t);
  const result = f.invoke({TARGETS: 'linux-x64'});
  assert.notEqual(result.status, 0);
  assert.equal(result.release.draft, true);
  assert.equal(result.release.assets.length, 1);
  assert.ok(!result.calls.some(args => args[1] === 'edit'));
});

test('patch and prerelease identifiers remain complete', t => {
  for (const version of ['0.16.2', '0.16.0-rc.1']) {
    const f = fixture(t, version), result = f.invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.release.name, `Outask v${f.version}`);
    const edit = result.calls.find(args => args[1] === 'edit');
    assert.ok(edit.includes(version.includes('-') ? '--latest=false' : '--latest'));
    if (version.includes('-')) assert.ok(!result.calls.some(args => args[1]?.endsWith('/releases/latest')));
    assert.ok(result.release.assets.every(asset => asset.name.includes(`-${f.version}-`)));
  }
});

test('invalid notes and publication prerequisites fail before remote mutations', t => {
  const f = fixture(t), valid = approvedNotes(f.version);
  for (const env of [
    {RELEASE_NOTES_FILE: ''}, {TARGETS: 'unsupported-platform'}, {MISSING_TAG: '1'}, {MISMATCH: '1'}, {DIRTY: '1'},
    {notesText: '# Duplicate title\n' + valid},
    {notesText: valid.replace('## Current version', '## Missing')},
    {notesText: valid.replace('extract the archive', 'download the archive')},
    {notesText: valid.replace('open that directory', 'continue')},
    {notesText: valid.replace('Node.js 22.23.3 or later', 'Node.js')},
    {notesText: valid.replace('./Install.cmd', './install.sh')},
    {notesText: valid.replace('./Install.command\n', '')},
    {notesText: valid.replace('./install.sh', './Install.command')},
    {notesText: valid.replace('./Install.cmd', './install.cmd')},
    {notesText: valid.replace('Install.cmd   & rem cmd.exe', 'Install.cmd   # cmd.exe')},
    {notesText: valid.replace('  # PowerShell', '')},
    {notesText: valid.replace('./install.sh', 'tar -xzf file\n./install.sh')},
    {notesText: valid.replace('tasks create', 'tasks search')},
    {notesText: valid.replace('/v0.16/', '/v0.16.0/')},
  ]) {
    const result = f.invoke(env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.equal(mutations(result).length, 0);
  }
});

test('release notes need not retain the extracted download directory', t => {
  const f = fixture(t);
  for (const install of [
    'Extract the archive. Open the directory Outask in a terminal and run:',
    'Download the archive, extract it in a directory you will keep, open that directory in a terminal and run:',
  ]) {
    const notes = approvedNotes(f.version).replace('Download and extract the archive, open that directory in a terminal and run:', install);
    const result = f.invoke({ notesText: notes, existing: { ...f.existing(f.assets, false), body: notes } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(mutations(result).length, 0);
    assert.equal(result.release.body, notes);
  }
});

test('mixed full-SemVer zero-patch archives fail before remote mutations', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'dist/Outask-0.16.0-linux-x64.tar.gz'), 'stale');
  const result = f.invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Full-SemVer/);
  assert.equal(mutations(result).length, 0);
});

test('partial-target invocation cannot publish or confirm unverified unselected assets', t => {
  const f = fixture(t);
  for (const draft of [true, false]) {
    for (const assets of [f.assets.slice(0, 1), [f.assets[0], f.assets[1], {...f.assets[2], digest: 'sha256:wrong'}]]) {
      const result = f.invoke({TARGETS: 'linux-x64', existing: f.existing(assets, draft)});
      assert.notEqual(result.status, 0);
      assert.equal(mutations(result).length, 0);
    }
  }
  rmSync(join(f.root, 'dist', f.assets[2].name));
  const result = f.invoke({TARGETS: 'linux-x64', existing: f.existing(f.assets, false)});
  assert.notEqual(result.status, 0);
  assert.equal(mutations(result).length, 0);
});


test('a complete draft resumes by release ID when tag metadata returns 404', t => {
  const f = fixture(t);
  const result = f.invoke({existing: f.existing(f.assets)});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(mutations(result).map(args => args[1]), ['edit']);
  assert.equal(result.release.id, 42);
  assert.equal(result.release.body, approvedNotes(f.version));
  assert.deepEqual(result.release.assets, f.assets);
  assert.equal(result.release.draft, false);
});


test('retry preserves approved v1.0 installer commands for draft and published releases', t => {
  const f = fixture(t, '1.0.0');
  const original = approvedNotes(f.version)
    .replace('Linux:\n', 'Linux/macOS:\n')
    .replace('\nmacOS:\n\n```sh\n./Install.command\n```\n', '')
    .replaceAll('Install.cmd', 'install.cmd');
  const separateWindows = original.replace(
    'Windows:\n\n```text\n./install.cmd  # PowerShell\ninstall.cmd   & rem cmd.exe\n```',
    'Windows PowerShell:\n\n```powershell\n./install.cmd\n```\n\nWindows cmd.exe:\n\n```bat\ninstall.cmd\n```',
  );
  assert.match(original, /Linux\/macOS:/);
  assert.doesNotMatch(original, /Install\.command|Install\.cmd/);
  assert.match(separateWindows, /Windows PowerShell:/);
  for (const notes of [original, separateWindows]) {
    for (const draft of [true, false]) {
      const result = f.invoke({notesText: notes, existing: {...f.existing(f.assets, draft), body: notes}});
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(mutations(result).map(args => args[1]), draft ? ['edit'] : []);
      assert.equal(result.release.body, notes);
    }
  }
});

test('publication fails verification when GitHub Latest does not resolve the published stable tag', t => {
  const f = fixture(t);
  const result = f.invoke({ WRONG_LATEST: 'v0.15' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub Latest resolves v0.15/);
  assert.equal(result.release.draft, false);
  const retry = f.invoke({ existing: result.release, WRONG_LATEST: 'v0.15' });
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /GitHub Latest resolves v0.15/);
  assert.equal(mutations(retry).length, 0);
  assert.deepEqual(retry.release, result.release);
  const verified = f.invoke({ existing: result.release });
  assert.equal(verified.status, 0, verified.stderr);
  assert.ok(verified.calls.some(args => args[0] === 'api' && args[1] === 'repos/owner/project/releases/latest'));
  assert.equal(mutations(verified).length, 0);
  assert.deepEqual(verified.release, result.release);
});
