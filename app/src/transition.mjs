import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './errors.mjs';
import { configuredStatuses, mutationProject, selectStore, validateStatuses, withDestination } from './destinations.mjs';
import { projectBudget, readArray } from './input.mjs';
import { inputBytes, projectBytes, responseBytes } from './limits.mjs';
import { jsonBytes } from './response.mjs';
import { fingerprint, knownCounter, readService, recoverMove, saveMove, serviceState, withProjectLock } from './service.mjs';
import { changeFields } from './source.mjs';
import { openProject, projectRelative, retainedFiles, serviceFile } from './stores.mjs';
import { nextTimestamp, timestampValue, validateTimestamp } from './timestamps.mjs';
import { scanProject, validateCycles, validateRecord } from './validation.mjs';

const text = (value) => typeof value === 'string' && value.trim() !== '';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const whitespace = (byte) => [0x20, 0x09, 0x0a, 0x0d].includes(byte);

function appendRecord(source, record, count) {
  const end = source.lastIndexOf(0x5d);
  let contentEnd = end;
  while (whitespace(source[contentEnd - 1])) contentEnd--;
  return Buffer.concat([
    source.subarray(0, contentEnd), Buffer.from(`${count ? ',' : ''}\n  `), record,
    Buffer.from('\n'), source.subarray(end),
  ]);
}

function removeRecord(source, found, count) {
  if (count === 1) return Buffer.concat([source.subarray(0, found.start), source.subarray(found.end)]);
  if (found.nextStart !== undefined) {
    return Buffer.concat([source.subarray(0, found.start), source.subarray(found.nextStart)]);
  }
  return Buffer.concat([source.subarray(0, found.previousEnd), source.subarray(found.end)]);
}

export function moveTask(projectPath, id, status, options, deleting, patch) {
  if (!Number.isSafeInteger(id) || id <= 0) fail('INVALID_INPUT', 'id must be a positive safe integer');
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['ifUpdatedAt', 'store', 'schemaPath', ...(deleting ? ['status'] : [])].includes(key))
    || (options.store !== undefined && !text(options.store))
    || (!deleting && !patch && !text(status)) || (status !== undefined && !text(status))) {
    fail('INVALID_INPUT', 'supply a destination status and only optional store/ifUpdatedAt/schemaPath fields');
  }
  if (options.ifUpdatedAt !== undefined) timestampValue(options.ifUpdatedAt, 'INVALID_INPUT', 'ifUpdatedAt');
  const initial = openProject(projectPath, undefined, true, true, options.schemaPath);
  return withProjectLock(initial, 'transition', () => {
    recoverMove(initial);
    const destinations = mutationProject(openProject(initial.root, undefined, false, true, initial.schema));
    validateStatuses(destinations, status === undefined ? {} : { '--status': status });
    if (deleting) {
      const statuses = configuredStatuses(destinations, 'Archive');
      if (!statuses.length) {
        fail('INVALID_INPUT', 'no configured Archive status; configure an Archive destination before deleting');
      }
      if (status === undefined) {
        if (statuses.length > 1) fail('INVALID_INPUT', `multiple Archive statuses; select --status from: ${statuses.join(', ')}`);
        status = statuses[0];
      } else if (!statuses.includes(status)) {
        fail('INVALID_INPUT', `status ${JSON.stringify(status)} is not an Archive status; allowed Archive statuses: ${statuses.join(', ')}`);
      }
    }
    const operation = () => {
      const service = readService(initial);
      let snapshot = scanProject(initial.root, false, initial.schema);
      if (service.counter === undefined || service.validated?.counter !== service.counter
        || !same(service.validated?.files, snapshot.fingerprints)) snapshot = scanProject(initial.root, true, initial.schema);
      const { project } = snapshot;
      let target = status === undefined ? undefined : selectStore(project, status, options.store);
      const budget = projectBudget();
      const sources = new Map();
      const active = new Map();
      const activeIds = new Set();
      let found;
      const primary = Object.keys(project.stores).filter((file) => file === target
        || project.stores[file].statuses.some((value) => project.groups.get(value) === 'Active'));
      const remaining = Object.keys(project.stores).filter((file) => !primary.includes(file));
      const retained = new Set(retainedFiles(project));
      for (const file of [...primary, ...remaining]) {
        if (!retained.has(file)) continue;
        if (found && !primary.includes(file)) break;
        const rules = project.stores[file];
        const path = join(project.directory, file);
        const { source, records } = readArray(path, budget);
        if (fingerprint(source) !== snapshot.fingerprints[projectRelative(project.root, path)]) fail('PROJECT_CHANGED', 'task sources changed before transition; retry after edits finish');
        const selected = { source, count: 0 };
        sources.set(file, selected);
        let previousEnd;
        for (const entry of records) {
          const task = entry.value;
          selected.count++;
          if (found?.file === file && found.nextStart === undefined) found.nextStart = entry.start;
          if (task.id === id) found = { file, task, start: entry.start, end: entry.end, previousEnd };
          if (project.groups.get(task.status) === 'Active') {
            activeIds.add(task.id);
            if (rules.validate !== false) active.set(task.id, { blockers: task.blockers ?? [] });
          }
          previousEnd = entry.end;
        }
      }
      if (!found) {
        if (scanProject(project.root, true, project.schema).ids.has(id)) fail('INVALID_INPUT', `task ${id} is in an unconfigured store; configure its source store before transitioning it`);
        fail('TASK_NOT_FOUND', `task ${id} does not exist in retained stores`);
      }
      validateTimestamp(found.task, `task ${id}`);
      if (options.ifUpdatedAt !== undefined && found.task.updated_at !== options.ifUpdatedAt) {
        fail('TRANSITION_CONFLICT', `task ${id} updated_at is ${found.task.updated_at ?? 'missing'}; expected ${options.ifUpdatedAt}; read the current task before retrying`);
      }
      const task = patch ? patch(found.task) : { ...found.task, status };
      status = task.status;
      if (patch && status !== found.task.status) target = selectStore(project, status, options.store);
      target ??= options.store === undefined ? found.file : selectStore(project, status, options.store);
      if (!sources.has(target)) {
        const path = join(project.directory, target);
        const { source, records } = readArray(path, budget);
        if (fingerprint(source) !== snapshot.fingerprints[projectRelative(project.root, path)]) fail('PROJECT_CHANGED', 'task sources changed before transition; retry after edits finish');
        let count = 0;
        for (const _entry of records) count++;
        sources.set(target, { source, count });
      }
      const changed = !same(task, found.task) || found.file !== target;
      if (changed) task.updated_at = nextTimestamp(found.task.updated_at);
      validateRecord(task, `task ${id}`, project, target);
      if (task.blockers?.includes(id)) fail('INVALID_STORE', `task ${id}: blockers must not contain its own id`);
      if ((project.config?.working_statuses ?? ['in_progress', 'review']).includes(status)) {
        const blockers = [...new Set((task.blockers ?? []).filter((blocker) => activeIds.has(blocker)))].sort((a, b) => a - b);
        if (blockers.length) fail('ACTIVE_BLOCKERS', `task ${id} cannot enter ${status}; Active blockers: ${blockers.join(', ')}`);
      }
      active.delete(id);
      if (project.groups.get(status) === 'Active') active.set(id, task);
      validateCycles(active);
      if (jsonBytes(task) + 1 > responseBytes) fail('OUTPUT_TOO_LARGE', 'the complete transitioned task exceeds 32 KiB; shorten the record before moving it');
      if (!changed) return task;
      const selected = sources.get(found.file);
      const fields = Object.fromEntries(Object.entries(task).filter(([key, value]) => !Object.hasOwn(found.task, key) || !same(value, found.task[key])));
      const removed = Object.keys(found.task).filter((key) => !Object.hasOwn(task, key));
      const record = Buffer.from(changeFields(selected.source.toString('utf8', found.start, found.end), fields, removed));
      const replacements = new Map();
      if (target === found.file) {
        replacements.set(target, Buffer.concat([
          selected.source.subarray(0, found.start), record, selected.source.subarray(found.end),
        ]));
      }
      else {
        replacements.set(target, appendRecord(sources.get(target).source, record, sources.get(target).count));
        replacements.set(found.file, removeRecord(selected.source, found, selected.count));
      }
      let growth = 0;
      const fingerprints = { ...snapshot.fingerprints };
      const writes = [];
      for (const [file, source] of replacements) {
        growth += Buffer.byteLength(source) - Buffer.byteLength(sources.get(file).source);
        const path = join(project.directory, file);
        fingerprints[projectRelative(project.root, path)] = fingerprint(source);
        writes.push({ path: projectRelative(project.root, path), source, mode: statSync(path).mode & 0o777 });
      }
      if (growth > project.budget.remaining) fail('INPUT_TOO_LARGE', `transition would exceed the ${projectBytes / 1024 / 1024} MiB project source budget`);
      const state = serviceState(service, Math.max(knownCounter(service), snapshot.maximum), fingerprints);
      if (jsonBytes(state, 2, inputBytes) + 1 > inputBytes) fail('INPUT_TOO_LARGE', 'resulting service state exceeds its 8 MiB read budget');
      writes.push({ path: `tasks/${serviceFile}`, source: `${JSON.stringify(state, null, 2)}\n`, mode: 0o600 });
      if (!same(snapshot.fingerprints, scanProject(project.root, false, project.schema).fingerprints)) fail('PROJECT_CHANGED', 'task files or configuration changed during transition; retry after edits finish');
      saveMove(project, snapshot.fingerprints, writes);
      return task;
    };
    return status === undefined ? operation() : withDestination(destinations, status, options.store, operation);
  }, 5000);
}

export function transitionTask(projectPath, id, status, options = {}) {
  return moveTask(projectPath, id, status, options, false);
}

export function deleteTask(projectPath, id, options = {}) {
  return moveTask(projectPath, id, options?.status, options, true);
}
