import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from '../app/src/errors.mjs';
import { archiveName, targets } from './release-config.mjs';

export const checksumName = 'SHA256SUMS';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function archiveChecksums(directory, version) {
  return targets.map(target => {
    const name = archiveName(target, version);
    return `${sha256(readFileSync(join(directory, name)))}  ${name}\n`;
  }).join('');
}

export function parseChecksums(text, version) {
  const expected = targets.map(target => archiveName(target, version));
  const entries = new Map();
  if (!text.endsWith('\n')) fail('INVALID_INPUT', 'SHA256SUMS must end with a newline');
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([a-f0-9]{64})  (\S+)$/.exec(line);
    if (!match) fail('INVALID_INPUT', 'Malformed SHA256SUMS entry');
    const [, digest, name] = match;
    if (!expected.includes(name)) fail('INVALID_INPUT', `Unexpected SHA256SUMS archive ${name}`);
    if (entries.has(name)) fail('INVALID_INPUT', `Duplicate SHA256SUMS archive ${name}`);
    entries.set(name, digest);
  }
  if (entries.size !== expected.length) fail('INVALID_INPUT', 'SHA256SUMS must include all three platform archives');
  return entries;
}

export function verifyArchive(bytes, name, checksums, version) {
  const entries = parseChecksums(checksums, version);
  if (entries.get(name) !== sha256(bytes)) fail('INVALID_INPUT', `SHA256SUMS mismatch for ${name}`);
}
