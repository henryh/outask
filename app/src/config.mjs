import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { configPath } from './locations.mjs';
import { join, resolve } from 'node:path';
import { fail } from './errors.mjs';
import { readBudget, readJson } from './input.mjs';

export const defaultSlowQueryMs = 150;

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readConfig(config, env = process.env) {
  const current = configPath(env);
  const legacy = join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'task-tracker', 'config.json');
  const path = resolve(config ?? env.OUTASK_CONFIG ?? (existsSync(current) || !existsSync(legacy) ? current : legacy));
  const settings = readJson(path, readBudget(), true) ?? {};
  if (!object(settings)) fail('INVALID_CONFIG', `${path}: program configuration must be an object`);
  if (settings.slow_query_ms !== undefined
    && (!Number.isSafeInteger(settings.slow_query_ms) || settings.slow_query_ms < 0)) {
    fail('INVALID_CONFIG', `${path}: slow_query_ms must be a non-negative safe integer`);
  }
  return { path, settings, slowQueryMs: settings.slow_query_ms ?? defaultSlowQueryMs };
}
