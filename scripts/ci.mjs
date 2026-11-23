#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseNpmPack } from '../app/scripts/npm-pack.mjs';
import { archiveName, archivePath, hostTarget, releaseVersion, root, tagName } from './release-config.mjs';
import { checksumName, checksumsRequired, verifyArchive } from './release-checksums.mjs';

// These suites remain in the full CI and regression runs.
const deliveryTests = new Set([
  'checksum-docs.test.mjs',
  'install-path.test.mjs',
  'npm-release.test.mjs',
  'push-guard.test.mjs',
  'release-checksums.test.mjs',
  'release-notes.test.mjs',
  'release-pr.test.mjs',
  'release-recovery.test.mjs',
  'release-upload.test.mjs',
  'release.test.mjs',
  'update-release.test.mjs',
  'windows-install.test.mjs',
]);

function run(label, command, args, env = process.env) {
  if (process.platform === 'win32' && command === 'npm') {
    args = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args];
    command = process.execPath;
  }
  const result = spawnSync(command, args, {
    cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(`${label}: FAIL (${command} ${args.join(' ')})\n`);
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw result.error ?? new Error(`exit ${result.status ?? result.signal}`);
  }
  return result.stdout;
}

function dependencies() {
  for (const path of ['app', 'app/mcp']) {
    run(`${path} locked install`, 'npm', ['ci', '--prefix', path, '--include=dev', '--no-audit', '--no-fund']);
    console.log(`${path} locked install: PASS`);
    run(`${path} dependency audit`, 'npm', ['audit', '--prefix', path, '--include=dev']);
    console.log(`${path} dependency audit: PASS`);
  }
}

function regressionFiles() {
  return readdirSync(join(root, 'app/tests/regression')).filter(name => name.endsWith('.test.mjs')).sort()
    .map(name => join('app/tests/regression', name));
}

function tests({ regression = false, featureOnly = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'outask-tests-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: process.platform === 'win32' ? home : process.env.USERPROFILE,
    PATH: process.platform === 'win32' ? process.env.PATH : [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    LOCALAPPDATA: join(home, 'AppData/Local'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), ZDOTDIR: undefined, OUTASK_CONFIG: undefined };
  mkdirSync(env.LOCALAPPDATA, { recursive: true });
  try {
    for (const [label, directory] of [['Core', 'app/tests'], ['MCP', 'app/mcp/tests']]) {
      const files = readdirSync(join(root, directory))
        .filter(name => name.endsWith('.test.mjs') && (!featureOnly || !deliveryTests.has(name))).sort()
        .map((name) => join(directory, name));
      if (regression && label === 'Core') files.push(...regressionFiles());
      const output = run(`${label} tests`, process.execPath, ['--test', '--test-reporter=tap', ...files], env);
      const count = output.match(/^# tests (\d+)$/m)?.[1];
      console.log(`${label} tests: PASS${count ? ` (${count} tests)` : ''}`);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
}

function distribution() {
  const target = hostTarget();
  const temporary = mkdtempSync(join(tmpdir(), 'outask-ci-distribution-'));
  try {
    const output = run(`${target} test build`, process.execPath, [
      'app/scripts/release.mjs', '--target', target, '--out-dir', temporary,
    ]);
    const artifact = JSON.parse(output).artifacts[0];
    console.log(`${target} test build: PASS`);
    smoke(artifact.archive);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function npmSmoke(artifact) {
  process.stdout.write(run('npm installed CLI/MCP lifecycle', process.execPath, ['app/mcp/tests/npm-smoke.mjs', artifact], acceptanceEnv()));
}

function npmDistribution() {
  const temporary = mkdtempSync(join(tmpdir(), 'outask-ci-npm-'));
  try {
    const output = run('npm build', process.execPath, ['app/scripts/release.mjs', '--npm', '--out-dir', temporary]);
    npmSmoke(JSON.parse(output).artifacts[0].archive);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

async function npmDownloaded() {
  const { packageMetadata, packageName, artifactIntegrity } = await import('./npm-release.mjs');
  const requirePublication = process.env.OUTASK_REQUIRE_NPM_PUBLICATION === 'true';
  const metadata = await packageMetadata();
  if (!metadata) {
    if (requirePublication) throw new Error('Public npm package is required before MCP Registry publication');
    console.log('npm download acceptance: WAITING (package has no registry entry; see docs/releases.md#npm-publication)');
    return;
  }
  const manifest = JSON.parse(readFileSync(join(root, 'app/package.json')));
  const expected = metadata.versions?.[manifest.version];
  if (!expected) throw new Error('Approved npm version has not been published');
  if (requirePublication && (!manifest.mcpName || expected.mcpName !== manifest.mcpName)) {
    throw new Error('Public npm version does not carry the approved mcpName');
  }
  const temporary = mkdtempSync(join(tmpdir(), 'outask-npm-downloaded-'));
  try {
    const report = run('Public registry package download', 'npm', [
      'pack', `${packageName}@${expected.version}`, '--json', '--ignore-scripts',
      '--registry', 'https://registry.npmjs.org', '--pack-destination', temporary,
    ]);
    const artifact = join(temporary, parseNpmPack(report).filename);
    if (artifactIntegrity(artifact) !== expected.dist.integrity) throw new Error('Downloaded npm package integrity mismatch');
    npmSmoke(artifact);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function smoke(archive) {
  const evidence = run('Installed CLI/MCP smoke', process.execPath, ['app/mcp/tests/distribution-smoke.mjs', archive], acceptanceEnv());
  process.stdout.write(evidence);
  console.log('Installed CLI/MCP smoke: PASS (shared storage/validation, dependency diagnostics, update/uninstall, data preservation)');
}

function acceptanceEnv() {
  return { ...process.env, OUTASK_SELF_UPDATE_TESTS: ['regression', 'archive', 'downloaded', 'npm-archive', 'npm-downloaded'].includes(process.argv[2]) ? '1' : undefined };
}

function downloaded() {
  const repo = process.env.REPO?.trim();
  if (!repo) throw new Error('REPO is required for downloaded release acceptance');
  const temporary = mkdtempSync(join(tmpdir(), 'outask-downloaded-acceptance-'));
  try {
    const name = archiveName(hostTarget());
    run('Published archive download', 'gh', ['release', 'download', tagName(), '--repo', repo, '--pattern', name, '--dir', temporary]);
    if (checksumsRequired(releaseVersion())) {
      run('Published checksums download', 'gh', ['release', 'download', tagName(), '--repo', repo, '--pattern', checksumName, '--dir', temporary]);
      verifyArchive(readFileSync(join(temporary, name)), name, readFileSync(join(temporary, checksumName), 'utf8'), releaseVersion());
      console.log('Published archive SHA256: PASS');
    }
    smoke(join(temporary, name));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const mode = process.argv[2];
  if (process.argv.length > 3 || (mode !== undefined && !['dependencies', 'test-feature', 'test', 'regression', 'distribution', 'archive', 'downloaded', 'npm', 'npm-archive', 'npm-downloaded'].includes(mode))) {
    throw new Error('Usage: node scripts/ci.mjs [dependencies|test-feature|test|regression|distribution|archive|downloaded|npm|npm-archive|npm-downloaded]');
  }
  if (mode === undefined || mode === 'dependencies') dependencies();
  if (mode === 'test-feature') tests({ featureOnly: true });
  if (mode === undefined || mode === 'test') tests();
  if (mode === 'regression') { tests({ regression: true }); distribution(); npmDistribution(); }
  if (mode === 'archive') {
    process.stdout.write(run('Self-update regression tests', process.execPath, ['--test', ...regressionFiles()]));
  }
  if (mode === undefined || mode === 'distribution') distribution();
  if (mode === 'archive') smoke(archivePath(hostTarget()));
  if (mode === 'downloaded') downloaded();
  if (mode === undefined || mode === 'distribution' || mode === 'npm') npmDistribution();
  if (mode === 'npm-archive') npmSmoke((await import('./npm-release.mjs')).npmArtifact);
  if (mode === 'npm-downloaded') await npmDownloaded();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
