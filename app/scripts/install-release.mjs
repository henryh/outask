import { accessSync, constants, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { installLocations, windowsLauncher, launcherEntry } from './install-launcher.mjs';
import { configurePath } from './install-path.mjs';

const windows = process.platform === 'win32';
// Node 22's native recursive copy can misplace UTF-8 Windows paths. A filter
// selects its JavaScript traversal without excluding any files or changing links.
const copyOptions = { recursive: true, verbatimSymlinks: true, ...(windows ? { filter: () => true } : {}) };
const defaults = installLocations();
const root = dirname(fileURLToPath(import.meta.url));
const payload = ['app', 'bin', 'install.sh', 'install.mjs', 'install-path.mjs', 'install-launcher.mjs', 'install.cmd', 'Install.command', 'release.json', 'README.md'];
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
      && JSON.parse(readFileSync(join(path, 'app/package.json'), 'utf8')).name === 'task-tracker-local';
  } catch { return false; }
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'bin-dir': { type: 'string' }, 'release-root': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: install.sh (POSIX) or install.cmd (Windows) [install|uninstall] [--bin-dir <directory>] [--release-root <parent-directory>]\nWindows defaults: %USERPROFILE%\\AppData\\Local\\Programs\\OutaskAI, command %USERPROFILE%\\AppData\\Local\\OutaskAI\\bin\\tasks.cmd; persistent user PATH, reopen your terminal. Installs OutaskAI below the selected parent: ~/Library/Application Support on macOS; ~/.local/share/task-tracker/releases on Linux. Command: ~/.local/bin/tasks. Updates replace application files; uninstall removes only the managed command link. Install configures PATH in bash startup files or zsh .zprofile (plus .zshrc on Linux), respecting ZDOTDIR; open a new terminal afterward.');
  } else {
    if (positionals.length > 1 || !['install', 'uninstall'].includes(positionals[0] ?? 'install')
      || values['bin-dir'] === '' || values['release-root'] === '') throw new Error('INVALID_INPUT: invalid action or empty directory');
    const bin = canonical(resolve(values['bin-dir'] ?? defaults.bin));
    const legacyRoot = canonical(join(homedir(), '.local/share/task-tracker/releases'));
    const defaultRoot = defaults.releases;
    const releases = canonical(resolve(values['release-root'] ?? defaultRoot));
    if (!managed(root)) throw new Error('INVALID_RELEASE: invalid release metadata or application');
    const destination = join(releases, 'OutaskAI');
    const target = join(bin, windows ? 'tasks.cmd' : 'tasks');
    function owned(path) {
      if (windows) {
        if (!inspect(path)?.isFile()) return false;
        const entry = launcherEntry(readFileSync(path, 'utf8'));
        if (!entry) return false;
        const parent = resolve(entry, '../../..');
        if (entry !== join(parent, 'app/bin/tasks')) return false;
        if (managed(parent)) return [releases, legacyRoot].includes(dirname(parent));
        if (inspect(join(parent, 'release.json'))) return false;
        try {
          return JSON.parse(readFileSync(join(parent, 'app/package.json'), 'utf8')).name === 'task-tracker-local'
            && readFileSync(entry, 'utf8').includes("import('../cli.mjs')");
        } catch { return false; }
      }
      if (!inspect(path)?.isSymbolicLink()) return false;
      const linked = canonical(resolve(dirname(path), readlinkSync(path)));
      const parent = linked.endsWith('/app/bin/tasks') ? resolve(linked, '../../..') : resolve(linked, '../..');
      if ([releases, legacyRoot].includes(dirname(parent)) && managed(parent)) {
        const metadata = JSON.parse(readFileSync(join(parent, 'release.json'), 'utf8'));
        if (basename(parent) === 'OutaskAI' || basename(parent) === `task-tracker-${metadata.version}-${metadata.target}`) {
          return linked === join(parent, 'app/bin/tasks') || linked === join(parent, 'bin/tasks');
        }
      }
      if (linked !== join(parent, 'app/bin/tasks') || inspect(join(parent, 'release.json'))) return false;
      try {
        return JSON.parse(readFileSync(join(parent, 'app/package.json'), 'utf8')).name === 'task-tracker-local'
          && readFileSync(linked, 'utf8').includes("import('../cli.mjs')");
      } catch { return false; }
    }
    if (inspect(target) && !owned(target)) throw new Error(`COMMAND_EXISTS: ${target} is unrelated; resolve the collision before installing`);
    if (positionals[0] === 'uninstall') {
      if (owned(target)) unlinkSync(target);
      console.log(`Removed managed command link at ${target}. Application copies, project data and configuration are preserved.`);
    } else {
      accessSync(join(root, 'app/bin/tasks'), constants.X_OK);
      await import('./app/cli.mjs');
      for (const part of (process.env.PATH ?? '').split(delimiter)) {
        for (const name of windows ? ['tasks.cmd', 'tasks.exe', 'tasks.bat', 'tasks.com', 'tasks.ps1', 'tasks'] : ['tasks']) {
          const candidate = resolve(part || '.', name);
          if (executable(candidate) && canonical(candidate) !== target && !owned(candidate)) throw new Error(`COMMAND_EXISTS: ${candidate} is already on PATH; resolve the collision before installing`);
        }
      }
      if (inspect(destination) && (!inspect(destination).isDirectory() || !managed(destination))) {
        throw new Error(`INSTALL_EXISTS: ${destination} is unrelated; choose another --release-root or resolve the collision`);
      }
      // Stage the new program separately; unrelated files beside it are retained.
      mkdirSync(releases, { recursive: true });
      const work = mkdtempSync(join(releases, '.OutaskAI-install-'));
      const staged = join(work, 'new');
      const backup = join(work, 'old');
      let linkWork;
      let committed = false;
      try {
        mkdirSync(staged);
        for (const name of payload) {
          if (inspect(join(root, name))) cpSync(join(root, name), join(staged, name), copyOptions);
        }
        if (inspect(destination)) {
          for (const name of readdirSync(destination)) {
            if (!payload.includes(name)) cpSync(join(destination, name), join(staged, name), copyOptions);
          }
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
        mkdirSync(bin, { recursive: true });
        linkWork = mkdtempSync(join(bin, '.OutaskAI-link-'));
        const link = join(linkWork, 'tasks');
        if (windows) writeFileSync(link, windowsLauncher(join(destination, 'app/bin/tasks')));
        else symlinkSync(join(destination, 'app/bin/tasks'), link);
        let installed = false;
        try {
          if (inspect(destination)) renameSync(destination, backup);
          renameSync(staged, destination);
          installed = true;
          renameSync(link, target);
          committed = true;
        } catch (error) {
          if (installed) renameSync(destination, staged);
          if (inspect(backup)) renameSync(backup, destination);
          throw error;
        }
      } finally {
        // Retain a backup if an OS error prevents rollback, rather than deleting it.
        if (committed || !inspect(backup)) rmSync(work, { recursive: true, force: true });
        else console.error(`Previous application retained at ${backup}`);
        if (linkWork) rmSync(linkWork, { recursive: true, force: true });
      }
      console.log(`Installed OutaskAI at ${destination}. Command: ${target}`);
      for (const message of configurePath(bin)) console.log(message);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
