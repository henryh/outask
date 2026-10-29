import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { approvedNotes } from './helpers/release-fixture.mjs';
import { distributionVersion } from '../src/version.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(t, {version = '0.16.0', previousVersion = '0.15.0', extra = false, lockVersion = version, notesChange = false, squash = false, checksums = true} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'outask-release-pr-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const dir of ['app/scripts', 'app/src', 'scripts', 'docs']) mkdirSync(join(root, dir), {recursive: true});
  for (const name of ['scripts/release-recovery.mjs', 'scripts/release-pr.mjs', 'scripts/release-notes.mjs', 'scripts/release-config.mjs', 'app/scripts/output.mjs', 'app/src/errors.mjs', 'app/src/limits.mjs', 'app/src/fields.mjs', 'app/src/response.mjs', 'app/src/version.mjs']) cpSync(join(source, name), join(root, name));
  const git = (...args) => {
    const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
  const packageFiles = (pkgVersion, lockVersion = pkgVersion) => {
    writeFileSync(join(root, 'app/package.json'), JSON.stringify({version: pkgVersion, engines: {node: '>=22.23.3'}}));
    writeFileSync(join(root, 'app/package-lock.json'), JSON.stringify({version: lockVersion, packages: {'': {version: lockVersion}}}));
  };
  packageFiles(previousVersion);
  git('add', '.'); git('commit', '-qm', 'Baseline');
  const base = git('rev-parse', 'HEAD');
  git('switch', '-c', 'release-0.16');
  packageFiles(version, lockVersion);
  const id = distributionVersion(version);
  writeFileSync(join(root, 'docs/release-notes.md'), approvedNotes(id, { checksums }));
  if (extra) writeFileSync(join(root, 'app/code.mjs'), 'unreviewed code\n');
  git('add', '.'); git('commit', '-qm', 'Release');
  const head = git('rev-parse', 'HEAD');
  git('switch', 'main');
  if (notesChange) {
    mkdirSync(join(root, 'docs'), {recursive: true});
    writeFileSync(join(root, 'docs/release-notes.md'), 'different destination notes\n');
    git('add', '.'); git('commit', '-qm', 'Destination changed');
    const merge = spawnSync('git', ['merge', '--no-ff', 'release-0.16', '-m', 'Merge'], {cwd: root, encoding: 'utf8'});
    assert.notEqual(merge.status, 0);
    writeFileSync(join(root, 'docs/release-notes.md'), approvedNotes(id).replace('Added a user-visible capability.', 'Other content.'));
    git('add', '.'); git('commit', '-qm', 'Resolve with changed notes');
  } else if (squash) {
    git('merge', '--squash', 'release-0.16'); git('commit', '-qm', 'Squashed release');
  } else git('merge', '--no-ff', 'release-0.16', '-m', 'Merge');
  const sha = git('rev-parse', 'HEAD');
  const event = {repository: {full_name: 'owner/project', owner: {login: 'owner', type: 'User'}}, pull_request: {
    merged: true, merged_by: {login: 'owner'}, merge_commit_sha: sha, title: `Outask v${id}`,
    head: {ref: 'release-0.16', sha: head, repo: {full_name: 'owner/project'}}, base: {ref: 'main', sha: base},
  }};
  return {event, root, git, invoke(patch = {}, mode = 'gate', script = 'scripts/release-pr.mjs') {
    const value = structuredClone(event); Object.assign(value.pull_request, patch);
    const path = join(root, 'event.json'), output = join(root, 'output');
    writeFileSync(path, JSON.stringify(value)); writeFileSync(join(root, 'approved-release.json'), JSON.stringify(value)); rmSync(output, {force: true});
    const result = spawnSync(process.execPath, [script, mode], {cwd: root, encoding: 'utf8', env: {...process.env, GITHUB_EVENT_PATH: path, GITHUB_OUTPUT: output, RUNNER_TEMP: root}});
    return {...result, output: existsSync(output) ? readFileSync(output, 'utf8') : ''};
  }};
}

test('the owner merge of a dedicated release PR approves its exact revision and compact version', t => {
  const f = fixture(t), result = f.invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /release=true\nversion=0\.16\nprerelease=false/);
  const checked = f.invoke({}, 'check');
  assert.equal(checked.status, 0, checked.stderr);
});

test('ordinary PRs and closed unmerged release PRs skip publication', t => {
  const f = fixture(t);
  for (const patch of [{head: {...f.event.pull_request.head, ref: 'task-50-release-automation'}, title: 'Implement a task'}, {merged: false}, {base: {...f.event.pull_request.base, ref: 'dev'}}]) {
    const result = f.invoke(patch);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'release=false\n');
  }
});

test('new release candidates require their own checksum download link', t => {
  const f = fixture(t, { checksums: false });
  const result = f.invoke();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Downloads must link.*SHA256SUMS/);
});

test('contributor merges, wrong revision, fork release PRs and changed approval title cannot publish', t => {
  const f = fixture(t);
  for (const patch of [
    {merged_by: {login: 'contributor'}}, {merge_commit_sha: f.event.pull_request.head.sha},
    {head: {...f.event.pull_request.head, repo: {full_name: 'other/project'}}},
    {head: {...f.event.pull_request.head, sha: f.event.pull_request.base.sha}}, {title: 'Release without a version'},
  ]) assert.notEqual(f.invoke(patch).status, 0);
});

test('release PRs reject inconsistent versions, squash merges and rewritten approved notes', t => {
  for (const input of [{lockVersion: '0.15.0'}, {squash: true}, {notesChange: true}]) {
    const f = fixture(t, input), result = f.invoke();
    assert.notEqual(result.status, 0, JSON.stringify(input));
  }
});

test('versions must advance and prerelease versions remain identifiable', t => {
  for (const version of ['0.14.0', '0.15.0-rc.1', '0.16.0-01']) assert.notEqual(fixture(t, {version}).invoke().status, 0);
  const result = fixture(t, {version: '0.16.0-rc.1'}).invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /version=0\.16-rc\.1\nprerelease=true/);
});


test('an explicitly titled task PR releases its implementation and version together', t => {
  const f = fixture(t, {extra: true});
  const patch = {head: {...f.event.pull_request.head, ref: 'task-50-release-automation'}};
  const checked = f.invoke(patch, 'check');
  assert.equal(checked.status, 0, checked.stderr);
  const merged = f.invoke(patch);
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.output, /release=true/);
  assert.notEqual(f.invoke({...patch, merged_by: {login: 'contributor'}}).status, 0);
});


test('tag creation and retry push only the annotated tag at the approved merge', t => {
  const f = fixture(t, {extra: true});
  const remote = join(f.root, 'remote.git');
  f.git('init', '--bare', remote);
  f.git('remote', 'add', 'origin', remote);
  const patch = {head: {...f.event.pull_request.head, ref: 'task-50-release-automation'}};
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = f.invoke(patch, 'tag');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.git('--git-dir', remote, 'cat-file', '-t', 'refs/tags/v0.16'), 'tag');
    assert.equal(f.git('--git-dir', remote, 'rev-parse', 'v0.16^{commit}'), f.event.pull_request.merge_commit_sha);
    assert.equal(f.git('--git-dir', remote, 'for-each-ref', '--format=%(refname)', 'refs/heads'), '');
  }
  f.git('tag', '-f', 'v0.16', f.event.pull_request.base.sha);
  const refused = f.invoke(patch, 'tag');
  assert.notEqual(refused.status, 0);
  assert.equal(f.git('--git-dir', remote, 'rev-parse', 'v0.16^{commit}'), f.event.pull_request.merge_commit_sha);
});


test('recovery verifies original approval and existing annotated tag without creating or moving it', t => {
  const f = fixture(t, {extra: true, checksums: false});
  const verify = () => f.invoke({}, 'verify', 'scripts/release-recovery.mjs');
  assert.notEqual(verify().status, 0, 'missing original tag must not be created by recovery');
  assert.equal(f.git('tag', '--list'), '');
  f.git('tag', '-a', 'v0.16', '-m', 'Approved release');
  const verified = verify();
  assert.equal(verified.status, 0, verified.stderr);
  // The correction lives outside the clean, original approved Git checkout.
  const publisher = mkdtempSync(join(tmpdir(), 'outask-recovery-publisher-'));
  t.after(() => rmSync(publisher, {recursive: true, force: true}));
  for (const dir of ['scripts', 'app']) cpSync(join(f.root, dir), join(publisher, dir), {recursive: true});
  const script = join(publisher, 'scripts/release-recovery.mjs');
  const separate = f.invoke({}, 'verify', script);
  assert.equal(separate.status, 0, separate.stderr);
  writeFileSync(join(publisher, 'app/package.json'), JSON.stringify({version: '0.17.0'}));
  assert.notEqual(f.invoke({}, 'verify', script).status, 0, 'tooling version must match the approved release');
  f.git('tag', '-f', 'v0.16', f.event.pull_request.base.sha);
  assert.notEqual(verify().status, 0, 'recovery must not move a mismatched tag');
  assert.equal(f.git('rev-parse', 'v0.16'), f.event.pull_request.base.sha);
});


test('the final task PR promotes an RC to a new stable release after the owner merge', t => {
  const f = fixture(t, {previousVersion: '0.15.0-rc.2', version: '0.15.0', extra: true});
  const patch = {head: {...f.event.pull_request.head, ref: 'task-50-release-automation'}};
  for (const mode of ['check', 'gate']) {
    const result = f.invoke(patch, mode);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'release=true\nversion=0.15\nprerelease=false\n');
  }
  assert.notEqual(f.invoke({...patch, title: 'Outask v0.15-rc.2'}).status, 0);
});
