import { accessSync, constants, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { commandNames, packageNames, installLocations, windowsLauncher, launcherEntry } from './install-launcher.mjs';
import { configurePath } from './install-path.mjs';
import { updateRelease } from './update-release.mjs';
import { legacyLocations, legacyConfig, obsoleteInstalls, retireConfig, retirePayload } from './install-migration.mjs';

const windows = process.platform === 'win32';
// Node 22's native recursive copy can misplace UTF-8 Windows paths. A filter
// selects its JavaScript traversal without excluding any files or changing links.
const copyOptions = { recursive: true, verbatimSymlinks: true, ...(windows ? { filter: () => true } : {}) };
const defaults = installLocations();
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const publicInstallers = { 'linux-x64': 'install.sh', 'macos-arm64': 'Install.command', 'windows-x64': 'Install.cmd' };
const managedPayload = ['app', 'bin', 'install.sh', 'install.mjs', 'install-path.mjs', 'install-launcher.mjs', 'install.cmd', 'Install.command', 'Install.cmd', 'release.json', 'README.md'];
function inspect(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
function canonical(path) {
  try { return realpathSync(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
  }
}
function executable(path) {
  try { accessSync(path, constants.X_OK); return !lstatSync(path).isDirectory(); } catch { return false; }
}
function startupFile(path) {
  const result = { path };
  try {
    const stat = lstatSync(path);
    result.type = stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    result.size = stat.size;
  } catch (error) { result.statError = error.code; }
  try { result.realpath = realpathSync(path); } catch (error) { result.realpathError = error.code; }
  try { result.readBytes = readFileSync(path).length; } catch (error) { result.readError = error.code; }
  return result;
}
function managed(path) {
  try {
    const metadata = JSON.parse(readFileSync(join(path, 'release.json'), 'utf8'));
    return typeof metadata.version === 'string' && /^[\w.+-]+$/.test(metadata.version)
      && ['linux-x64', 'macos-arm64', 'windows-x64'].includes(metadata.target)
      && packageNames.includes(JSON.parse(readFileSync(join(path, 'app/package.json'), 'utf8')).name);
  } catch { return false; }
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'bin-dir': { type: 'string' }, 'release-root': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    const metadata = join(root, 'release.json');
    const target = inspect(metadata) ? JSON.parse(readFileSync(metadata, 'utf8')).target
      : windows ? 'windows-x64' : process.platform === 'darwin' ? 'macos-arm64' : 'linux-x64';
    const platform = target === 'windows-x64' ? 'Windows x64' : target === 'macos-arm64' ? 'macOS Apple silicon' : 'Linux x64';
    const application = target === 'windows-x64' ? '%LOCALAPPDATA%\\Programs\\Outask'
      : target === 'macos-arm64' ? '~/Library/Application Support/Outask' : '~/.local/share/outask';
    const command = target === 'windows-x64' ? '%LOCALAPPDATA%\\Programs\\Outask\\commands\\outask.cmd' : '~/.local/bin/outask';
    console.log(`Outask installer (${platform})
Usage: ${target === 'windows-x64' ? './Install.cmd (PowerShell), Install.cmd (cmd.exe)' : `./${publicInstallers[target]}`} [install|update|uninstall] [--bin-dir <directory>] [--release-root <parent-directory>]
Requires Node.js 22.23.3 or later on PATH. Open a new terminal after installation.
${target === 'windows-x64' ? 'Before first using this Windows writer generation, finish writes and close all previous CLI/MCP/HTTP sessions. Start new writers afterward; do not mix generations.\n' : ''}Application: ${application}
Command: ${command}
Install from the extracted application directory. Update downloads GitHub Latest stable; tar and network access are required.
Options change the command directory and application parent; reuse them for update/uninstall.
Uninstall removes the managed command link; application files, projects and configuration remain.`);
  } else {
    if (positionals.length > 1 || !['install', 'update', 'uninstall'].includes(positionals[0] ?? 'install')
      || values['bin-dir'] === '' || values['release-root'] === '') throw new Error('INVALID_INPUT: invalid action or empty directory');
    const bin = canonical(resolve(values['bin-dir'] ?? defaults.bin));
    const legacyRoot = canonical(join(homedir(), '.local/share/task-tracker/releases'));
    const defaultRoot = defaults.releases;
    const requestedRoot = canonical(resolve(values['release-root'] ?? defaultRoot));
    const oldDefaults = legacyLocations().slice(0, 2).map(canonical);
    // Old packaged updaters explicitly pass their former default directories.
    // Recognise those defaults while preserving genuinely custom locations.
    const releases = oldDefaults.includes(requestedRoot) ? canonical(defaultRoot) : requestedRoot;
    if (!managed(root)) throw new Error('INVALID_RELEASE: invalid release metadata or application');
    const releaseTarget = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8')).target;
    const payload = ['app', 'bin', publicInstallers[releaseTarget], 'release.json', 'README.md'];
    const destination = join(releases, basename(defaults.destination));
    const releaseRoots = [releases, legacyRoot, ...legacyLocations().map(canonical)];
    const migration = positionals[0] === 'uninstall' ? undefined : legacyConfig();
    if (positionals[0] !== 'uninstall' && migration && inspect(migration.target)
      && !readFileSync(migration.source).equals(readFileSync(migration.target))) {
      throw new Error(`CONFIG_CONFLICT: ${migration.source} and ${migration.target} differ; reconcile the registries before migrating`);
    }
    const targets = commandNames.map((name) => join(bin, windows ? `${name}.cmd` : name));
    const target = targets[0];
    function owned(path) {
      if (windows) {
        if (!inspect(path)?.isFile()) return false;
        const entry = launcherEntry(readFileSync(path, 'utf8'));
        if (!entry) return false;
        const parent = resolve(entry, '../../..');
        if (entry !== join(parent, 'app/bin/tasks')) return false;
        if (managed(parent)) return releaseRoots.includes(canonical(dirname(parent)));
        if (inspect(join(parent, 'release.json'))) return false;
        try {
          return packageNames.includes(JSON.parse(readFileSync(join(parent, 'app/package.json'), 'utf8')).name)
            && readFileSync(entry, 'utf8').includes("import('../cli.mjs')");
        } catch { return false; }
      }
      if (!inspect(path)?.isSymbolicLink()) return false;
      const linked = canonical(resolve(dirname(path), readlinkSync(path)));
      const parent = linked.endsWith('/app/bin/tasks') ? resolve(linked, '../../..') : resolve(linked, '../..');
      if (releaseRoots.includes(dirname(parent)) && managed(parent)) {
        const metadata = JSON.parse(readFileSync(join(parent, 'release.json'), 'utf8'));
        return linked === join(parent, 'app/bin/tasks') || linked === join(parent, 'bin/tasks');
      }
      if (linked !== join(parent, 'app/bin/tasks') || inspect(join(parent, 'release.json'))) return false;
      try {
        return packageNames.includes(JSON.parse(readFileSync(join(parent, 'app/package.json'), 'utf8')).name)
          && readFileSync(linked, 'utf8').includes("import('../cli.mjs')");
      } catch { return false; }
    }
    for (const target of targets) if (inspect(target) && !owned(target)) throw new Error(`COMMAND_EXISTS: ${target} is unrelated; resolve the collision before installing`);
    if (positionals[0] === 'uninstall') {
      for (const target of targets) if (owned(target)) unlinkSync(target);
      console.log(`Removed managed command link at ${target}. Application copies, project data and configuration are preserved.`);
    } else if (positionals[0] === 'update') {
      const installed = [destination, ...targets.filter(owned).map((path) => windows ? resolve(launcherEntry(readFileSync(path, 'utf8')), '../../..') : resolve(realpathSync(path), '../../..'))].find(managed);
      if (!installed) throw new Error('NOT_INSTALLED: install first, or reuse your original --bin-dir and --release-root');
      await updateRelease({ destination: installed, bin, releases });
    } else {
      if (windows) console.log('Windows coordination: before first using this writer generation, finish active writes and close all prior CLI/MCP/HTTP sessions. Start new writers afterward; do not mix generations.');
      const obsolete = obsoleteInstalls(releaseRoots, destination, managed);
      accessSync(join(root, 'app/bin/tasks'), constants.X_OK);
      await import('../cli.mjs');
      for (const part of (process.env.PATH ?? '').split(delimiter)) {
        for (const name of windows ? commandNames.flatMap((name) => ['.cmd', '.exe', '.bat', '.com', '.ps1', ''].map((extension) => name + extension)) : commandNames) {
          const candidate = resolve(part || '.', name);
          if (executable(candidate) && !targets.includes(canonical(candidate)) && !owned(candidate)) throw new Error(`COMMAND_EXISTS: ${candidate} is already on PATH; resolve the collision before installing`);
        }
      }
      const stateOnly = destination === canonical(defaults.destination) && inspect(destination)?.isDirectory()
        && readdirSync(destination).every(name => ['config.json', 'cache', 'locks', 'commands'].includes(name));
      if (inspect(destination) && (!inspect(destination).isDirectory() || (!managed(destination) && !stateOnly))) {
        throw new Error(`INSTALL_EXISTS: ${destination} is unrelated; choose another --release-root or resolve the collision`);
      }
      // Stage the new program separately; unrelated files beside it are retained.
      mkdirSync(releases, { recursive: true });
      const work = mkdtempSync(join(releases, '.outask-install-'));
      const staged = join(work, 'new');
      const backup = join(work, 'old');
      let linkWork;
      let committed = false;
      let rollbackFailed = false;
      try {
        mkdirSync(staged);
        for (const name of payload) {
          if (inspect(join(root, name))) cpSync(join(root, name), join(staged, name), copyOptions);
        }
        const check = spawnSync(process.execPath, [join(staged, 'app/bin/tasks'), '--help'], { encoding: 'utf8', timeout: 60000 });
        if (check.error) throw check.error;
        if (check.status !== 0) {
          const entry = join(staged, 'app/bin/tasks');
          const details = { source: startupFile(join(root, 'app/bin/tasks')), staged: startupFile(entry) };
          try {
            const names = readdirSync(dirname(entry));
            details.binNames = names.slice(0, 32);
            details.binNamesTruncated = names.length > 32;
          } catch (error) { details.binError = error.code; }
          // Probe through the child runtime's filesystem API independently of its main-module resolver.
          const probe = spawnSync(process.execPath, ['-e', `const { lstatSync, realpathSync, readFileSync } = require('node:fs'); ${startupFile.toString()}; console.log(JSON.stringify(startupFile(process.argv[1])));`, entry], { encoding: 'utf8', timeout: 10000 });
          details.child = { status: probe.status, error: probe.error?.code };
          try { details.child.file = JSON.parse(probe.stdout); } catch { details.child.stderr = (probe.stderr ?? '').slice(0, 500); }
          throw new Error(`INVALID_RELEASE: staged application failed startup: ${check.stderr || check.stdout}\nStaged startup diagnostics: ${JSON.stringify(details)}`);
        }
        const commandsInside = bin === destination || bin.startsWith(destination + sep);
        if (!commandsInside) mkdirSync(bin, { recursive: true });
        linkWork = mkdtempSync(join(commandsInside ? releases : bin, '.outask-link-'));
        for (const [index, target] of targets.entries()) {
          const link = join(linkWork, `new-${index}`);
          if (windows) writeFileSync(link, windowsLauncher(join(destination, 'app/bin/tasks')));
          else symlinkSync(join(destination, 'app/bin/tasks'), link);
        }
        const swapped = [];
        mkdirSync(destination, { recursive: true });
        mkdirSync(backup);
        try {
          // The root and all persistent state retain their original inodes.
          for (const name of managedPayload) {
            const current = join(destination, name);
            const replacement = join(staged, name);
            if (inspect(current)?.isFile() && inspect(replacement)?.isFile()
              && readFileSync(current).equals(readFileSync(replacement))) continue;
            const item = { name, previous: false, installed: false };
            swapped.push(item);
            if (inspect(current)) {
              renameSync(current, join(backup, name));
              item.previous = true;
            }
            if (inspect(replacement)) {
              renameSync(replacement, current);
              item.installed = true;
            }
          }
          mkdirSync(bin, { recursive: true });
          for (const [index, target] of targets.entries()) {
            if (inspect(target)) cpSync(target, join(linkWork, `old-${index}`), copyOptions);
            renameSync(join(linkWork, `new-${index}`), target);
          }
          committed = true;
        } catch (error) {
          for (const item of swapped.reverse()) {
            try {
              if (item.installed) renameSync(join(destination, item.name), join(staged, item.name));
              if (item.previous) renameSync(join(backup, item.name), join(destination, item.name));
            } catch (restoreError) {
              rollbackFailed = true;
              console.error(`Application recovery files retained at ${work}: ${restoreError.message}`);
            }
          }
          for (const [index, target] of targets.entries()) {
            if (inspect(join(linkWork, `new-${index}`))) continue;
            try {
              if (inspect(target)) unlinkSync(target);
              if (inspect(join(linkWork, `old-${index}`))) cpSync(join(linkWork, `old-${index}`), target, copyOptions);
            } catch (restoreError) {
              rollbackFailed = true;
              console.error(`Command backup retained at ${linkWork}: ${restoreError.message}`);
            }
          }
          throw error;
        }
      } finally {
        // Retain a backup if an OS error prevents rollback, rather than deleting it.
        if (committed || !rollbackFailed) rmSync(work, { recursive: true, force: true });
        else console.error(`Recovery files retained at ${work}`);
        if (linkWork && !rollbackFailed) rmSync(linkWork, { recursive: true, force: true });
      }
      retireConfig(migration);
      for (const previous of obsolete) retirePayload(previous, managedPayload);
      console.log(`Installed Outask at ${destination}. Commands: ${targets.join(', ')}`);
      for (const message of configurePath(bin)) console.log(message);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
