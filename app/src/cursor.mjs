import { createHash } from 'node:crypto';
import { fail } from './errors.mjs';

const isText = (value) => typeof value === 'string' && value.trim() !== '';

export function cursorBinding(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

export function encodeCursor(offset, binding) {
  return Buffer.from(JSON.stringify({ v: 1, o: offset, b: binding })).toString('base64url');
}

export function decodeCursor(cursor, binding, operation) {
  if (cursor === undefined) return 0;
  if (!isText(cursor) || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    fail('INVALID_CURSOR', `cursor is invalid; start a new ${operation}`);
  }
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || value.v !== 1 || !Number.isSafeInteger(value.o) || value.o < 0 || value.b !== binding) {
      fail('INVALID_CURSOR', `cursor does not belong to this ${operation}; start a new ${operation}`);
    }
    return value.o;
  } catch (error) {
    if (error.code === 'INVALID_CURSOR') throw error;
    fail('INVALID_CURSOR', `cursor is invalid; start a new ${operation}`);
  }
}
