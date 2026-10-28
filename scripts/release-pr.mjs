#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checksumsEnabled, releaseNotes } from './release-notes.mjs';
import { releaseTitle, run, targets } from './release-config.mjs';
import { distributionVersion } from '../app/src/version.mjs';
import { reportError } from '../app/scripts/output.mjs';

export const notesPath = 'docs/release-notes.md';
const releaseFiles = ['app/package-lock.json', 'app/package.json', notesPath];
function git(args) {
  return run('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim();
}
function jsonAt(ref, path) {
  return JSON.parse(git(['show', `${ref}:${path}`]));
}
function compareVersion(a, b) {
  const parse = (value) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
    if (!match) throw new Error(`Unsupported release version: ${value}`);
    const pre = match[4]?.split('.');
    if (pre?.some((part) => /^0\d+$/.test(part))) throw new Error(`Invalid prerelease identifier: ${value}`);
    return { core: match.slice(1, 4).map(BigInt), pre };
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
  if (!left.pre || !right.pre) return left.pre === right.pre ? 0 : left.pre ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function candidate(base, repo, title, { recovery = false } = {}) {
  const pkg = jsonAt('HEAD', 'app/package.json');
  const previous = jsonAt(base, 'app/package.json');
  const lock = jsonAt('HEAD', 'app/package-lock.json');
  if (compareVersion(pkg.version, previous.version) <= 0) throw new Error('Release version must advance the destination version');
  if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('Release package and lockfile versions must agree');
  const changed = git(['diff', '--name-only', base, 'HEAD']).split('\n').sort();
  if (!releaseFiles.every((path) => changed.includes(path))) throw new Error(`Release PR must include changes to ${releaseFiles.join(', ')}`);
  const version = distributionVersion(pkg.version);
  if (title !== releaseTitle(version)) throw new Error(`Release PR title must be ${releaseTitle(version)}`);
  const { notes } = releaseNotes(version, pkg.version, repo, targets, notesPath);
  if (!recovery && !checksumsEnabled(notes, version, repo)) {
    throw new Error('New release notes Downloads must link the release SHA256SUMS asset');
  }
  return { version, tag: `v${version}`, prerelease: pkg.version.includes('-') };
}

export function gate(event, merged = true, options = {}) {
  const pr = event.pull_request;
  if (!pr || pr.base.ref !== 'main') return null;
  // A version in the exact release title explicitly opts a task PR into release.
  if (!pr.head.ref.startsWith('release-') && !pr.title.startsWith('Outask v')) return null;
  const repo = event.repository;
  if (pr.head.repo?.full_name !== repo.full_name) throw new Error('Release PR must come from this repository');
  if (merged) {
    if (!pr.merged) return null;
    if (repo.owner.type !== 'User' || pr.merged_by?.login?.toLowerCase() !== repo.owner.login.toLowerCase()) throw new Error('Only the repository owner may approve a release by merging');
    if (git(['rev-parse', 'HEAD']) !== pr.merge_commit_sha) throw new Error('Checkout must match the approved merge commit');
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ');
    if (parents.length !== 3 || parents[2] !== pr.head.sha) throw new Error('Release requires a GitHub merge commit of the exact approved PR revision');
    // The notes reviewed in the PR must be precisely the bytes published from main.
    if (git(['rev-parse', `HEAD:${notesPath}`]) !== git(['rev-parse', `${pr.head.sha}:${notesPath}`])) throw new Error('Merged notes differ from the approved PR revision');
    return candidate(parents[1], repo.full_name, pr.title, options);
  }
  return candidate(pr.base.sha, repo.full_name, pr.title, options);
}

export function verifyTag(tag) {
  if (git(['cat-file', '-t', `refs/tags/${tag}`]) !== 'tag'
    || git(['rev-parse', `${tag}^{commit}`]) !== git(['rev-parse', 'HEAD'])) {
    throw new Error('Existing release tag must be annotated and point to the approved merge');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2];
    if (!['check', 'gate', 'tag'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: node scripts/release-pr.mjs check|gate|tag');
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = gate(event, mode !== 'check');
    if (mode === 'tag') {
      if (!result) throw new Error('This merge is not an approved release PR');
      const existing = run('git', ['tag', '--list', result.tag], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim();
      if (existing) {
        verifyTag(result.tag);
      } else {
        run('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'tag', '-a', result.tag, '-m', releaseTitle(result.version)]);
      }
      run('git', ['push', 'origin', `refs/tags/${result.tag}:refs/tags/${result.tag}`]);
    }
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `release=${Boolean(result)}\n${result ? `version=${result.version}\nprerelease=${result.prerelease}\n` : ''}`);
    console.log(result ? `Release ${result.version}: ${mode} PASS` : 'No release PR: publication skipped');
  } catch (error) {
    reportError(error);
    process.exitCode = 1;
  }
}
