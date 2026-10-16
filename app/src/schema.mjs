import { statSync } from 'node:fs';
import { fail } from './errors.mjs';
import { jsonText } from './response.mjs';
import { responseBytes } from './limits.mjs';
import { readBudget, readText } from './input.mjs';
import { replaceFile, withProjectLock } from './service.mjs';
import { defaultSearch, openProject, retainedFiles, standardStores } from './stores.mjs';
import { scanProject } from './validation.mjs';

function checkOptions(options, writing = false) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['schemaPath', ...(writing ? ['replace'] : [])].includes(key))
    || (writing && options.replace !== undefined && typeof options.replace !== 'boolean')) {
    fail('INVALID_INPUT', `options must contain only schemaPath${writing ? ' and boolean replace' : ''}`);
  }
}

function effectiveSchema(project) {
  const config = project.config ?? {};
  const stores = config.stores ?? structuredClone(standardStores);
  const statuses = new Set(Object.values(stores).flatMap((store) => store.statuses));
  const groups = { Active: [], Done: [], Archive: [] };
  for (const status of statuses) {
    const group = project.groups.get(status);
    if (!group) fail('INVALID_CONFIG', `${project.schemaPath}: status ${status} needs an explicit activity group`);
    groups[group].push(status);
  }
  // An undeclared pending default must remain implicit: making it explicit would
  // turn a valid custom schema into an invalid one and inventing a status changes creation.
  const defaults = statuses.has('pending') ? { default_status: 'pending' } : {};
  const working = ['in_progress', 'review'].filter((status) => statuses.has(status));
  const schema = {
    format: 'standard', ...defaults,
    ...(working.every((status) => project.groups.get(status) === 'Active') ? { working_statuses: working } : {}),
    ...config, stores, groups, search: { ...defaultSearch, ...config.search },
  };
  if (jsonText(schema, 2, responseBytes - 1) === undefined) fail('OUTPUT_TOO_LARGE', 'effective schema exceeds the 32 KiB response budget');
  return schema;
}

export function inspectSchema(projectPath, options = {}) {
  checkOptions(options);
  return effectiveSchema(openProject(projectPath, undefined, false, true, options.schemaPath));
}

export function materialiseSchema(projectPath, options = {}) {
  checkOptions(options, true);
  const initial = openProject(projectPath, undefined, false, true, options.schemaPath);
  return withProjectLock(initial, 'schema materialisation', () => {
    const project = openProject(initial.root, undefined, false, true, initial.schema);
    const before = readText(project.schemaPath, readBudget(), true);
    if (before !== undefined && !options.replace) {
      fail('FILE_EXISTS', `${project.schemaPath}: schema already exists; explicitly request replacement`);
    }
    const schema = effectiveSchema(project);
    // Empty projects can obtain a skeleton before their first task. Existing
    // stores must already validate; materialisation never repairs task records.
    const snapshot = retainedFiles(project).length ? scanProject(project.root, true, project.schema) : undefined;
    const source = `${JSON.stringify(schema, null, 2)}\n`;
    if (snapshot) {
      if (Buffer.byteLength(source) - Buffer.byteLength(before ?? '') > snapshot.project.budget.remaining) {
        fail('INPUT_TOO_LARGE', 'materialised schema would exceed the 8 MiB project source budget');
      }
      const current = scanProject(project.root, false, project.schema);
      if (JSON.stringify(snapshot.fingerprints) !== JSON.stringify(current.fingerprints)) {
        fail('PROJECT_CHANGED', 'task files or configuration changed during schema materialisation; retry after edits finish');
      }
    }
    if (before !== readText(project.schemaPath, readBudget(), true)) {
      fail('PROJECT_CHANGED', 'schema changed during materialisation; retry after edits finish');
    }
    const mode = before === undefined ? 0o600 : statSync(project.schemaPath).mode & 0o777;
    replaceFile(project.schemaPath, source, mode, before === undefined);
    return schema;
  }, 5000);
}
