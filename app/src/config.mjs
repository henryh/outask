import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fail } from './errors.mjs';
import { readBudget, readJson } from './input.mjs';

export const defaultSlowQueryMs = 150;

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const absolute = (value) => typeof value === 'string' && isAbsolute(value) && !value.includes('\0');

export function readConfig(config, env = process.env) {
  const path = resolve(config ?? env.TASK_TRACKER_CONFIG
    ?? join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'task-tracker', 'config.json'));
  const settings = readJson(path, readBudget(), true) ?? {};
  if (!object(settings)) fail('INVALID_CONFIG', `${path}: program configuration must be an object`);
  if ((settings.projects_root !== undefined && !absolute(settings.projects_root))
    || (settings.projects !== undefined && (!object(settings.projects)
      || Object.entries(settings.projects).some(([key, value]) => !key || key === '.' || key === '..'
        || /[\\/\0]/.test(key) || !absolute(value))))) {
    fail('INVALID_CONFIG', `${path}: projects_root and projects mappings must use absolute directory paths and simple names`);
  }
  if (settings.slow_query_ms !== undefined
    && (!Number.isSafeInteger(settings.slow_query_ms) || settings.slow_query_ms < 0)) {
    fail('INVALID_CONFIG', `${path}: slow_query_ms must be a non-negative safe integer`);
  }
  return { path, settings, slowQueryMs: settings.slow_query_ms ?? defaultSlowQueryMs };
}
