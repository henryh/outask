#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { releaseNotes } from './release-notes.mjs';
import { archiveChecksums, checksumName, checksumsRequired } from './release-checksums.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail } from '../app/src/errors.mjs';
import { reportError } from '../app/scripts/output.mjs';
import { archiveName, distRoot, output, rejectMixedArchives, releaseTitle, releaseVersion, requireArchives, run, succeeds, tagName, targetList, targets, version } from './release-config.mjs';

function originRepo() {
  const remote = output('git', ['remote', 'get-url', 'origin']);
  if (!remote) return '';
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  const https = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  return https ? https[1] : '';
}

function repository() {
  const explicit = process.env.REPO?.trim();
  if (explicit) return explicit;
  return output('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']) || originRepo();
}

function readRelease(repo, tag) {
  // Drafts are not returned by GitHub's release-by-tag endpoint.
  const apiUrl = run('gh', ['release', 'view', tag, '--repo', repo, '--json', 'apiUrl', '--jq', '.apiUrl'], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim();
  return JSON.parse(run('gh', ['api', apiUrl], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout);
}

function verifyAssets(release, required) {
  for (const name of required) {
    const asset = release.assets.find((asset) => asset.name === name);
    const local = readFileSync(join(distRoot, name));
    const digest = `sha256:${createHash('sha256').update(local).digest('hex')}`;
    if (!asset || asset.size !== local.length || asset.digest !== digest || asset.state !== 'uploaded') {
      fail('INVALID_INPUT', `Existing asset ${name} is missing or differs from the verified archive; refusing replacement`);
    }
  }
}

function verifyAssetNames(release, expected) {
  const names = release.assets.map(asset => asset.name);
  if (names.some(name => !expected.includes(name)) || new Set(names).size !== names.length) {
    fail('INVALID_INPUT', 'Existing release contains unexpected or duplicate assets; refusing to change it');
  }
}

function verifyChecksums(releaseId) {
  if (readFileSync(join(distRoot, checksumName), 'utf8') !== archiveChecksums(distRoot, releaseId)) {
    fail('INVALID_INPUT', 'Local SHA256SUMS differs from the verified archives; refusing publication');
  }
}

let approvedNotesDirectory;
try {
  const packageId = version();
  const releaseId = releaseVersion();
  const tag = tagName();
  const repo = repository();
  if (!repo) fail('INVALID_INPUT', 'REPO is required, for example: make release-upload REPO=owner/repo');
  const selected = targetList();
  const selectedNames = selected.map(target => archiveName(target, releaseId));
  const expectedNames = targets.map(target => archiveName(target, releaseId));
  const approved = releaseNotes(releaseId, packageId, repo, targets, process.env.RELEASE_NOTES_FILE, { recovery: true });
  const withChecksums = checksumsRequired(packageId);
  if (withChecksums) {
    selectedNames.push(checksumName);
    expectedNames.push(checksumName);
  }
  if (!succeeds('git', ['rev-parse', '--verify', tag])) {
    fail('INVALID_INPUT', `Tag ${tag} is required. Inspect or retry the approved Release workflow; do not tag manually`);
  }
  const fullTag = `v${packageId}`;
  if (fullTag !== tag && succeeds('git', ['rev-parse', '--verify', fullTag])) {
    fail('INVALID_INPUT', `Tag ${fullTag} must not coexist with compact zero-patch tag ${tag}`);
  }
  const gitOutput = (args) => run('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim();
  if (gitOutput(['rev-parse', 'HEAD']) !== gitOutput(['rev-parse', `${tag}^{commit}`])) {
    fail('INVALID_INPUT', `HEAD must match ${tag}; build and upload from that tag`);
  }
  if (gitOutput(['status', '--porcelain', '--untracked-files=no'])) {
    fail('INVALID_INPUT', 'Tracked files must be clean before uploading a release');
  }
  rejectMixedArchives(packageId);
  requireArchives(selected, releaseId);
  if (withChecksums) {
    requireArchives(targets, releaseId);
    const checksums = archiveChecksums(distRoot, releaseId);
    const path = join(distRoot, checksumName);
    if (existsSync(path) && readFileSync(path, 'utf8') !== checksums) {
      fail('INVALID_INPUT', 'Local SHA256SUMS differs from the verified archives; refusing publication');
    }
    writeFileSync(path, checksums);
  }
  approvedNotesDirectory = mkdtempSync(join(tmpdir(), 'outask-release-notes-'));
  const approvedNotesPath = join(approvedNotesDirectory, 'release-notes.md');
  writeFileSync(approvedNotesPath, approved.notes, { flag: 'wx', mode: 0o400 });
  const releaseExists = succeeds('gh', ['release', 'view', tag, '--repo', repo]);
  let release;
  if (releaseExists) {
    release = readRelease(repo, tag);
    if (release.body !== approved.notes || release.name !== releaseTitle(releaseId)) {
      fail('INVALID_INPUT', 'Existing release title/description differs from the approved release; refusing to rewrite it');
    }
    verifyAssetNames(release, expectedNames);
    verifyAssets(release, (withChecksums ? expectedNames : selectedNames).filter(name => release.assets.some(asset => asset.name === name)));
  } else {
    run('gh', ['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', ...(packageId.includes('-') ? ['--prerelease'] : []), '--title', releaseTitle(releaseId), '--notes-file', approvedNotesPath]);
    release = { draft: true, assets: [] };
  }
  const missing = selectedNames.filter(name => !release.assets.some(asset => asset.name === name));
  if (!release.draft) {
    requireArchives(targets, releaseId);
    if (withChecksums) verifyChecksums(releaseId);
    verifyAssets(release, expectedNames);
  } else {
    if (missing.length) run('gh', ['release', 'upload', tag, '--repo', repo, ...missing.map(name => join(distRoot, name))]);
    const final = readRelease(repo, tag);
    if (!expectedNames.every(name => final.assets.some((asset) => asset.name === name && asset.state === 'uploaded'))) {
      fail('INVALID_INPUT', 'Draft retained: all required uploaded release assets are required before publication');
    }
    if (final.body !== approved.notes || final.name !== releaseTitle(releaseId)) {
      fail('INVALID_INPUT', 'Draft description changed during upload; refusing publication');
    }
    verifyAssetNames(final, expectedNames);
    requireArchives(targets, releaseId);
    if (withChecksums) verifyChecksums(releaseId);
    verifyAssets(final, expectedNames);
    run('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', packageId.includes('-') ? '--latest=false' : '--latest']);
  }
  if (!packageId.includes('-')) {
    const latest = JSON.parse(run('gh', ['api', `repos/${repo}/releases/latest`], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout);
    if (latest.tag_name !== tag) fail('COMMAND_FAILED', `Published ${tag}, but GitHub Latest resolves ${latest.tag_name}; inspect the Release workflow`);
  }
  console.log(`${tag}: ${release.draft ? 'published' : 'already published with identical notes and assets'}`);
} catch (error) {
  reportError(error);
  process.exitCode = 1;
} finally {
  if (approvedNotesDirectory) rmSync(approvedNotesDirectory, { recursive: true, force: true });
}
