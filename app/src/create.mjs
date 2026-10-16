import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './errors.mjs';
import { mutationProject, selectStore, withDestination } from './destinations.mjs';
import { nextTimestamp } from './timestamps.mjs';
import { projectBudget, readArray } from './input.mjs';
import { inputBytes, projectBytes, responseBytes } from './limits.mjs';
import { jsonBytes } from './response.mjs';
import { knownCounter, readService, recoverMove, replaceFile, serviceState, withProjectLock } from './service.mjs';
import { openProject, projectRelative, retainedFiles, serviceFile } from './stores.mjs';
import { scanProject, validateCycles, validateRecord } from './validation.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameFiles = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function taskInput(input) {
  if (!object(input)) fail('INVALID_INPUT', 'task input must be a JSON object');
  let source;
  try {
    source = JSON.stringify(input, (key, value) => {
      if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)
        || (typeof value === 'number' && !Number.isFinite(value))) {
        fail('INVALID_INPUT', 'task input must contain only JSON values');
      }
      return value;
    });
  } catch (error) {
    if (error.code === 'INVALID_INPUT') throw error;
    fail('INVALID_INPUT', 'task input must contain only JSON values without circular references');
  }
  if (Buffer.byteLength(source, 'utf8') > inputBytes) fail('INPUT_TOO_LARGE', 'task input exceeds the 8 MiB read budget');
  const task = JSON.parse(source);
  if (!object(task)) fail('INVALID_INPUT', 'task input must be a JSON object');
  if (task.id !== undefined && (!Number.isSafeInteger(task.id) || task.id <= 0)) {
    fail('INVALID_INPUT', 'id must be a positive safe integer');
  }
  return task;
}

function readActive(project, target, fingerprints) {
  const budget = { ...projectBudget(), fingerprints: {} };
  const active = new Map();
  const activeIds = new Set();
  let source;
  let count;
  const retained = new Set(retainedFiles(project));
  for (const [file, rules] of Object.entries(project.stores)) {
    if (!retained.has(file)) continue;
    const activeStore = rules.statuses.some((status) => project.groups.get(status) === 'Active');
    if (file !== target && !activeStore) continue;
    const path = join(project.directory, file);
    const { source: text, records } = readArray(path, budget);
    if (budget.fingerprints[path] !== fingerprints[projectRelative(project.root, path)]) {
      fail('PROJECT_CHANGED', 'task files changed before creation; retry after edits finish');
    }
    if (file === target) {
      source = text;
      count = 0;
    }
    for (const { value: record } of records) {
      if (file === target) count++;
      if (!activeStore) continue;
      if (project.groups.get(record.status) !== 'Active') continue;
      activeIds.add(record.id);
      if (rules.validate !== false) active.set(record.id, { blockers: record.blockers ?? [] });
    }
  }
  return { active, activeIds, source, count };
}

export function createTask(projectPath, input, options = {}) {
  const supplied = taskInput(input);
  if (Object.hasOwn(supplied, 'updated_at')) fail('INVALID_INPUT', 'updated_at is tracker-owned; omit it when creating a task');
  if (!object(options) || Object.keys(options).some((key) => !['store', 'schemaPath'].includes(key))
    || (options.store !== undefined && (typeof options.store !== 'string' || !options.store.trim()))) {
    fail('INVALID_INPUT', 'options must contain only optional store and schemaPath values');
  }
  const initial = openProject(projectPath, undefined, true, true, options.schemaPath);
  return withProjectLock(initial, 'creation', () => {
    recoverMove(initial);
    const destinations = mutationProject(openProject(initial.root, undefined, false, true, initial.schema));
    const status = supplied.status === undefined ? (destinations.config?.default_status ?? 'pending') : supplied.status;
    return withDestination(destinations, status, options.store, () => {
      const service = readService(initial);
      let snapshot = scanProject(initial.root, false, initial.schema);
      let counter = service.counter;
      if (counter === undefined || service.validated?.counter !== counter || !sameFiles(service.validated?.files, snapshot.fingerprints)
        || (supplied.id !== undefined && supplied.id <= counter)) {
        snapshot = scanProject(initial.root, true, initial.schema);
        counter = Math.max(knownCounter(service), snapshot.maximum);
        if (snapshot.ids.has(supplied.id)) fail('ID_CONFLICT', `task id ${supplied.id} already exists at ${snapshot.ids.get(supplied.id)}`);
      }
      const id = supplied.id ?? counter + 1;
      if (!Number.isSafeInteger(id)) fail('ID_EXHAUSTED', 'the task ID counter has reached the largest safe integer; automatic allocation is unavailable');
      const { project } = snapshot;
      const target = selectStore(project, status, options.store);
      const defaults = project.config?.format === 'minimal' ? {} : { priority: 'medium', blockers: [] };
      const task = { id, title: supplied.title, status, ...defaults, ...supplied, updated_at: nextTimestamp() };
      validateRecord(task, 'new task', project, target);
      if (task.blockers?.includes(id)) fail('INVALID_STORE', `task ${id}: blockers must not contain its own id`);
      const selected = readActive(project, target, snapshot.fingerprints);
      const working = project.config?.working_statuses ?? ['in_progress', 'review'];
      if (working.includes(status)) {
        const blockers = [...new Set((task.blockers ?? []).filter((blocker) => selected.activeIds.has(blocker)))].sort((a, b) => a - b);
        if (blockers.length) fail('ACTIVE_BLOCKERS', `task ${id} cannot enter ${status}; Active blockers: ${blockers.join(', ')}`);
      }
      if (project.groups.get(status) === 'Active') selected.active.set(id, task);
      validateCycles(selected.active);
      if (jsonBytes(task) + 1 > responseBytes) {
        fail('OUTPUT_TOO_LARGE', 'the complete created task exceeds 32 KiB; shorten the task input before creating it');
      }
      const result = `${JSON.stringify(task, null, 2)}\n`;
      // Append to the original array so unrelated numeric literals and formatting survive.
      const end = selected.source.lastIndexOf(0x5d);
      let contentEnd = end;
      while ([0x20, 0x09, 0x0a, 0x0d].includes(selected.source[contentEnd - 1])) contentEnd--;
      const record = Buffer.from(result.trimEnd().split('\n').map((line) => `  ${line}`).join('\n'));
      const source = Buffer.concat([
        selected.source.subarray(0, contentEnd), Buffer.from(`${selected.count ? ',' : ''}\n`),
        record, Buffer.from('\n'), selected.source.subarray(end),
      ]);
      if (source.length - selected.source.length > project.budget.remaining) {
        fail('INPUT_TOO_LARGE', `creating this task would exceed the ${projectBytes / 1024 / 1024} MiB project source budget; reduce retained input first`);
      }
      const path = join(project.directory, target);
      const fingerprints = { ...snapshot.fingerprints, [projectRelative(project.root, path)]: createHash('sha256').update(source).digest('hex') };
      const state = serviceState(service, Math.max(counter, id), fingerprints);
      if (jsonBytes(state, 2, inputBytes) + 1 > inputBytes) fail('INPUT_TOO_LARGE', 'resulting service state would exceed its 8 MiB read budget');
      const stateSource = `${JSON.stringify(state, null, 2)}\n`;
      const current = scanProject(project.root, false, project.schema);
      if (!sameFiles(snapshot.fingerprints, current.fingerprints)) {
        fail('PROJECT_CHANGED', 'task files or configuration changed during creation; retry after edits finish');
      }
      replaceFile(path, source, statSync(path).mode & 0o777);
      try {
        replaceFile(join(project.directory, serviceFile), stateSource);
      } catch (error) {
        fail('WRITE_INCOMPLETE', `task ${id} was saved to tasks/${target}, but service refresh failed (${error.code}); inspect that task and validate the project before creating again; do not blindly repeat the request`);
      }
      return task;
    });
  }, 5000);
}
