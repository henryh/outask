import { lstatSync, readFileSync, readlinkSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { applicationRoot, cacheRoot, configPath } from '../src/locations.mjs';
import { packageNames } from './install-launcher.mjs';
import { retirePayload } from './install-migration.mjs';

const windows = process.platform === 'win32';
export const managedPayload = ['app', 'bin', 'install.sh', 'install.mjs', 'install-path.mjs', 'install-launcher.mjs',
  ...(!windows ? ['install.cmd'] : []), 'Install.command', 'Install.cmd', 'release.json', 'README.md'];

export function managedInstallation(path) {
  try {
    const metadata = JSON.parse(readFileSync(join(path, 'release.json'), 'utf8'));
    return typeof metadata.version === 'string' && /^[\w.+-]+$/.test(metadata.version)
      && ['linux-x64', 'macos-arm64', 'windows-x64'].includes(metadata.target)
      && packageNames.includes(JSON.parse(readFileSync(join(path, 'app/package.json'), 'utf8')).name);
  } catch { return false; }
}

function inspect(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

// A directory link can expose a project or skill rather than application state.
function ordinaryParents(path) {
  for (let parent = dirname(resolve(path)); ; parent = dirname(parent)) {
    if (inspect(parent)?.isSymbolicLink()) return false;
    if (dirname(parent) === parent) return true;
  }
}

function removeEmpty(path) {
  if (ordinaryParents(path) && inspect(path)?.isDirectory() && !inspect(path).isSymbolicLink()
    && readdirSync(path).length === 0) rmdirSync(path);
}

export function uninstallApplication(paths) {
  const application = applicationRoot();
  const legacy = new Set([join(process.env.HOME || homedir(), '.config/task-tracker/config.json'),
    ...(process.env.XDG_CONFIG_HOME ? [join(process.env.XDG_CONFIG_HOME, 'task-tracker/config.json')] : [])]);
  const configs = new Set([join(application, 'config.json'), configPath(), ...legacy]);
  const caches = new Set([join(application, 'cache'), cacheRoot()]);
  // Explicit --config / OUTASK_CONFIG files are user-owned; never enumerate them.
  for (const path of configs) {
    const entry = inspect(path);
    if (!ordinaryParents(path) || !entry || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    // Preserve a user-managed legacy link. Installer migration links target one
    // of the standard configuration files and can be retired with them.
    if (legacy.has(path) && entry.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      if (!configs.has(target)) continue;
    }
    rmSync(path, { force: true });
  }
  for (const path of caches) {
    if (ordinaryParents(path)) rmSync(path, { recursive: true, force: true });
  }
  for (const path of paths) if (inspect(path)) retirePayload(path, managedPayload);
  for (const path of [...configs].map(dirname)) removeEmpty(path);
  for (const path of [...caches].map(dirname)) removeEmpty(path);
  // Coordination files keep their inodes for running writers, independently of
  // installation and cache lifetime. Remove only empty command/application dirs.
  removeEmpty(join(application, 'commands'));
  removeEmpty(application);
}
