import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { fail } from './errors.mjs';
import { inputBytes, projectBytes } from './limits.mjs';

export function readBudget() {
  return { remaining: inputBytes, limit: inputBytes };
}

export function projectBudget() {
  return { remaining: projectBytes, limit: projectBytes };
}

export function decodeText(source, label) {
  if (!isUtf8(source)) fail('INVALID_JSON', `${label}: invalid UTF-8; correct the input and retry`);
  return source.toString('utf8');
}

function tooLarge(path, budget) {
  const limit = budget.limit ?? inputBytes;
  fail('INPUT_TOO_LARGE', `${path}: selected JSON input exceeds the ${limit / 1024 / 1024} MiB read budget; select fewer stores or reduce the file size`);
}

export function readBuffer(path, budget, optional = false) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
  } catch (error) {
    if (optional && error.code === 'ENOENT') {
      if (budget.fingerprints) budget.fingerprints[path] = null;
      return undefined;
    }
    fail('READ_ERROR', `${path}: cannot read file (${error.code}); check the path and permissions`);
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) fail('READ_ERROR', `${path}: expected a regular file; check the path`);
    if (stat.size > budget.remaining) tooLarge(path, budget);
    const chunks = [];
    let length = 0;
    // Reads stay bounded even if a file grows after the initial size check.
    while (budget.remaining > 0) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, budget.remaining));
      const count = readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      budget.remaining -= count;
      length += count;
      chunks.push(chunk.subarray(0, count));
    }
    if (fstatSync(descriptor).size > length) tooLarge(path, budget);
    const source = Buffer.concat(chunks, length);
    if (budget.fingerprints) budget.fingerprints[path] = createHash('sha256').update(source).digest('hex');
    return source;
  } catch (error) {
    if (['INPUT_TOO_LARGE', 'READ_ERROR', 'INVALID_JSON'].includes(error.code)) throw error;
    fail('READ_ERROR', `${path}: cannot read file (${error.code}); check the path and permissions`);
  } finally {
    closeSync(descriptor);
  }
}

export function readText(path, budget, optional = false) {
  const source = readBuffer(path, budget, optional);
  return source === undefined ? undefined : decodeText(source, path);
}

export function readJson(path, budget, optional = false) {
  const source = readText(path, budget, optional);
  if (source === undefined) return undefined;
  return parseJson(source, path);
}

export function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    fail('INVALID_JSON', `${label}: invalid JSON; correct the input and retry`);
  }
}

const whitespace = (byte) => byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;

export function* arrayRecords(source, label) {
  if (!isUtf8(source)) fail('INVALID_JSON', `${label}: invalid UTF-8; correct the input and retry`);
  let offset = 0;
  while (whitespace(source[offset])) offset++;
  if (source[offset++] !== 0x5b) fail('INVALID_JSON', `${label}: invalid JSON; correct the input and retry`);
  let index = 0;
  while (true) {
    while (whitespace(source[offset])) offset++;
    if (source[offset] === 0x5d) {
      offset++;
      while (whitespace(source[offset])) offset++;
      if (offset !== source.length) fail('INVALID_JSON', `${label}: invalid JSON; correct the input and retry`);
      return;
    }
    const start = offset;
    let depth = 0;
    let string = false;
    let escaped = false;
    for (; offset < source.length; offset++) {
      const byte = source[offset];
      if (string) {
        if (escaped) escaped = false;
        else if (byte === 0x5c) escaped = true;
        else if (byte === 0x22) string = false;
        continue;
      }
      if (byte === 0x22) string = true;
      else if (byte === 0x7b || byte === 0x5b) depth++;
      else if (byte === 0x7d || byte === 0x5d) {
        if (byte === 0x5d && depth === 0) break;
        depth--;
      } else if (byte === 0x2c && depth === 0) break;
    }
    const end = offset;
    let value;
    try { value = JSON.parse(source.toString('utf8', start, end)); } catch {
      fail('INVALID_JSON', `${label}: invalid JSON; correct the input and retry`);
    }
    yield { value, index, start, end };
    index++;
    if (source[offset] === 0x2c) {
      offset++;
      continue;
    }
    if (source[offset] !== 0x5d) fail('INVALID_JSON', `${label}: invalid JSON; correct the input and retry`);
  }
}

export function readArray(path, budget) {
  const source = readBuffer(path, budget);
  let offset = 0;
  while (whitespace(source[offset])) offset++;
  if (source[offset] !== 0x5b) {
    let value;
    try { value = JSON.parse(decodeText(source, path)); } catch {
      fail('INVALID_JSON', `${path}: invalid JSON; correct the input and retry`);
    }
    if (!Array.isArray(value)) fail('INVALID_STORE', `${path}: root value must be an array`);
  }
  return { source, records: arrayRecords(source, path) };
}
