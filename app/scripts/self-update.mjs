import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fail } from '../src/errors.mjs';
import { compareVersions, distributionVersion } from '../src/version.mjs';
import { installLocations, launcherEntry } from './install-launcher.mjs';
import { updateRelease } from './update-release.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const usage = 'Usage: outask self update [--check]';
const help = `${usage}
Update the running Outask installation to its channel's latest stable version.
  --check    Check stable release availability (read only)
  --help, -h Show this help
Managed archives use GitHub Latest; global npm installs use their npm registry.
Source checkouts, local npm/npx and unrecognised installations receive update instructions.
Check exit codes: 0 current/newer, 10 update available, 2 unsupported, 1 failure.
Restart existing MCP/HTTP sessions to load the updated version.
`;

function json(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function sameFile(left, right) {
  try { return realpathSync(left) === realpathSync(right); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}

function archiveBin(root, metadata) {
  const entry = join(root, 'app/bin/tasks');
  const candidates = [metadata.bin, process.argv[1] && dirname(resolve(process.argv[1])),
    ...(process.env.PATH ?? '').split(delimiter), installLocations().bin].filter(Boolean);
  return candidates.find(bin => ['outask', 'tasks'].some(name => {
    const path = join(bin, windows ? `${name}.cmd` : name);
    if (!windows) return sameFile(path, entry);
    if (!existsSync(path)) return false;
    const target = launcherEntry(readFileSync(path, 'utf8'));
    return target !== undefined && sameFile(target, entry);
  }));
}

export function installation(appRoot = app) {
  const manifest = json(join(appRoot, 'package.json'));
  if (!manifest || manifest.name !== 'outask') return { kind: 'unknown', app: appRoot };
  const root = dirname(appRoot);
  const release = json(join(root, 'release.json'));
  if (release && sameFile(join(root, 'app/package.json'), join(appRoot, 'package.json'))) {
    return { kind: 'archive', app: appRoot, root, metadata: release, bin: archiveBin(root, release), version: manifest.version };
  }
  if (manifest.private && existsSync(join(appRoot, 'scripts/install-cli.mjs'))) {
    return { kind: 'source', app: appRoot, version: manifest.version };
  }
  const prefix = resolve(appRoot, windows ? '../..' : '../../..');
  const globalRoot = join(prefix, windows ? 'node_modules/outask' : 'lib/node_modules/outask');
  const command = join(prefix, windows ? 'outask.cmd' : 'bin/outask');
  const owned = windows ? existsSync(command)
    && /node_modules[\\/]outask[\\/]bin[\\/]outask/.test(readFileSync(command, 'utf8'))
    : sameFile(command, join(appRoot, 'bin/outask'));
  if (sameFile(globalRoot, appRoot) && owned) return { kind: 'npm', app: appRoot, prefix, version: manifest.version };
  return { kind: appRoot.split(/[\\/]/).includes('node_modules') ? 'local' : 'unknown', app: appRoot, version: manifest.version };
}

function npmCli() {
  const directory = dirname(process.execPath);
  const launcher = join(directory, 'npm');
  const cli = windows ? join(directory, 'node_modules/npm/bin/npm-cli.js')
    : existsSync(launcher) ? realpathSync(launcher) : undefined;
  if (!cli || !existsSync(cli)) fail('DEPENDENCY_MISSING', `npm for the running Node.js is missing at ${directory}; restore that Node installation's npm and retry`);
  return cli;
}

function npmRun(cli, selected, args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--global', '--prefix', selected.prefix,
    '--fetch-retries', '0', '--fetch-timeout', '120000'], {
    cwd: selected.prefix, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail('UPDATE_FAILED', `npm failed for ${selected.prefix}: ${result.error?.message ?? (result.stderr || result.stdout).trim()}; check npm, registry access and directory permissions, then retry`);
  }
  return result.stdout;
}

function guidance(selected) {
  if (selected.kind === 'source') return `Source checkout: ${dirname(selected.app)}. Update this checkout through your Git workflow, then rerun node app/scripts/install-cli.mjs install from its root with your original installation options.`;
  if (selected.kind === 'local') return `Local npm/npx installation: ${selected.app}. Update the owning project's outask dependency with npm, or run npx outask@latest for a fresh temporary invocation.`;
  return `Cannot determine an automatic update method for ${selected.app}. Use the original installer or package manager for this installation.`;
}

export async function main(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help && (positionals.length === 0 || (positionals.length === 1 && positionals[0] === 'update'))) {
    console.log(help); return;
  }
  if (positionals.length !== 1 || positionals[0] !== 'update') fail('INVALID_INPUT', usage);
  const selected = installation();
  console.log(`Outask v${distributionVersion(selected.version ?? 'unknown')} (${selected.kind}): ${selected.root ?? selected.app}`);
  if (!['archive', 'npm'].includes(selected.kind)) {
    console.log(guidance(selected)); process.exitCode = 2; return;
  }
  if (selected.kind === 'archive') {
    if (!values.check && !selected.bin) {
      console.log(`Managed command location is unavailable. Put this installation's command directory on PATH, or use its installer update action with the original --bin-dir and --release-root.`);
      process.exitCode = 2; return;
    }
    const result = await updateRelease({ destination: selected.root, bin: selected.bin, releases: dirname(selected.root), check: values.check });
    if (values.check && result.available) process.exitCode = 10;
    if (!values.check && result.available) console.log('Fresh launches use the update. Restart existing MCP/HTTP sessions to load it.');
    return;
  }
  const cli = npmCli();
  const latest = JSON.parse(npmRun(cli, selected, ['view', 'outask@latest', 'version', '--json']));
  if (typeof latest !== 'string' || latest.includes('-')) fail('UPDATE_FAILED', 'npm latest must identify one stable Outask version');
  const newer = compareVersions(selected.version, latest) < 0;
  if (!newer) { console.log(`Outask v${distributionVersion(selected.version)} is already current${compareVersions(selected.version, latest) > 0 ? ` (newer than stable v${latest})` : ''}.`); return; }
  console.log(`Update available: Outask v${distributionVersion(selected.version)} -> v${distributionVersion(latest)}.`);
  if (values.check) { process.exitCode = 10; return; }
  npmRun(cli, selected, ['install', `outask@${latest}`, '--ignore-scripts', '--no-audit', '--no-fund']);
  const installed = json(join(selected.app, 'package.json'));
  if (installed?.version !== latest) fail('UPDATE_FAILED', 'npm did not install the selected version; inspect this installation before retrying');
  console.log(`Updated to Outask v${distributionVersion(latest)}. Fresh launches use the update. Restart existing MCP/HTTP sessions to load it.`);
}
