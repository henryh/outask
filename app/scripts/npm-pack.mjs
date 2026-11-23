import { fail } from '../src/errors.mjs';

export function parseNpmPack(output) {
  let report;
  try {
    report = JSON.parse(output);
  } catch {
    fail('INVALID_RELEASE', 'npm pack --json returned invalid JSON');
  }
  // npm 11 returns an array; npm 12 keys the archive records by package name.
  const records = report && typeof report === 'object' ? Object.values(report) : [];
  const [archive] = records;
  if (records.length !== 1 || typeof archive?.filename !== 'string' || !archive.filename
      || !Number.isSafeInteger(archive.size) || archive.size <= 0) {
    fail('INVALID_RELEASE', 'npm pack --json must report one archive with a filename and positive size');
  }
  return archive;
}
