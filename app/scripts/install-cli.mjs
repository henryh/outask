#!/usr/bin/env node
import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fail } from '../src/errors.mjs';
import { reportError } from './output.mjs';
import { commandNames, packageNames, installLocations, windowsLauncher, launcherEntry, forwarderEntry } from './install-launcher.mjs';
import { configurePath } from './install-path.mjs';
import { legacyLocations } from './install-migration.mjs';

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
    const actual = realpathSync(path);
    const info = lstatSync(actual);
    if (info.isFile() && info.size <= 16384) {
      const entry = forwarderEntry(readFileSync(actual, 'utf8'));
      if (entry) {
        if (entry === source) return true;
        const release = resolve(entry, '../../..');
        return releaseRoots.includes(dirname(release)) && entry === join(release, 'app/bin/tasks')
          && ['linux-x64', 'macos-arm64', 'windows-x64'].includes(JSON.parse(readFileSync(join(release, 'release.json'), 'utf8')).target)
          && packageNames.includes(JSON.parse(readFileSync(join(release, 'app/package.json'), 'utf8')).name);
      }
    }
    if (windows) {
      if (!inspect(path)?.isFile()) return false;
      const entry = launcherEntry(readFileSync(path, 'utf8'));
      if (entry === source) return true;
      if (!entry) return false;
      const release = resolve(entry, '../../..');
      return releaseRoots.includes(dirname(release))
        && entry === join(release, 'app/bin/tasks')
        && JSON.parse(readFileSync(join(release, 'release.json'), 'utf8')).target === 'windows-x64'
        && packageNames.includes(JSON.parse(readFileSync(join(release, 'app/package.json'), 'utf8')).name);
    }
    if (!inspect(path)?.isSymbolicLink()) return false;
    const entry = realpathSync(path);
    if (entry === source) return true;
    if (!entry.endsWith('/app/bin/tasks')) return false;
    const release = dirname(dirname(dirname(entry)));
    if (!releaseRoots.includes(dirname(release))) return false;
    const metadata = JSON.parse(readFileSync(join(release, 'release.json'), 'utf8'));
    return (basename(release) === basename(defaults.destination) || basename(release) === 'OutaskAI' || basename(release) === `task-tracker-${metadata.version}-${metadata.target}`)
      && typeof metadata.version === 'string' && /^[\w.+-]+$/.test(metadata.version)
      && ['linux-x64', 'macos-arm64'].includes(metadata.target)
      && packageNames.includes(JSON.parse(readFileSync(join(release, 'app/package.json'), 'utf8')).name);
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
Command: ${windows ? '%USERPROFILE%\\AppData\\Local\\Programs\\Outask\\commands\\outask.cmd' : '~/.local/bin/outask'}
Open a new terminal after installation. To update, update this checkout and rerun install.
Use --release-root for the parent of an existing custom Outask installation.
Install refuses unrelated commands; uninstall removes the managed command link and preserves application files, projects and configuration.
`);
  } else {
    if (positionals.length !== 1 || !['install', 'uninstall'].includes(positionals[0]) || values['bin-dir'] === '' || values['release-root'] === '') {
      fail('INVALID_INPUT', 'use install or uninstall, with optional --bin-dir <directory> and --release-root <parent-directory>');
    }
    const bin = resolve(values['bin-dir'] ?? defaults.bin);
    const defaultRoot = defaults.releases;
    const releaseRoots = [canonical(resolve(values['release-root'] ?? defaultRoot)), ...legacyLocations().map(canonical)];
    const targets = commandNames.map((name) => join(bin, windows ? `${name}.cmd` : name));
    for (const target of targets) {
      if (inspect(target) && !owned(target, releaseRoots)) fail('COMMAND_EXISTS', `${target}: unrelated command; resolve the collision before installing`);
    }
    if (positionals[0] === 'install') {
      for (const part of (process.env.PATH ?? '').split(delimiter)) {
        for (const name of windows ? commandNames.flatMap((name) => ['.cmd', '.exe', '.bat', '.com', '.ps1', ''].map((extension) => name + extension)) : commandNames) {
          const candidate = resolve(part || '.', name);
          if (executable(candidate) && !owned(candidate, releaseRoots)) {
            fail('COMMAND_EXISTS', `${candidate}: an unrelated Outask command is already on PATH; resolve the collision before installing`);
          }
        }
      }
    }
    for (const target of targets) {
      const present = inspect(target);
      if (positionals[0] === 'uninstall') {
        if (present) unlinkSync(target);
        process.stdout.write(present ? `Removed ${target}.\n` : `Already absent: ${target}.\n`);
      } else {
        const already = present && (windows ? readFileSync(target, 'utf8') === windowsLauncher(source) : realpathSync(target) === source);
        if (!already) {
          mkdirSync(bin, { recursive: true });
          const temporary = mkdtempSync(join(bin, '.outask-link-'));
          try {
            const link = join(temporary, 'tasks');
            if (windows) writeFileSync(link, windowsLauncher(source));
            else symlinkSync(source, link);
            renameSync(link, target);
          } finally { rmSync(temporary, { recursive: true, force: true }); }
        }
        process.stdout.write(`${already ? 'Already installed' : 'Installed'}: ${target} -> ${source}.\n`);
      }
    }
    if (positionals[0] === 'install') for (const message of configurePath(bin)) console.log(message);
  }
} catch (error) {
  reportError(error);
}
