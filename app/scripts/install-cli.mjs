#!/usr/bin/env node
import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fail } from '../src/errors.mjs';
import { reportError } from './output.mjs';
import { installLocations, windowsLauncher, launcherEntry } from './install-launcher.mjs';
import { configurePath } from './install-path.mjs';

const windows = process.platform === 'win32';
const defaults = installLocations();
const source = fileURLToPath(new URL('../bin/tasks', import.meta.url));
function inspect(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
function canonical(path) {
  try { return realpathSync(path); } catch (error) {
    if (error.code === 'ENOENT') {
      const parent = dirname(path);
      return parent === path ? path : join(canonical(parent), basename(path));
    }
    throw error;
  }
}
function owned(path, releaseRoots) {
  try {
    if (windows) {
      if (!inspect(path)?.isFile()) return false;
      const entry = launcherEntry(readFileSync(path, 'utf8'));
      if (entry === source) return true;
      if (!entry) return false;
      const release = resolve(entry, '../../..');
      return releaseRoots.includes(dirname(release))
        && entry === join(release, 'app/bin/tasks')
        && JSON.parse(readFileSync(join(release, 'release.json'), 'utf8')).target === 'windows-x64'
        && JSON.parse(readFileSync(join(release, 'app/package.json'), 'utf8')).name === 'task-tracker-local';
    }
    if (!inspect(path)?.isSymbolicLink()) return false;
    const entry = realpathSync(path);
    if (entry === source) return true;
    if (!entry.endsWith('/app/bin/tasks')) return false;
    const release = dirname(dirname(dirname(entry)));
    if (!releaseRoots.includes(dirname(release))) return false;
    const metadata = JSON.parse(readFileSync(join(release, 'release.json'), 'utf8'));
    return (basename(release) === 'OutaskAI' || basename(release) === `task-tracker-${metadata.version}-${metadata.target}`)
      && typeof metadata.version === 'string' && /^[\w.+-]+$/.test(metadata.version)
      && ['linux-x64', 'macos-arm64'].includes(metadata.target)
      && JSON.parse(readFileSync(join(release, 'app/package.json'), 'utf8')).name === 'task-tracker-local';
  } catch { return false; }
}
function executable(path) {
  try { accessSync(path, constants.X_OK); return !lstatSync(path).isDirectory(); } catch { return false; }
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'bin-dir': { type: 'string' }, 'release-root': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    process.stdout.write(`Usage: node app/scripts/install-cli.mjs install|uninstall [--bin-dir <directory>] [--release-root <parent-directory>]
Requires Node.js 22.23.3 or later on PATH.
Command: ${windows ? '%USERPROFILE%\\AppData\\Local\\OutaskAI\\bin\\tasks.cmd' : '~/.local/bin/tasks'}
Open a new terminal after installation. To update, update this checkout and rerun install.
Use --release-root for the parent of an existing custom OutaskAI installation.
Install refuses unrelated commands; uninstall removes the managed command link and preserves application files, projects and configuration.
`);
  } else {
    if (positionals.length !== 1 || !['install', 'uninstall'].includes(positionals[0]) || values['bin-dir'] === '' || values['release-root'] === '') {
      fail('INVALID_INPUT', 'use install or uninstall, with optional --bin-dir <directory> and --release-root <parent-directory>');
    }
    const bin = resolve(values['bin-dir'] ?? defaults.bin);
    const legacyRoot = canonical(join(homedir(), '.local/share/task-tracker/releases'));
    const defaultRoot = defaults.releases;
    const releaseRoots = [canonical(resolve(values['release-root'] ?? defaultRoot)), legacyRoot];
    const target = join(bin, windows ? 'tasks.cmd' : 'tasks');
    const present = inspect(target);
    if (present && !owned(target, releaseRoots)) fail('COMMAND_EXISTS', `${target}: unrelated command; choose another --bin-dir or resolve the collision yourself`);
    if (positionals[0] === 'uninstall') {
      if (present) unlinkSync(target);
      process.stdout.write(present ? `Removed ${target}.\n` : `Already absent: ${target}.\n`);
    } else {
      for (const part of (process.env.PATH ?? '').split(delimiter)) {
        for (const name of windows ? ['tasks.cmd', 'tasks.exe', 'tasks.bat', 'tasks.com', 'tasks.ps1', 'tasks'] : ['tasks']) {
          const candidate = resolve(part || '.', name);
          if (candidate !== target && executable(candidate) && !owned(candidate, releaseRoots)) {
            fail('COMMAND_EXISTS', `${candidate}: an unrelated tasks command is already on PATH; resolve the collision before installing`);
          }
        }
      }
      const already = present && (windows ? readFileSync(target, 'utf8') === windowsLauncher(source) : realpathSync(target) === source);
      if (!already) {
        mkdirSync(bin, { recursive: true });
        const temporary = mkdtempSync(join(bin, '.OutaskAI-link-'));
        try {
          const link = join(temporary, 'tasks');
          if (windows) writeFileSync(link, windowsLauncher(source));
          else symlinkSync(source, link);
          renameSync(link, target);
        } finally { rmSync(temporary, { recursive: true, force: true }); }
      }
      process.stdout.write(`${already ? 'Already installed' : 'Installed'}: ${target} -> ${source}.\n`);
      for (const message of configurePath(bin)) console.log(message);
    }
  }
} catch (error) {
  reportError(error);
}
