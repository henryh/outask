#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { archiveName, archivePath, hostTarget, root, tagName } from './release-config.mjs';

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

function tests() {
  const home = mkdtempSync(join(tmpdir(), 'outask-tests-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: process.platform === 'win32' ? home : process.env.USERPROFILE,
    PATH: process.platform === 'win32' ? process.env.PATH : [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    LOCALAPPDATA: join(home, 'AppData/Local'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), ZDOTDIR: undefined, TASK_TRACKER_CONFIG: undefined };
  mkdirSync(env.LOCALAPPDATA, { recursive: true });
  try {
    for (const [label, directory] of [['Core', 'app/tests'], ['MCP', 'app/mcp/tests']]) {
      const files = readdirSync(join(root, directory)).filter((name) => name.endsWith('.test.mjs')).sort()
        .map((name) => join(directory, name));
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

function smoke(archive) {
  const evidence = run('Installed CLI/MCP smoke', process.execPath, ['app/mcp/tests/distribution-smoke.mjs', archive]);
  process.stdout.write(evidence);
  console.log('Installed CLI/MCP smoke: PASS (shared storage/validation, dependency diagnostics, update/uninstall, data preservation)');
}

function downloaded() {
  const repo = process.env.REPO?.trim();
  if (!repo) throw new Error('REPO is required for downloaded release acceptance');
  const temporary = mkdtempSync(join(tmpdir(), 'outask-downloaded-acceptance-'));
  try {
    const name = archiveName(hostTarget());
    run('Published archive download', 'gh', ['release', 'download', tagName(), '--repo', repo, '--pattern', name, '--dir', temporary]);
    smoke(join(temporary, name));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const mode = process.argv[2];
  if (process.argv.length > 3 || (mode !== undefined && !['dependencies', 'test', 'distribution', 'archive', 'downloaded'].includes(mode))) {
    throw new Error('Usage: node scripts/ci.mjs [dependencies|test|distribution|archive|downloaded]');
  }
  if (mode === undefined || mode === 'dependencies') dependencies();
  if (mode === undefined || mode === 'test') tests();
  if (mode === undefined || mode === 'distribution') distribution();
  if (mode === 'archive') smoke(archivePath(hostTarget()));
  if (mode === 'downloaded') downloaded();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
