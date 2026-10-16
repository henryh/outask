import { fail } from './errors.mjs';

export const defaultFields = ['id', 'title', 'status'];
export const ownValue = (task, field) => Object.hasOwn(task, field) ? task[field] : undefined;

export function fieldsFor(fields, records) {
  if (!Array.isArray(fields) || fields.length === 0
    || !fields.every((field) => typeof field === 'string' && field.trim() !== '')) {
    fail('INVALID_INPUT', 'fields must be a non-empty array of field names or ["all"]');
  }
  if (fields.includes('all')) {
    if (fields.length !== 1) fail('INVALID_INPUT', 'all must be the only requested field');
    const names = new Set();
    for (const record of records) for (const name of Object.keys(record)) names.add(name);
    return [...names];
  }
  return [...new Set(fields)];
}

export function checkFields(fields, records) {
  const available = new Set([...defaultFields, 'priority', 'blockers', 'updated_at']);
  for (const record of records) for (const name of Object.keys(record)) available.add(name);
  for (const field of fields) {
    if (records.length && !available.has(field)) {
      fail('INVALID_INPUT', `unknown field ${field}; use --fields all to inspect available task fields`);
    }
  }
}

export function projectFields(task, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(task, field)).map((field) => [field, task[field]]));
}
