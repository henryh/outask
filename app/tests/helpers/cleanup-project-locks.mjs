import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { projectLockPath } from '../../src/project-lock.mjs';

// Call only after fixture clients/writers close. Inspect owned fixture trees,
// never a difference of the shared user lock directory: other projects may run.
export function cleanupProjectLocks(root) {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) return;
  const remove = directory => {
    const lock = projectLockPath(directory);
    rmSync(lock, { force: true });
    rmSync(`${lock}-journal`, { force: true });
  };
  remove(root);
  const visit = directory => {
    if (existsSync(join(directory, 'tasks/.task-tracker.json'))) remove(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !['node_modules', '.git', 'cache'].includes(entry.name)) visit(join(directory, entry.name));
    }
  };
  visit(root);
}
