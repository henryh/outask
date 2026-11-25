#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { gate, verifyTag } from './release-pr.mjs';
import { npmArtifact } from './npm-release.mjs';
import { version } from './release-config.mjs';

export const scopedName = '@henryh/outask';
export const registry = 'https://npm.pkg.github.com';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function files(root) {
  return run('tar', ['-tzf', root]).split('\n').filter(Boolean).sort();
}

function hashes(root) {
  const result = new Map();
  for (const name of files(root)) {
    if (name.endsWith('/')) continue;
    result.set(name, createHash('sha256').update(run('tar', ['-xOzf', root, name], { encoding: null })).digest('hex'));
  }
  return result;
}

export function prepareScopedPackage(source, destination) {
  const stage = mkdtempSync(join(tmpdir(), 'outask-gpr-stage-'));
  try {
    run('tar', ['-xzf', source, '-C', stage]);
    const packageRoot = join(stage, 'package');
    const manifestPath = join(packageRoot, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== 'outask' || manifest.version !== version()) throw new Error('Accepted npm artifact name/version mismatch');
    if (manifest.repository?.url !== 'git+https://github.com/henryh/outask.git') throw new Error('Accepted npm artifact repository mismatch');
    manifest.name = scopedName;
    manifest.publishConfig = { access: 'public', registry };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const lockPath = join(packageRoot, 'package-lock.json');
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (lock.name !== 'outask' || lock.packages?.['']?.name !== 'outask' || lock.version !== manifest.version) throw new Error('Accepted npm lockfile mismatch');
      lock.name = scopedName;
      lock.packages[''].name = scopedName;
      writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    }
    run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', destination, '-C', stage, 'package']);
    const before = hashes(source);
    const after = hashes(destination);
    if (before.size !== after.size || [...before.keys()].some(name => !after.has(name))) throw new Error('Scoped package file list differs from accepted npm artifact');
    for (const [name, hash] of before) {
      if (!['package/package.json', 'package/package-lock.json'].includes(name) && after.get(name) !== hash) throw new Error(`Scoped package payload differs: ${name}`);
    }
    return { name: scopedName, version: manifest.version, integrity: `sha512-${createHash('sha512').update(readFileSync(destination)).digest('base64')}` };
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export function publicationPlan(metadata, { version: expectedVersion, integrity }) {
  if (!metadata) return 'publish';
  if (metadata.name !== scopedName) throw new Error('GitHub Packages name mismatch');
  const existing = metadata.versions?.[expectedVersion];
  if (!existing) return 'publish';
  if (existing.dist?.integrity !== integrity) throw new Error('Existing GitHub Packages version has different content');
  return 'existing';
}

async function metadata(token) {
  const response = await fetch(`${registry}/${encodeURIComponent(scopedName)}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub Packages registry returned HTTP ${response.status}`);
  return response.json();
}

export async function waitForPublication(candidate, read, { now = () => performance.now(), sleep = delay, timeoutMs = 180000 } = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const current = await read();
    if (current?.versions?.[candidate.version]) {
      if (publicationPlan(current, candidate) === 'existing') return;
    }
    await sleep(Math.min(5000, Math.max(0, deadline - now())));
  }
  throw new Error(`GitHub Packages ${scopedName}@${candidate.version} visibility timed out`);
}

async function publish() {
  if (!process.env.GITHUB_EVENT_PATH || process.env.GITHUB_REPOSITORY !== 'henryh/outask') throw new Error('GitHub Packages publication requires the approved henryh/outask Release workflow');
  const approved = gate(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
  if (!approved) throw new Error('This merge is not an approved release PR');
  verifyTag(approved.tag);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const temporary = mkdtempSync(join(tmpdir(), 'outask-gpr-'));
  try {
    const archive = join(temporary, 'outask-scoped.tgz');
    const candidate = prepareScopedPackage(npmArtifact, archive);
    if (publicationPlan(await metadata(token), candidate) === 'existing') {
      console.log(`GitHub Packages: PASS (${scopedName}@${candidate.version} already has approved bytes)`);
      return;
    }
    const config = join(temporary, '.npmrc');
    writeFileSync(config, `//npm.pkg.github.com/:_authToken=${token}\n`, { mode: 0o600 });
    run('npm', ['publish', archive, '--registry', registry, '--access', 'public'], {
      env: { ...process.env, NPM_CONFIG_USERCONFIG: config }, stdio: 'inherit', encoding: 'utf8',
    });
    await waitForPublication(candidate, () => metadata(token));
    console.log(`GitHub Packages: PASS (${scopedName}@${candidate.version})`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await publish(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
