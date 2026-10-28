import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import paths, { join } from 'node:path';
import { fail } from './errors.mjs';
import { databaseSync } from './sqlite.mjs';

export function lockInsideProject(root, directory, path = paths) {
  const location = path.relative(root, directory);
  return location === '' || (!path.isAbsolute(location) && location !== '..' && !location.startsWith(`..${path.sep}`));
}

export function projectLockPath(root) {
  const windows = process.platform === 'win32';
  const canonical = realpathSync(root);
  // A fixed host path keeps CLI, MCP and HTTP environments in one lock namespace.
  const directory = windows
    ? join(userInfo().homedir, 'AppData', 'Local', 'Programs', 'Outask', 'locks')
    : join(realpathSync('/var/tmp'), `task-tracker-locks-${process.getuid()}`);
  if (lockInsideProject(canonical, directory)) {
    fail('WRITE_ERROR', 'project lock directory must be outside the project');
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || (!windows && (info.uid !== process.getuid() || (info.mode & 0o077)))) {
    fail('WRITE_ERROR', `${directory}: expected a private directory owned by the current user`);
  }
  return join(directory, `${createHash('sha256').update(windows ? canonical.toLowerCase() : canonical).digest('hex')}.sqlite`);
}

function checkLegacy(project, action) {
  const path = join(project.directory, '.task-tracker.json.lock');
  try { lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return;
    fail('WRITE_ERROR', `${path}: cannot inspect legacy lock (${error.code})`);
  }
  fail('PROJECT_BUSY', `${path}: cannot lock ${action} (EEXIST); stop all older writers before manually removing this legacy lock; do not mix writer versions`);
}

export function withProjectLock(project, action, operation, wait = 0) {
  checkLegacy(project, action);
  let database;
  let path;
  try {
    path = projectLockPath(project.root);
    // Do not open/close an existing file outside SQLite: POSIX closes can drop
    // locks held by another SQLite connection in this process.
    try { writeFileSync(path, '', { flag: 'wx', mode: 0o600 }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = lstatSync(path);
    if (!info.isFile() || (process.platform !== 'win32' && info.uid !== process.getuid())) {
      fail('WRITE_ERROR', `${path}: expected a regular file owned by the current user`);
    }
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    const DatabaseSync = databaseSync();
    database = new DatabaseSync(path);
    database.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(wait))}`);
    database.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    database?.close();
    if (error.code === 'WRITE_ERROR') throw error;
    fail(error.errcode === 5 || error.errcode === 6 ? 'PROJECT_BUSY' : 'WRITE_ERROR',
      `${path ?? project.root}: cannot lock ${action} (${error.code ?? error.message}); retry after the current operation finishes`);
  }
  try {
    checkLegacy(project, action);
    return operation();
  } finally {
    // Closing rolls back the empty transaction; the OS also releases it on death.
    // Never unlink: another process may already have opened the same inode.
    database.close();
  }
}
