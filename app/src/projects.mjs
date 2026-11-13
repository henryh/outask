import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail } from './errors.mjs';

function directory(path) {
  try {
    if (!statSync(path).isDirectory()) fail('PROJECT_NOT_FOUND', `${path}: expected a project directory`);
    return realpathSync(path);
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') throw error;
    fail('PROJECT_NOT_FOUND', `${path}: cannot access project directory (${error.code})`);
  }
}

export function selectProject({ path }) {
  return directory(resolve(path ?? process.cwd()));
}
