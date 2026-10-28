import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fail } from '../app/src/errors.mjs';
import { distributionVersion } from '../app/src/version.mjs';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const appRoot = join(root, 'app');
export const distRoot = join(root, 'dist');
export const targets = ['linux-x64', 'macos-arm64', 'windows-x64'];

export function version() {
  return JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version;
}

export function releaseVersion() {
  return distributionVersion(version());
}

export function tagName() {
  return `v${releaseVersion()}`;
}

export function releaseTitle(value = releaseVersion()) {
  return `${archiveBrand() === 'OutaskAI' ? 'Outask AI' : 'Outask'} v${distributionVersion(value)}`;
}

// Recovery runs against the original approved manifest. Published asset names
// and titles must retain the spelling that was approved for that version.
export function archiveBrand() {
  return JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).name === 'task-tracker-local' ? 'OutaskAI' : 'Outask';
}

export function targetList(value = process.env.TARGETS) {
  if (!value || !value.trim()) return targets;
  const selected = value.split(/[\s,]+/).filter(Boolean);
  for (const target of selected) {
    if (!targets.includes(target)) fail('INVALID_INPUT', `target must be one of: ${targets.join(', ')}`);
  }
  return selected;
}

export function hostTarget() {
  const os = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform;
  const target = `${os}-${process.arch}`;
  if (!targets.includes(target)) fail('INVALID_INPUT', `host target ${target} is not supported`);
  return target;
}

export function archiveName(target, value = releaseVersion()) {
  return `${archiveBrand()}-${distributionVersion(value)}-${target}.tar.gz`;
}

export function archivePath(target, value = releaseVersion()) {
  return join(distRoot, archiveName(target, value));
}

export function archiveNames(target, value = releaseVersion()) {
  const primary = archiveName(target, value);
  return archiveBrand() === 'OutaskAI' ? [primary]
    : [primary, `OutaskAI-${distributionVersion(value)}-${target}.tar.gz`];
}

export function archivePaths(target, value = releaseVersion()) {
  return archiveNames(target, value).map(name => join(distRoot, name));
}

export function requireArchives(selected = targetList(), value = releaseVersion()) {
  const paths = selected.flatMap((target) => archivePaths(target, value));
  for (const path of paths) {
    if (!existsSync(path)) fail('READ_ERROR', `Missing ${path}`);
  }
  return paths;
}

export function rejectMixedArchives(packageVersion = version()) {
  const releaseId = distributionVersion(packageVersion);
  if (releaseId === packageVersion) return;
  const mixed = targets.flatMap(target => archiveNames(target, releaseId)
    .map(name => join(distRoot, name.replace(`-${releaseId}-`, `-${packageVersion}-`)))).filter(existsSync);
  if (mixed.length) fail('INVALID_INPUT', `Full-SemVer zero-patch archives must not coexist with ${releaseId} archives: ${mixed.join(', ')}`);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) fail('COMMAND_FAILED', `${command} ${args.join(' ')} failed`);
  return result;
}

export function succeeds(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], ...options });
  if (result.error) return false;
  return result.status === 0;
}

export function output(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  if (result.error || result.status !== 0) return '';
  return result.stdout.trim();
}
