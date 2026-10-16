import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readConfig } from './config.mjs';
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

export function selectProject({ name, path, config }, env = process.env) {
  if (name === undefined) return directory(resolve(path ?? process.cwd()));
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    fail('INVALID_INPUT', '--project expects one configured name; use --project-path for a directory');
  }
  const { path: configPath, settings } = readConfig(config, env);
  if (!existsSync(configPath)) fail('PROJECT_NOT_FOUND', `project ${name} is unknown; no config at ${configPath}`);
  const candidates = [];
  if (settings.projects_root !== undefined) {
    const child = join(settings.projects_root, name);
    if (existsSync(child)) candidates.push(directory(child));
  }
  if (Object.hasOwn(settings.projects ?? {}, name)) candidates.push(directory(settings.projects[name]));
  const matches = [...new Set(candidates)];
  if (!matches.length) fail('PROJECT_NOT_FOUND', `unknown project ${name}; use --project-path or configure its location`);
  if (matches.length > 1) fail('AMBIGUOUS_PROJECT', `project ${name} identifies multiple directories; use --project-path`);
  return matches[0];
}
