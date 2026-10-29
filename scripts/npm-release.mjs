#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gate, verifyTag } from './release-pr.mjs';
import { distRoot, version } from './release-config.mjs';

export const registry = 'https://registry.npmjs.org';
const manifest = JSON.parse(readFileSync(new URL('../app/package.json', import.meta.url), 'utf8'));
export const packageName = manifest.name;
export const npmArtifact = join(distRoot, `${packageName.replace(/^@/, '').replace('/', '-')}-${version()}.tgz`);

export async function packageMetadata() {
  const response = await fetch(`${registry}/${encodeURIComponent(packageName)}`, { signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  return response.json();
}

export function artifactIntegrity(path = npmArtifact) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

export function publicationPlan(metadata, { name, version, integrity, owner }) {
  if (!metadata) return { action: 'bootstrap' };
  if (metadata.name !== name || !owner || !metadata.maintainers?.some((maintainer) => maintainer.name === owner)) {
    throw new Error('OUTASK_NPM_OWNER must name the confirmed npm package maintainer; verify ownership before publication');
  }
  const tag = version.includes('-') ? 'next' : 'latest';
  const existing = metadata.versions?.[version];
  if (existing) {
    if (existing.dist?.integrity !== integrity) throw new Error('Existing immutable npm version differs from the approved artifact');
    if (metadata['dist-tags']?.[tag] !== version) throw new Error(`npm ${tag} does not select the approved version`);
    return { action: 'existing', tag };
  }
  return { action: 'publish', tag };
}

async function publish() {
  if (!process.env.GITHUB_EVENT_PATH) throw new Error('npm publication requires the approved owner-merged Release workflow; see docs/releases.md#npm-publication');
  const approved = gate(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
  if (!approved) throw new Error('This merge is not an approved release PR');
  verifyTag(approved.tag);
  const metadata = await packageMetadata();
  const integrity = artifactIntegrity();
  const plan = publicationPlan(metadata, { name: packageName, version: version(), integrity, owner: process.env.OUTASK_NPM_OWNER?.trim() });
  if (plan.action === 'bootstrap') {
    console.log(`npm publication: WAITING (${packageName} has no registry entry; see docs/releases.md#npm-publication).`);
    return;
  }
  if (plan.action === 'existing') {
    console.log(`npm publication: PASS (${packageName}@${version()} already has the approved bytes)`);
    return;
  }
  const { tag } = plan;
  const result = spawnSync('npm', ['publish', npmArtifact, '--access', 'public', '--registry', registry, '--tag', tag], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm publish failed (${result.status}); inspect trusted publishing configuration`);
  const published = await packageMetadata();
  if (published?.versions?.[version()]?.dist?.integrity !== integrity) throw new Error('Published npm integrity differs from the approved artifact');
  if (published['dist-tags']?.[tag] !== version()) throw new Error(`npm ${tag} does not select the approved version`);
  console.log(`npm publication: PASS (${packageName}@${version()}, ${tag})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await publish(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
