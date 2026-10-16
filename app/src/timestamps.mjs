import { fail } from './errors.mjs';

export function timestampValue(value, code = 'INVALID_STORE', label = 'updated_at') {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(code, `${label} must be a canonical UTC millisecond timestamp, for example 2026-09-19T12:00:00.000Z`);
  }
  return milliseconds;
}

export function validateTimestamp(task, label) {
  if (task.updated_at !== undefined) timestampValue(task.updated_at, 'INVALID_STORE', `${label}: updated_at`);
}

export function nextTimestamp(previous) {
  const minimum = previous === undefined ? -Infinity : timestampValue(previous) + 1;
  const milliseconds = Math.max(Date.now(), minimum);
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8640000000000000) {
    fail('TIMESTAMP_EXHAUSTED', 'updated_at cannot advance beyond the supported date range; correct the task timestamp before changing it');
  }
  return new Date(milliseconds).toISOString();
}
