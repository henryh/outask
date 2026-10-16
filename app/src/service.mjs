import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, linkSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './errors.mjs';
import { arrayRecords, projectBudget, readBudget, readBuffer, readJson, readText } from './input.mjs';
import { inputBytes, projectBytes } from './limits.mjs';
import { openProject, projectRelative, pendingFile, retainedFiles, serviceFile } from './stores.mjs';
import { withProjectLock } from './project-lock.mjs';
export { withProjectLock } from './project-lock.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function prepareService(project) {
  const path = join(project.directory, serviceFile);
  const present = () => {
    try { lstatSync(path); return true; } catch (error) {
      if (error.code === 'ENOENT') return false;
      fail('READ_ERROR', `${path}: cannot inspect service state (${error.code})`);
    }
  };
  if (present()) return;
  try { mkdirSync(project.directory, { recursive: true }); } catch (error) {
    fail('WRITE_ERROR', `${project.directory}: cannot prepare task directory (${error.code})`);
  }
  withProjectLock(project, 'service preparation', () => {
    if (present()) return;
    recoverMove(project);
    if (present()) return;
    try { writeFileSync(path, '{}\n', { flag: 'wx', mode: 0o600 }); } catch (error) {
      fail('WRITE_ERROR', `${path}: cannot prepare service state (${error.code})`);
    }
  }, 5000);
}

export function readService(project) {
  const path = join(project.directory, serviceFile);
  const stored = readJson(path, readBudget(), true);
  const service = stored === undefined ? {} : stored;
  if (!object(service) || (service.counter !== undefined && (!Number.isSafeInteger(service.counter) || service.counter < 0))) {
    fail('INVALID_SERVICE', `${path}: expected an object with an optional non-negative safe integer counter`);
  }
  return service;
}

export function serviceState(service, counter, fingerprints) {
  return { ...service, counter, validated: { ...(object(service.validated) ? service.validated : {}), files: fingerprints, counter } };
}

export function knownCounter(service) {
  const certified = service.validated?.counter;
  return Math.max(service.counter ?? 0, Number.isSafeInteger(certified) && certified >= 0 ? certified : 0);
}

export function replaceFile(path, source, mode = 0o600, exclusive = false) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, source, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    if (exclusive) linkSync(temporary, path);
    else renameSync(temporary, path);
  } catch (error) {
    if (exclusive && error.code === 'EEXIST') fail('FILE_EXISTS', `${path}: file already exists; explicitly request replacement`);
    fail('WRITE_ERROR', `${path}: cannot replace file (${error.code ?? 'unknown error'})`);
  } finally {
    try { unlinkSync(temporary); } catch (error) {
      if (error.code !== 'ENOENT') fail('WRITE_ERROR', `${temporary}: cannot remove temporary file (${error.code})`);
    }
  }
}

export const fingerprint = (source) => source === undefined ? null : createHash('sha256').update(source).digest('hex');
const journalBudget = 32 * 1024 * 1024;
const storePath = (path) => /^tasks\/[^/\\\0]+\.json$/.test(path) && path !== `tasks/${serviceFile}`;

function stagedMove(project, journal, journalPath) {
  const invalid = () => fail('INVALID_SERVICE', 'invalid pending lifecycle move; preserve the sidecar and repair it before retrying');
  const hash = (value) => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
  if (!object(journal.before) || !Array.isArray(journal.writes)
    || journal.writes.length < 2 || journal.writes.length > 3 || !hash(journal.serviceBefore)) invalid();
  const schemaFile = projectRelative(project.root, project.schemaPath);
  if (Object.entries(journal.before).some(([path, value]) => (path !== schemaFile && !storePath(path)) || !hash(value))) invalid();
  if (!Object.hasOwn(journal.before, schemaFile)) invalid();
  const names = new Set();
  for (const [index, write] of journal.writes.entries()) {
    if (!object(write) || !hash(write.hash) || !Number.isInteger(write.mode)
      || write.mode < 0 || write.mode > 0o777 || names.has(write.path)
      || !/^tasks\/\.task-tracker\.move-[a-f0-9-]+-\d+\.tmp$/.test(write.staged)) invalid();
    const last = index === journal.writes.length - 1;
    if (last ? write.path !== `tasks/${serviceFile}`
      : write.path === schemaFile || !storePath(write.path) || !Object.hasOwn(journal.before, write.path)) invalid();
    names.add(write.path);
  }
  const after = { ...journal.before };
  for (const write of journal.writes.slice(0, -1)) after[write.path] = write.hash;
  const budget = { remaining: projectBytes * 2, limit: projectBytes * 2, fingerprints: {} };
  const current = openProject(project.root, budget, true, false, project.schema);
  for (const file of retainedFiles(current)) readBuffer(join(current.directory, file), budget);
  const files = Object.fromEntries(Object.entries(budget.fingerprints)
    .map(([path, value]) => [projectRelative(project.root, path), value]));
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(Object.keys(journal.before).sort())
    || Object.entries(files).some(([path, value]) => value !== journal.before[path] && value !== after[path])) {
    fail('RECOVERY_CONFLICT', 'project files changed outside the pending move; preserve the sidecar and reconcile the edits before recovery');
  }
  const service = readText(join(project.directory, serviceFile), readBudget(), true);
  const serviceHash = fingerprint(service);
  const serviceAfter = journal.writes.at(-1).hash;
  if (![journal.serviceBefore, serviceAfter].includes(serviceHash)) {
    fail('RECOVERY_CONFLICT', 'service state changed outside the pending move; reconcile it before recovery');
  }
  let finalBytes = 0;
  for (const write of journal.writes.slice(0, -1)) {
    try {
      const currentSource = files[write.path] === write.hash
        ? readBuffer(join(project.root, write.path), { remaining: projectBytes, limit: projectBytes })
        : readBuffer(join(project.root, write.staged), { remaining: projectBytes, limit: projectBytes });
      finalBytes += currentSource.length;
      for (const { value: record } of arrayRecords(currentSource, write.path)) {
        if (!object(record) || !Number.isSafeInteger(record.id) || record.id <= 0) invalid();
      }
    } catch (error) {
      if (error.code === 'INPUT_TOO_LARGE' || error.code === 'INVALID_SERVICE') throw error;
      invalid();
    }
  }
  const replaced = new Set(journal.writes.slice(0, -1).map((write) => write.path));
  for (const path of Object.keys(after)) {
    if (replaced.has(path) || after[path] === null) continue;
    try { finalBytes += lstatSync(join(project.root, path)).size; } catch { invalid(); }
  }
  if (finalBytes > projectBytes) {
    fail('INPUT_TOO_LARGE', `pending move final project exceeds the ${projectBytes / 1024 / 1024} MiB project source budget`);
  }
  let state;
  try {
    const stateSource = serviceHash === serviceAfter ? service
      : readText(join(project.root, journal.writes.at(-1).staged), readBudget());
    state = JSON.parse(stateSource);
  } catch (error) {
    if (error.code === 'INPUT_TOO_LARGE') throw error;
    invalid();
  }
  if (!object(state) || !Number.isSafeInteger(state.counter) || state.counter < 0
    || state.validated?.counter !== state.counter || JSON.stringify(state.validated?.files) !== JSON.stringify(after)) invalid();
  for (const write of journal.writes) {
    const destination = join(project.root, write.path);
    const currentHash = write.path === `tasks/${serviceFile}` ? serviceHash : files[write.path];
    const staged = join(project.root, write.staged);
    if (currentHash !== write.hash) {
      let source;
      try { source = readBuffer(staged, { remaining: projectBytes, limit: projectBytes }); } catch (error) {
        if (error.code === 'READ_ERROR') invalid();
        throw error;
      }
      if (fingerprint(source) !== write.hash) invalid();
      try { chmodSync(staged, write.mode); renameSync(staged, destination); } catch (error) {
        fail('WRITE_ERROR', `${write.path}: cannot complete pending move (${error.code})`);
      }
    }
  }
  for (const write of journal.writes) {
    try { unlinkSync(join(project.root, write.staged)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { unlinkSync(journalPath); } catch (error) {
    fail('WRITE_ERROR', `cannot remove completed lifecycle journal (${error.code}); run validation to finish recovery`);
  }
  return true;
}

export function recoverMove(project) {
  const journalPath = join(project.directory, pendingFile);
  const journal = readJson(journalPath, { remaining: journalBudget }, true);
  if (journal === undefined) return false;
  if (journal?.version === 2) return stagedMove(project, journal, journalPath);
  const invalid = () => fail('INVALID_SERVICE', 'invalid pending lifecycle move; preserve the sidecar and repair it before retrying');
  if (!object(journal) || !object(journal.before) || !Array.isArray(journal.writes)
    || journal.writes.length < 2 || journal.writes.length > 3) invalid();
  const hash = (value) => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
  const schemaFile = projectRelative(project.root, project.schemaPath);
  if (Object.entries(journal.before).some(([path, value]) => (path !== schemaFile && !storePath(path)) || !hash(value))) invalid();
  if (!Object.hasOwn(journal.before, schemaFile) || !hash(journal.serviceBefore)) invalid();
  const names = new Set();
  for (const [index, write] of journal.writes.entries()) {
    if (!object(write) || typeof write.source !== 'string' || !Number.isInteger(write.mode)
      || write.mode < 0 || write.mode > 0o777 || names.has(write.path)) invalid();
    const last = index === journal.writes.length - 1;
    if (last ? write.path !== `tasks/${serviceFile}`
      : write.path === schemaFile || !storePath(write.path) || !Object.hasOwn(journal.before, write.path)) invalid();
    names.add(write.path);
  }
  const after = { ...journal.before };
  for (const write of journal.writes.slice(0, -1)) after[write.path] = fingerprint(write.source);
  let state;
  try {
    for (const write of journal.writes.slice(0, -1)) {
      const records = JSON.parse(write.source);
      if (!Array.isArray(records) || records.some((record) => !object(record) || !Number.isSafeInteger(record.id) || record.id <= 0)) invalid();
    }
    state = JSON.parse(journal.writes.at(-1).source);
  } catch { invalid(); }
  if (!object(state) || !Number.isSafeInteger(state.counter) || state.counter < 0
    || state.validated?.counter !== state.counter || JSON.stringify(state.validated?.files) !== JSON.stringify(after)) invalid();
  // A destination-first interruption can temporarily retain both copies.
  const budget = { remaining: inputBytes * 2, fingerprints: {} };
  const current = openProject(project.root, budget, true, false, project.schema);
  for (const file of retainedFiles(current)) {
    readText(join(current.directory, file), budget);
  }
  const files = Object.fromEntries(Object.entries(budget.fingerprints).map(([path, value]) => [projectRelative(project.root, path), value]));
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(Object.keys(journal.before).sort())
    || Object.entries(files).some(([path, value]) => value !== journal.before[path] && value !== after[path])) {
    fail('RECOVERY_CONFLICT', 'project files changed outside the pending move; preserve the sidecar and reconcile the edits before recovery');
  }
  const finalBytes = inputBytes * 2 - budget.remaining + journal.writes.slice(0, -1).reduce((size, write) => {
    const original = readText(join(project.root, write.path), readBudget());
    return size + Buffer.byteLength(write.source) - Buffer.byteLength(original);
  }, 0);
  if (finalBytes > inputBytes || Buffer.byteLength(journal.writes.at(-1).source) > inputBytes) invalid();
  const service = readText(join(project.directory, serviceFile), readBudget(), true);
  if (![journal.serviceBefore, fingerprint(journal.writes.at(-1).source)].includes(fingerprint(service))) {
    fail('RECOVERY_CONFLICT', 'service state changed outside the pending move; reconcile it before recovery');
  }
  for (const write of journal.writes) {
    const currentHash = write.path === `tasks/${serviceFile}` ? fingerprint(service) : files[write.path];
    if (currentHash !== fingerprint(write.source)) replaceFile(join(project.root, write.path), write.source, write.mode);
  }
  try { unlinkSync(journalPath); } catch (error) {
    fail('WRITE_ERROR', `cannot remove completed lifecycle journal (${error.code}); run validation to finish recovery`);
  }
  return true;
}

export function saveMove(project, before, writes) {
  const service = readText(join(project.directory, serviceFile), readBudget(), true);
  const token = randomUUID();
  const staged = writes.map((write, index) => ({
    path: write.path,
    staged: `tasks/.task-tracker.move-${token}-${index}.tmp`,
    hash: fingerprint(write.source),
    mode: write.mode,
  }));
  const journal = JSON.stringify({ version: 2, before, serviceBefore: fingerprint(service), writes: staged });
  if (Buffer.byteLength(journal, 'utf8') > journalBudget) fail('INPUT_TOO_LARGE', 'pending lifecycle move exceeds its 32 MiB journal budget');
  let published = false;
  try {
    for (const [index, write] of writes.entries()) {
      replaceFile(join(project.root, staged[index].staged), write.source, write.mode, true);
    }
    replaceFile(join(project.directory, pendingFile), journal);
    published = true;
    recoverMove(project);
  } catch (error) {
    if (!published) {
      for (const write of staged) {
        try { unlinkSync(join(project.root, write.staged)); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
      }
      throw error;
    }
    fail('WRITE_INCOMPLETE', `lifecycle move is pending (${error.code}); run validation to recover before retrying the request`);
  }
}
