import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { configPath } from '../src/locations.mjs';

export function legacyLocations(env = process.env) {
  const home = process.platform === 'win32' ? env.USERPROFILE || homedir() : env.HOME || homedir();
  return [join(home, '.local/share/task-tracker'), join(home, '.local/share/task-tracker/releases'),
    join(home, 'Library/Application Support'), join(env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Programs')];
}

export function legacyConfig(env = process.env) {
  const home = env.HOME || homedir();
  const path = join(env.XDG_CONFIG_HOME || join(home, '.config'), 'task-tracker/config.json');
  // An explicitly selected registry is never moved by an application install.
  if (env.TASK_TRACKER_CONFIG || !existsSync(path)) return undefined;
  if (!lstatSync(path).isFile() || [dirname(path), dirname(dirname(path))].some(directory => lstatSync(directory).isSymbolicLink())) {
    throw new Error(`CONFIG_MIGRATION_REQUIRED: ${path} uses a symlink or non-file; select it explicitly with TASK_TRACKER_CONFIG to preserve that external registry`);
  }
  return { source: path, target: configPath(env) };
}

// Delete only a confirmed managed payload. Unrecognised files stay in place;
// their presence must never turn an old application directory into trash.
export function retirePayload(path, payload) {
  for (const name of payload) rmSync(join(path, name), { recursive: true, force: true });
  if (readdirSync(path).length === 0) rmdirSync(path);
}

export function obsoleteInstalls(roots, destination, managed) {
  const result = [];
  for (const root of new Set(roots)) {
    if (!existsSync(root) || !lstatSync(root).isDirectory()) continue;
    for (const name of readdirSync(root)) {
      if (name !== 'OutaskAI' && !/^task-tracker-[\w.+-]+-(linux-x64|macos-arm64|windows-x64)$/.test(name)) continue;
      const path = join(root, name);
      if (path !== destination && !lstatSync(path).isSymbolicLink() && managed(path)) result.push(path);
    }
  }
  return result;
}

export function retireConfig(migration) {
  if (!migration || !existsSync(migration.target)) return;
  if (readFileSync(migration.source).equals(readFileSync(migration.target))) {
    rmSync(migration.source);
    if (readdirSync(dirname(migration.source)).length === 0) rmdirSync(dirname(migration.source));
  }
}
