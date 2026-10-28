import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  const target = resolve(configPath(env));
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`CONFIG_MIGRATION_REQUIRED: ${target} is a user-managed symlink; select your registry explicitly with TASK_TRACKER_CONFIG`);
  }
  if (lstatSync(path).isSymbolicLink() && resolve(dirname(path), readlinkSync(path)) === resolve(target)) {
    return { source: path, target };
  }
  // A directory alias may already expose exactly the canonical file. Do not
  // replace that file with a link to itself or relocate user-managed folders.
  if (existsSync(target) && realpathSync(path) === realpathSync(target)) return undefined;
  if (!lstatSync(path).isFile() || [dirname(path), dirname(dirname(path))].some(directory => lstatSync(directory).isSymbolicLink())) {
    throw new Error(`CONFIG_MIGRATION_REQUIRED: ${path} uses a symlink or non-file; select it explicitly with TASK_TRACKER_CONFIG to preserve that external registry`);
  }
  return { source: path, target };
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
      const path = join(root, name);
      if (path !== destination && !lstatSync(path).isSymbolicLink() && managed(path)) result.push(path);
    }
  }
  return result;
}

export function retireConfig(migration) {
  if (!migration) return;
  if (!existsSync(migration.target)) {
    mkdirSync(dirname(migration.target), { recursive: true });
    const staged = `${migration.target}.outask-${randomUUID()}`;
    try {
      cpSync(migration.source, staged, { errorOnExist: true, force: false });
      // Publish complete bytes without overwriting a registry created meanwhile.
      try { linkSync(staged, migration.target); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    } finally { rmSync(staged, { force: true }); }
  }
  if (!readFileSync(migration.source).equals(readFileSync(migration.target))) {
    throw new Error('CONFIG_CONFLICT: registry changed during installation; both files were retained for reconciliation');
  }
  const temporary = `${migration.source}.outask-${randomUUID()}`;
  let created = false;
  try {
    if (process.platform === 'win32') linkSync(migration.target, temporary);
    else symlinkSync(migration.target, temporary);
    created = true;
    renameSync(temporary, migration.source);
    created = false;
  } catch (error) {
    throw new Error(`CONFIG_MIGRATION_REQUIRED: could not link the legacy registry (${error.code}); neither settings copy was deleted. Select an external registry with TASK_TRACKER_CONFIG if its filesystem cannot provide the link`);
  } finally {
    if (created) rmSync(temporary, { force: true });
  }
}
