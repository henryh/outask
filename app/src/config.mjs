import { configPath } from './locations.mjs';
import { resolve } from 'node:path';
import { fail } from './errors.mjs';
import { readBudget, readJson } from './input.mjs';

export const defaultSlowQueryMs = 150;

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readConfig(config, env = process.env) {
  const path = resolve(config ?? env.OUTASK_CONFIG ?? configPath(env));
  const settings = readJson(path, readBudget(), true) ?? {};
  if (!object(settings)) fail('INVALID_CONFIG', `${path}: program configuration must be an object`);
  if (settings.slow_query_ms !== undefined
    && (!Number.isSafeInteger(settings.slow_query_ms) || settings.slow_query_ms < 0)) {
    fail('INVALID_CONFIG', `${path}: slow_query_ms must be a non-negative safe integer`);
  }
  return { path, settings, slowQueryMs: settings.slow_query_ms ?? defaultSlowQueryMs };
}
