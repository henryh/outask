import { join } from 'node:path';
import { fail } from './errors.mjs';
import { applyFieldRules } from './field-rules.mjs';
import { validateTimestamp } from './timestamps.mjs';
import { projectBudget, readArray, readBuffer } from './input.mjs';
import { knownCounter, readService, recoverMove, replaceFile, serviceState, withProjectLock } from './service.mjs';
import { openProject, projectRelative, retainedFiles, serviceFile } from './stores.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim() !== '';
const strings = (value) => Array.isArray(value) && value.length > 0 && value.every(text);
const id = (value) => Number.isSafeInteger(value) && value > 0;

function requirements(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(text)) {
    fail('INVALID_CONFIG', `${label}.required_fields must be an array of non-empty field names`);
  }
  return value;
}

export function validateRecord(task, label, project, file) {
  const rules = project.stores[file];
  const required = [...requirements(project.config?.required_fields, 'configuration'), ...requirements(rules?.required_fields, file)];
  const plan = project.config?.plan?.required_for_statuses ?? [];
  if (!object(task) || !id(task.id)) fail('INVALID_STORE', `${label}: id must be a positive safe integer on a task object`);
  validateTimestamp(task, label);
  const invalid = (field, message) => fail('INVALID_STORE', `${label} (task ${task.id}): ${field} ${message}`);
  for (const field of ['title', 'status']) {
    if (!text(task[field])) invalid(field, 'must be a non-empty string');
  }
  if (rules && !rules.statuses.includes(task.status)) invalid('status', `must be one of ${rules.statuses.join(', ')}`);
  for (const field of required) {
    if (!Object.hasOwn(task, field) || task[field] === null || task[field] === undefined
      || (typeof task[field] === 'string' && !text(task[field]))
      || (Array.isArray(task[field]) && !task[field].length)) invalid(field, 'is required and must not be empty');
  }
  applyFieldRules(task, project.config?.fields, task.status, 'configuration fields', invalid);
  applyFieldRules(task, rules?.fields, task.status, `${file} fields`, invalid);
  if (task.priority !== undefined && !['low', 'medium', 'high'].includes(task.priority)) {
    invalid('priority', 'must be low, medium or high');
  }
  if (task.blockers !== undefined && (!Array.isArray(task.blockers) || !task.blockers.every(id))) {
    invalid('blockers', 'must be an array of positive safe integer local IDs');
  }
  if (task.blockers?.includes(task.id)) invalid('blockers', 'must not contain its own id');
  if (plan.includes(task.status)) {
    if (!text(task.techdesign)) invalid('techdesign', `is required for status ${task.status}`);
    if (!strings(task.stages)) invalid('stages', `is required for status ${task.status}`);
  }
  if (rules && !project.groups.has(task.status)) invalid('status', `${task.status} needs a configured activity group`);
}

export function validateCycles(active) {
  const finished = new Set();
  // Iterative DFS also handles chains longer than the JavaScript call stack.
  for (const start of active.keys()) {
    if (finished.has(start)) continue;
    const path = new Set([start]);
    const stack = [{ id: start, links: (active.get(start).blockers ?? [])[Symbol.iterator]() }];
    while (stack.length) {
      const current = stack.at(-1);
      const next = current.links.next();
      if (next.done) {
        finished.add(current.id);
        path.delete(current.id);
        stack.pop();
      } else if (active.has(next.value)) {
        if (path.has(next.value)) fail('INVALID_STORE', `task ${current.id}: blockers creates an active cycle through task ${next.value}`);
        if (!finished.has(next.value)) {
          path.add(next.value);
          stack.push({ id: next.value, links: (active.get(next.value).blockers ?? [])[Symbol.iterator]() });
        }
      }
    }
  }
}

export function scanProject(projectPath, validate = true, schemaPath) {
  const budget = { ...projectBudget(), fingerprints: {} };
  const project = openProject(projectPath, budget, false, true, schemaPath);
  requirements(project.config?.required_fields, 'configuration');
  for (const [name, rules] of Object.entries(project.stores)) requirements(rules.required_fields, name);
  const files = retainedFiles(project);
  if (!files.length) fail('READ_ERROR', `${project.directory}: no task stores exist; nothing to validate; create a task first`);
  const seen = new Map();
  const active = new Map();
  let maximum = 0;
  let count = 0;
  for (const file of files) {
    if (!validate) {
      readBuffer(join(project.directory, file), budget);
      continue;
    }
    const { records } = readArray(join(project.directory, file), budget);
    for (const { value: task, index } of records) {
      const label = `tasks/${file}[${index}]`;
      if (!object(task) || !id(task.id)) fail('INVALID_STORE', `${label}: id must be a positive safe integer on a task object`);
      if (seen.has(task.id)) fail('INVALID_STORE', `${label}: duplicate id ${task.id}; first seen at ${seen.get(task.id)}`);
      seen.set(task.id, label);
      maximum = Math.max(maximum, task.id);
      count++;
      const rules = project.stores[file];
      if (rules?.validate === false) {
        validateTimestamp(task, label);
        continue;
      }
      validateRecord(task, label, project, file);
      if (rules && project.groups.get(task.status) === 'Active') {
        active.set(task.id, { blockers: task.blockers ?? [] });
      }
    }
  }
  if (validate) validateCycles(active);
  const fingerprints = Object.fromEntries(Object.entries(budget.fingerprints)
    .map(([path, hash]) => [projectRelative(project.root, path), hash]));
  return { project, fingerprints, maximum, count, files: files.length, ids: seen };
}

export function validateProject(projectPath, options = {}) {
  if (!object(options) || Object.keys(options).some((key) => key !== 'schemaPath')) {
    fail('INVALID_INPUT', 'options must contain only schemaPath');
  }
  // Resolve and check the project before creating any coordination file.
  const project = openProject(projectPath, undefined, true, true, options.schemaPath);
  const path = join(project.directory, serviceFile);
  return withProjectLock(project, 'validation', () => {
    recoverMove(project);
    const service = readService(project);
    const result = scanProject(project.root, true, project.schema);
    const counter = Math.max(knownCounter(service), result.maximum);
    const unchanged = JSON.stringify(service.validated?.files) === JSON.stringify(result.fingerprints)
      && service.counter === counter && service.validated?.counter === counter;
    const current = scanProject(project.root, false, project.schema);
    if (JSON.stringify(current.fingerprints) !== JSON.stringify(result.fingerprints)) {
      fail('PROJECT_CHANGED', 'task files or configuration changed during validation; retry after edits finish');
    }
    if (!unchanged) {
      replaceFile(path, `${JSON.stringify(serviceState(service, counter, result.fingerprints), null, 2)}\n`);
    }
    return { valid: true, tasks: result.count, stores: result.files, counter, refreshed: !unchanged };
  });
}
