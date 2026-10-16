import { closeSync, existsSync, fstatSync, lstatSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pendingFile, standardStores } from './stores.mjs';
import { readText } from './input.mjs';
import { fail } from './errors.mjs';

export function configuredStatuses(project, group) {
  return [...new Set(Object.values(project.stores).flatMap((rules) => rules.statuses))]
    .filter((status) => group === undefined || project.groups.get(status) === group).sort();
}

export function validateStatuses(project, supplied) {
  const allowed = configuredStatuses(project);
  const unknown = Object.entries(supplied).filter(([, status]) => !allowed.includes(status));
  if (unknown.length) {
    const values = unknown.map(([name, status]) => `${name}=${JSON.stringify(status)}`).join(', ');
    fail('INVALID_INPUT', `unknown status values: ${values}; allowed configured statuses: ${allowed.join(', ')}`);
  }
}

export function selectStore(project, status, requested) {
  validateStatuses(project, { status });
  const candidates = Object.keys(project.stores).filter((file) => project.stores[file].statuses.includes(status)).sort();
  if (requested !== undefined) {
    const name = requested.endsWith('.json') ? requested : `${requested}.json`;
    if (!candidates.includes(name)) {
      fail('INVALID_INPUT', `store ${JSON.stringify(requested)} is not a configured destination for status ${JSON.stringify(status)}; allowed destination stores: ${candidates.join(', ')}`);
    }
    return name;
  }
  if (candidates.length > 1) {
    fail('INVALID_INPUT', `status ${JSON.stringify(status)} has multiple destinations; select --store from: ${candidates.join(', ')}`);
  }
  return candidates[0];
}

// The caller owns the project lock; custom filenames always require explicit files.
export function withDestination(project, status, requested, operation) {
  const target = selectStore(project, status, requested);
  const path = join(project.directory, target);
  let created;
  if (Object.hasOwn(standardStores, target)) {
    try { lstatSync(path); } catch (error) {
      if (error.code !== 'ENOENT') fail('READ_ERROR', `${path}: cannot inspect destination (${error.code})`);
      try {
        const descriptor = openSync(path, 'wx', 0o644);
        try {
          writeFileSync(descriptor, '[]\n');
          created = fstatSync(descriptor, { bigint: true });
        } finally { closeSync(descriptor); }
      } catch (writeError) {
        fail('WRITE_ERROR', `${path}: cannot create destination (${writeError.code})`);
      }
    }
  }
  try { return operation(); } catch (error) {
    if (created && error.code !== 'WRITE_INCOMPLETE' && !existsSync(join(project.directory, pendingFile))) {
      let unchanged = false;
      try {
        const current = lstatSync(path, { bigint: true });
        unchanged = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every((key) => current[key] === created[key])
          && readText(path, { remaining: 3 }) === '[]\n';
      } catch {
        // An inaccessible, removed or changed file belongs to the external writer.
      }
      if (unchanged) unlinkSync(path);
    }
    throw error;
  }
}

export function mutationProject(project) {
  return project.config ? project : { ...project, stores: standardStores };
}
