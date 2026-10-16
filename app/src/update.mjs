import { isDeepStrictEqual } from 'node:util';
import { fail } from './errors.mjs';
import { inputBytes } from './limits.mjs';
import { moveTask } from './transition.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function updateTask(projectPath, id, input, options = {}) {
  let source;
  try {
    source = JSON.stringify(input, (key, value) => {
      if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)
        || (typeof value === 'number' && !Number.isFinite(value))) throw new Error();
      return value;
    });
  } catch { fail('INVALID_INPUT', 'patch must contain only JSON values without circular references'); }
  if (source === undefined) fail('INVALID_INPUT', 'patch must be a JSON object');
  if (Buffer.byteLength(source) > inputBytes) fail('INPUT_TOO_LARGE', 'patch exceeds the 8 MiB read budget');
  const patch = JSON.parse(source);
  if (!object(patch) || Object.keys(patch).some((key) => !['set', 'add', 'remove', 'unset'].includes(key))) {
    fail('INVALID_INPUT', 'patch must be an object with only set, add, remove and unset operations');
  }
  const seen = new Set();
  for (const [operation, fields] of Object.entries(patch)) {
    if (operation === 'unset' ? !Array.isArray(fields) || fields.some((field) => typeof field !== 'string') : !object(fields)) {
      fail('INVALID_INPUT', 'set/add/remove must be objects; unset must be an array of field names');
    }
    for (const field of operation === 'unset' ? fields : Object.keys(fields)) {
      if (field === 'id' || field === 'updated_at') fail('INVALID_INPUT', `${field} cannot be changed or removed`);
      if (seen.has(field)) fail('INVALID_INPUT', `field ${JSON.stringify(field)} occurs in more than one patch operation`);
      seen.add(field);
      if (['add', 'remove'].includes(operation) && !Array.isArray(fields[field])) {
        fail('INVALID_INPUT', `${operation} values must be arrays of elements`);
      }
    }
  }
  return moveTask(projectPath, id, patch.set?.status, options, false, (current) => {
    const task = { ...current, ...patch.set };
    for (const field of patch.unset ?? []) delete task[field];
    for (const operation of ['add', 'remove']) {
      for (const [field, values] of Object.entries(patch[operation] ?? {})) {
        if (Object.hasOwn(task, field) && !Array.isArray(task[field])) fail('INVALID_INPUT', `${JSON.stringify(field)} is not an array`);
        if (operation === 'remove' && !Object.hasOwn(task, field)) continue;
        const array = [...(task[field] ?? [])];
        const result = operation === 'remove' ? array.filter((value) => !values.some((item) => isDeepStrictEqual(item, value))) : array;
        if (operation === 'add') for (const value of values) {
          if (!result.some((item) => isDeepStrictEqual(item, value))) result.push(value);
        }
        Object.defineProperty(task, field, { value: result, writable: true, enumerable: true, configurable: true });
      }
    }
    // Reuse stored values for equal replacements so key order alone is a no-op.
    for (const key of Object.keys(task)) if (Object.hasOwn(current, key) && isDeepStrictEqual(task[key], current[key])) task[key] = current[key];
    return task;
  });
}
