import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { prepareService } from './service.mjs';
import { fail } from './errors.mjs';
import { validateFieldRules } from './field-rules.mjs';
import { validateTimestamp } from './timestamps.mjs';
import { projectBudget, readArray, readJson } from './input.mjs';

// Service fingerprints and recovery journals use portable project-relative keys.
export const projectRelative = (root, path) => relative(root, path).split(sep).join('/');

export const serviceFile = '.task-tracker.json';
export const pendingFile = '.task-tracker.pending';

export const standardStores = {
  'active.json': { statuses: ['pending', 'in_progress', 'review'] },
  'done.json': { statuses: ['done'] },
  'archive.json': { statuses: ['cancelled'] },
};
export const defaultSearch = { mode: 'scan' };
const standardGroups = {
  Active: ['pending', 'in_progress', 'review'], Done: ['done'], Archive: ['cancelled'],
};
const fileGroups = { 'active.json': 'Active', 'done.json': 'Done', 'archive.json': 'Archive' };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isStrings = (value) => Array.isArray(value) && value.every(isText);

function storeName(name) {
  return isText(name) && name.endsWith('.json') && !/[\\/\0]/.test(name)
    && ![serviceFile, 'task-schema.json'].includes(name);
}

export const defaultSchema = 'tasks/task-schema.json';
export const legacySchema = 'docs/task-schema.json';
const selectedSchema = Symbol('selectedSchema');

function contained(root, path) {
  const name = relative(root, path);
  return name !== '' && !name.startsWith('..') && !isAbsolute(name);
}

function inspectSchema(root, path, required) {
  const tail = relative(root, path);
  let current = root;
  for (const part of tail.split(sep)) {
    current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') {
        if (!required) return false;
        fail('READ_ERROR', `${path}: selected schema does not exist`);
      }
      fail('READ_ERROR', `${current}: cannot inspect schema path (${error.code})`);
    }
    if (stat.isSymbolicLink()) fail('INVALID_CONFIG', `${current}: schema path must not contain symbolic links`);
    const final = current === path;
    if (final ? !stat.isFile() : !stat.isDirectory()) {
      fail('INVALID_CONFIG', `${current}: schema path must use ordinary directories and a regular file`);
    }
  }
  return true;
}

export function selectSchema(root, schemaPath) {
  if (schemaPath?.[selectedSchema] === true && contained(root, schemaPath.path)) {
    inspectSchema(root, schemaPath.path, schemaPath.explicit);
    return schemaPath;
  }
  if (schemaPath !== undefined) {
    if (!isText(schemaPath) || schemaPath.includes('\0')) fail('INVALID_INPUT', 'schemaPath must be a non-empty project file path');
    const path = resolve(root, schemaPath);
    if (!contained(root, path)) fail('INVALID_INPUT', 'schemaPath must stay inside the selected project');
    inspectSchema(root, path, true);
    return { path, explicit: true, [selectedSchema]: true };
  }
  const preferred = join(root, defaultSchema);
  const legacy = join(root, legacySchema);
  const hasPreferred = inspectSchema(root, preferred, false);
  const hasLegacy = inspectSchema(root, legacy, false);
  if (hasPreferred && hasLegacy) {
    fail('INVALID_CONFIG', `${defaultSchema} and ${legacySchema} both exist; select one explicitly with schemaPath or --schema-path`);
  }
  return { path: hasLegacy ? legacy : preferred, explicit: false, [selectedSchema]: true };
}

function readConfig(path, budget, explicit, directory) {
  const config = readJson(path, budget, !explicit);
  if (config === undefined) return undefined;
  const invalid = (message) => fail('INVALID_CONFIG', `${path}: ${message}`);
  if (!isObject(config) || !isObject(config.stores) || Object.keys(config.stores).length === 0) {
    invalid('stores must be a non-empty object');
  }
  for (const [name, store] of Object.entries(config.stores)) {
    if (!storeName(name) || (dirname(path) === directory && name === basename(path))) {
      invalid(`invalid or reserved store name ${name}`);
    }
    if (!isObject(store) || !isStrings(store.statuses) || store.statuses.length === 0) {
      invalid(`store ${name} must define a non-empty statuses array`);
    }
    if (store.validate !== undefined && typeof store.validate !== 'boolean') {
      invalid(`store ${name} validate must be a boolean`);
    }
  }
  const statuses = new Set(Object.values(config.stores).flatMap((store) => store.statuses));
  validateFieldRules(config.fields, path, statuses);
  for (const [name, store] of Object.entries(config.stores)) {
    validateFieldRules(store.fields, `${path}: store ${name}`, statuses);
  }
  if (config.format !== undefined && !['standard', 'minimal'].includes(config.format)) {
    invalid('format must be standard or minimal');
  }
  if (config.default_status !== undefined && (!isText(config.default_status) || !statuses.has(config.default_status))) {
    invalid('default_status must be a declared status');
  }
  if (config.working_statuses !== undefined && (!isStrings(config.working_statuses)
    || !config.working_statuses.every((status) => statuses.has(status)))) {
    invalid('working_statuses must be an array of declared statuses');
  }
  if (config.plan !== undefined && (!isObject(config.plan)
    || (config.plan.required_for_statuses !== undefined && !isStrings(config.plan.required_for_statuses)))) {
    invalid('plan.required_for_statuses must be an array of non-empty strings');
  }
  if (config.search !== undefined) {
    if (!isObject(config.search)) invalid('search must be an object');
    const unknown = Object.keys(config.search).find((key) => key !== 'mode');
    if (unknown) invalid(`unknown search setting ${unknown}`);
    if (config.search.mode !== undefined && !['scan', 'indexed', 'auto'].includes(config.search.mode)) {
      invalid('search.mode must be scan, indexed or auto');
    }
  }
  if (config.groups !== undefined) {
    if (!isObject(config.groups)) invalid('groups must map Active, Done or Archive to status arrays');
    const seen = new Set();
    const statuses = new Set(Object.values(config.stores).flatMap((store) => store.statuses));
    for (const [group, members] of Object.entries(config.groups)) {
      if (!Object.hasOwn(standardGroups, group) || !isStrings(members)) {
        invalid(`invalid group ${group}; use Active, Done or Archive with status arrays`);
      }
      for (const status of members) {
        if (seen.has(status)) invalid(`status ${status} belongs to more than one group`);
        if (!statuses.has(status)) invalid(`group status ${status} is not declared in stores`);
        seen.add(status);
      }
    }
    for (const status of statuses) {
      if (!seen.has(status)) invalid(`status ${status} needs an activity group`);
    }
  }
  return config;
}

function checkPending(directory) {
  if (existsSync(join(directory, pendingFile))) {
    fail('RECOVERY_REQUIRED', 'a lifecycle move is pending; run validation to recover before reading tasks');
  }
}

export function openProject(projectPath, budget = projectBudget(), allowPending = false, prepare = true, schemaPath) {
  if (!isText(projectPath)) fail('INVALID_INPUT', 'select one project with an explicit directory path');
  const root = resolve(projectPath);
  try {
    if (!statSync(root).isDirectory()) fail('PROJECT_NOT_FOUND', `${root}: project path must be a directory`);
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') throw error;
    fail(error.code === 'ENOENT' ? 'PROJECT_NOT_FOUND' : 'READ_ERROR', `${root}: cannot open project (${error.code})`);
  }
  const directory = join(root, 'tasks');
  const schema = selectSchema(root, schemaPath);
  const config = readConfig(schema.path, budget, schema.explicit, directory);
  if (prepare) prepareService({ root, directory, schema, schemaPath: schema.path });
  if (!allowPending) checkPending(directory);
  let available;
  try {
    const schemaName = dirname(schema.path) === directory ? basename(schema.path) : undefined;
    available = readdirSync(directory).filter((name) => name.endsWith('.json')
      && ![serviceFile, 'task-schema.json', schemaName].includes(name)).sort();
  } catch (error) {
    fail('READ_ERROR', `${directory}: cannot list task stores (${error.code}); check the directory and permissions`);
  }
  // Done and Archive are optional in existing projects that only have Active.
  const stores = config?.stores ?? Object.fromEntries(Object.entries(standardStores)
    .filter(([name]) => name === 'active.json' || available.includes(name)));
  const groups = new Map();
  if (config?.groups !== undefined) {
    for (const [group, statuses] of Object.entries(config.groups)) {
      for (const status of statuses) groups.set(status, group);
    }
  } else {
    for (const [group, statuses] of Object.entries(standardGroups)) {
      for (const status of statuses) groups.set(status, group);
    }
    const inferred = new Map();
    for (const [name, store] of Object.entries(stores)) {
      const group = fileGroups[name];
      if (!group) continue;
      for (const status of store.statuses) {
        if (inferred.has(status) && inferred.get(status) !== group) {
          fail('INVALID_CONFIG', `${schema.path}: ambiguous group for ${status}; configure groups explicitly`);
        }
        inferred.set(status, group);
        groups.set(status, group);
      }
    }
  }
  for (const status of config?.working_statuses ?? []) {
    if (groups.get(status) !== 'Active') {
      fail('INVALID_CONFIG', `${schema.path}: working status ${status} must map to Active`);
    }
  }
  return { root, directory, available, stores, groups, budget, config, schema, schemaPath: schema.path };
}

export function checkSelection({ stores = [], group } = {}) {
  if (!Array.isArray(stores) || !stores.every(isText)) fail('INVALID_INPUT', 'stores must be an array of store names');
  if (group !== undefined && !Object.hasOwn(standardGroups, group)) {
    fail('INVALID_INPUT', 'group must be Active, Done or Archive');
  }
  if (stores.length && group !== undefined) fail('INVALID_INPUT', 'select stores or an activity group, not both');
  if (stores.includes('all') && stores.length !== 1) fail('INVALID_INPUT', 'all must be the only requested store');
  for (const entry of stores) {
    if (entry !== 'all' && !storeName(entry.endsWith('.json') ? entry : `${entry}.json`)) {
      fail('INVALID_INPUT', `invalid or reserved store ${entry}`);
    }
  }
}

export function selectStoreFiles(project, { stores = [], group } = {}) {
  checkPending(project.directory);
  checkSelection({ stores, group });
  if (!project.available.length) fail('READ_ERROR', `${project.directory}: no task stores exist; create a task first`);
  const selectedGroup = stores.length ? undefined : (group ?? 'Active');
  const known = [...new Set([...Object.keys(project.stores), ...project.available])].sort();
  let files;
  if (selectedGroup !== undefined) {
    files = Object.keys(project.stores).filter((name) => project.stores[name].statuses
      .some((status) => project.groups.get(status) === selectedGroup)).sort();
    if (selectedGroup === 'Active' && files.length === 0) {
      fail('INVALID_CONFIG', `no stores map to Active; configure groups in ${relative(project.root, project.schemaPath)} or select --store explicitly`);
    }
  } else if (stores.includes('all')) {
    files = known;
  } else {
    files = [...new Set(stores.map((entry) => {
      const name = entry.endsWith('.json') ? entry : `${entry}.json`;
      if (!known.includes(name)) {
        fail('INVALID_INPUT', `unknown or reserved store ${entry}; available: ${known.join(', ')}`);
      }
      return name;
    }))].sort();
  }
  return { files, selectedGroup };
}

export function recordEntries(project, options = {}) {
  const { files, selectedGroup } = selectStoreFiles(project, options);
  const entries = (function* iterate() {
    const seen = new Map();
    for (const file of files) {
      const path = join(project.directory, file);
      const { records: tasks } = readArray(path, project.budget);
      for (const { value: task, index } of tasks) {
        const label = `${path}[${index}]`;
        if (!isObject(task) || !Number.isSafeInteger(task.id) || task.id <= 0 || !isText(task.title) || !isText(task.status)) {
          fail('INVALID_STORE', `${label}: task needs a positive safe integer id and non-empty title/status strings`);
        }
        validateTimestamp(task, label);
        const rules = project.stores[file];
        if (rules && rules.validate !== false && !rules.statuses.includes(task.status)) {
          fail('INVALID_STORE', `${label}: status ${task.status} is not allowed in ${file}; expected ${rules.statuses.join(', ')}`);
        }
        if (seen.has(task.id)) fail('INVALID_STORE', `${label}: duplicate id ${task.id}; first seen at ${seen.get(task.id)}`);
        seen.set(task.id, label);
        if (selectedGroup === undefined || project.groups.get(task.status) === selectedGroup) {
          yield { record: task, store: file };
        }
      }
    }
    checkPending(project.directory);
  }());
  return { entries, stores: files };
}

export function readRecords(project, options = {}) {
  const source = recordEntries(project, options);
  const entries = [...source.entries];
  return { records: entries.map((entry) => entry.record), entries, stores: source.stores };
}

export function retainedFiles(project) {
  return [...new Set([...project.available, ...Object.keys(project.stores)])]
    .filter((name) => project.available.includes(name) || !Object.hasOwn(standardStores, name)).sort();
}
