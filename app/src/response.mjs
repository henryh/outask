import { responseBytes } from './limits.mjs';

function stringBytes(value, ceiling) {
  let bytes = 2;
  for (let index = 0; index < value.length && bytes <= ceiling; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
    else if (code < 32) bytes += 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
  }
  return bytes;
}

// Count escaped UTF-8 and indentation before JSON.stringify can allocate output.
// An explicit stack also bounds deeply nested input without recursive traversal.
export function jsonBytes(value, indent = 2, ceiling = responseBytes) {
  const pending = [{ value, depth: 0 }];
  let bytes = 0;
  while (pending.length && bytes <= ceiling) {
    const { value: current, depth } = pending.pop();
    if (typeof current === 'string') bytes += stringBytes(current, ceiling - bytes);
    else if (current === null || typeof current !== 'object') {
      bytes += current === null || (typeof current === 'number' && !Number.isFinite(current)) ? 4 : String(current).length;
    } else {
      const array = Array.isArray(current);
      const keys = array ? undefined : Object.keys(current);
      const length = array ? current.length : keys.length;
      bytes += length === 0 ? 2 : indent
        ? 2 + 2 * length + length * indent * (depth + 1) + indent * depth
        : length + 1;
      if (!array) {
        for (const key of keys) {
          bytes += stringBytes(key, ceiling - bytes) + (indent ? 2 : 1);
          if (bytes > ceiling) break;
        }
      }
      if (bytes > ceiling) break;
      for (let index = length - 1; index >= 0; index--) {
        pending.push({ value: current[array ? index : keys[index]], depth: depth + 1 });
      }
    }
  }
  return bytes;
}

export function jsonText(value, indent = 2, ceiling = responseBytes) {
  if (jsonBytes(value, indent, ceiling) > ceiling) return undefined;
  return JSON.stringify(value, null, indent);
}

export function textBuffer(ceiling = responseBytes) {
  const parts = [];
  let bytes = 0;
  return {
    add(text) {
      bytes += Buffer.byteLength(text, 'utf8');
      if (bytes > ceiling) return false;
      parts.push(text);
      return true;
    },
    spaces(count) {
      bytes += count;
      if (bytes > ceiling) return false;
      parts.push(' '.repeat(count));
      return true;
    },
    finish() { return bytes <= ceiling ? parts.join('') : undefined; },
  };
}
