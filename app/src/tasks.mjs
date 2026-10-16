import { fail } from './errors.mjs';
import { advise, cacheFallback, cacheSupported, cacheUnavailable, checkCacheOptions, onceAdvisory } from './cache.mjs';
import { cursorBinding, decodeCursor, encodeCursor } from './cursor.mjs';
import { checkFields, defaultFields, fieldsFor, ownValue, projectFields } from './fields.mjs';
import { projectBudget } from './input.mjs';
import { defaultLimit, maxLimit, responseBytes } from './limits.mjs';
import { taskPage } from './pagination.mjs';
import { jsonBytes } from './response.mjs';
import {
  indexedList, indexedTask, indexedTasks, scheduleSearchRefresh, searchSourceState,
} from './search-index.mjs';
import { checkSelection, defaultSearch, openProject, recordEntries } from './stores.mjs';

const priorityRank = new Map([['high', 0], ['medium', 1], ['low', 2]]);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

function checkOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    fail('INVALID_INPUT', 'options must be an object');
  }
}

function matches(actual, expected) {
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(actual)) return actual.some((value) => matches(value, expected));
  if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual) === expected;
  const text = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  return text.toLowerCase().includes(expected.toLowerCase());
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null) return right === undefined || right === null ? 0 : 1;
  if (right === undefined || right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const a = typeof left === 'object' ? JSON.stringify(left) : String(left);
  const b = typeof right === 'object' ? JSON.stringify(right) : String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareTasks(left, right, sort, descending) {
  const a = sort === 'priority' ? (priorityRank.get(left.priority) ?? 1) : ownValue(left, sort);
  const b = sort === 'priority' ? (priorityRank.get(right.priority) ?? 1) : ownValue(right, sort);
  return compareValues(a, b) * (descending ? -1 : 1) || left.id - right.id;
}

function keepBest(heap, record, capacity, compare) {
  if (capacity === 0) return;
  if (heap.length < capacity) {
    heap.push(record);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(heap[parent], heap[index]) >= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  } else if (compare(record, heap[0]) < 0) {
    heap[0] = record;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && compare(heap[child], heap[child + 1]) < 0) child++;
      if (compare(heap[index], heap[child]) >= 0) break;
      [heap[index], heap[child]] = [heap[child], heap[index]];
      index = child;
    }
  }
}

function selectTasks(projectPath, options, countOnly = false) {
  checkOptions(options);
  const { stores = [], group, fields = defaultFields, filters = [], ids = [], sort = 'id',
    descending = false, limit = defaultLimit, offset = 0, schemaPath, refreshMode = 'local',
    noCache = false, onAdvisory } = options;
  checkCacheOptions(noCache, onAdvisory);
  const notify = onceAdvisory(onAdvisory);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) fail('INVALID_INPUT', `limit must be an integer from 1 to ${maxLimit}`);
  if (!Number.isSafeInteger(offset) || offset < 0) fail('INVALID_INPUT', 'offset must be a non-negative safe integer');
  if (!isText(sort) || typeof descending !== 'boolean') fail('INVALID_INPUT', 'sort must be a field name and descending must be a boolean');
  if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    fail('INVALID_INPUT', 'ids must be an array of positive safe integers');
  }
  if (!Array.isArray(filters) || !filters.every((filter) => filter && isText(filter.field) && typeof filter.value === 'string')) {
    fail('INVALID_INPUT', 'filters must contain field names and string values');
  }
  fieldsFor(fields, []);
  checkSelection({ stores, group });
  const budget = projectBudget();
  budget.fingerprints = {};
  const project = openProject(projectPath, budget, false, true, schemaPath);
  const useCache = !noCache && cacheSupported(notify);
  const state = useCache ? searchSourceState(project) : undefined;
  const replica = useCache ? indexedList(project, state, { stores, group }, { filters, ids, sort }) : undefined;
  if (replica && !replica.mixedSort) {
    try {
      const fieldRecord = Object.fromEntries(replica.available.map((field) => [field, null]));
      const projection = fieldsFor(fields, replica.sourceTotal ? [fieldRecord] : []);
      checkFields([...projection, sort, ...filters.map((filter) => filter.field)], replica.sourceTotal ? [fieldRecord] : []);
      return {
        records: countOnly ? [] : replica.records(offset, limit, descending), stores: replica.stores,
        fields: projection, sort, descending, limit, offset, total: replica.count,
        recordsOffset: 0, preSorted: true,
      };
    } finally {
      replica.close();
    }
  }
  if (useCache && !replica?.mixedSort) {
    try { scheduleSearchRefresh(project.root, { schemaPath, detached: refreshMode === 'detached' }); }
    catch { advise(notify, cacheUnavailable); }
  }
  const source = recordEntries(project, { stores, group });
  const available = {};
  const selected = [];
  const wanted = new Set(ids);
  const compare = (left, right) => compareTasks(left, right, sort, descending);
  const deepPage = !countOnly && offset + limit > 10_000;
  const capacity = countOnly || deepPage ? 0 : offset + limit;
  const scanBudget = project.budget.remaining;
  let total = 0;
  let sourceTotal = 0;
  const selectedTask = (record) => (!ids.length || wanted.has(record.id)) && filters.every(({ field, value }) => {
    const actual = ownValue(record, field);
    return field === 'status' ? actual === value : matches(actual, value);
  });
  for (const { record } of source.entries) {
    sourceTotal++;
    for (const field of Object.keys(record)) available[field] = null;
    if (selectedTask(record)) {
      total++;
      keepBest(selected, record, capacity, compare);
    }
  }
  const fieldRecords = sourceTotal ? [available] : [];
  const projection = fieldsFor(fields, fieldRecords);
  checkFields([...projection, sort, ...filters.map((filter) => filter.field)], fieldRecords);
  if (deepPage && offset < total) {
    const sourceHashes = { ...project.budget.fingerprints };
    const fromEnd = total - offset < offset + limit;
    const pageSize = fromEnd ? total - offset : offset + limit;
    const rank = fromEnd ? (left, right) => -compare(left, right) : compare;
    project.budget = { remaining: scanBudget, limit: budget.limit, fingerprints: {} };
    const again = recordEntries(project, { stores, group });
    for (const { record } of again.entries) {
      if (selectedTask(record)) keepBest(selected, record, pageSize, rank);
    }
    if (Object.entries(project.budget.fingerprints).some(([path, hash]) => sourceHashes[path] !== hash)) {
      fail('PROJECT_CHANGED', 'task files changed during listing; retry after edits finish');
    }
    selected.sort(compare);
    return { records: fromEnd ? selected.slice(0, limit) : selected.slice(offset),
      stores: source.stores, fields: projection, sort, descending, limit, offset, total,
      recordsOffset: 0, preSorted: true };
  }
  if (!countOnly) selected.sort(compare);
  return { records: selected.slice(offset), stores: source.stores, fields: projection,
    sort, descending, limit, offset, total, recordsOffset: 0, preSorted: true };
}

export function countTasks(projectPath, options = {}) {
  const query = selectTasks(projectPath, options, true);
  return query.total ?? query.records.length;
}

export function listTasks(projectPath, options = {}) {
  const query = selectTasks(projectPath, options);
  const { sort, descending } = query;
  if (!query.preSorted) query.records.sort((left, right) => compareTasks(left, right, sort, descending));
  return taskPage(query.records, query);
}

export function getTask(projectPath, id, options = {}) {
  checkOptions(options);
  const { stores = [], group, fields = ['all'], schemaPath, refreshMode = 'local',
    noCache = false, onAdvisory } = options;
  checkCacheOptions(noCache, onAdvisory);
  const notify = onceAdvisory(onAdvisory);
  if (!Number.isSafeInteger(id) || id <= 0) fail('INVALID_INPUT', 'id must be a positive safe integer');
  fieldsFor(fields, []);
  checkSelection({ stores, group });
  const budget = projectBudget();
  budget.fingerprints = {};
  const project = openProject(projectPath, budget, false, true, schemaPath);
  const useCache = !noCache && cacheSupported(notify);
  const state = useCache ? searchSourceState(project) : undefined;
  const replica = useCache ? indexedTask(project, state, { stores, group }, id) : undefined;
  let task;
  let files;
  if (replica) {
    task = replica.task;
    files = replica.stores;
  } else {
    if (useCache) {
      try { scheduleSearchRefresh(project.root, { schemaPath, detached: refreshMode === 'detached' }); }
      catch { advise(notify, cacheUnavailable); }
    }
    const source = recordEntries(project, { stores, group });
    for (const entry of source.entries) {
      if (entry.record.id === id) task = entry.record;
    }
    files = source.stores;
  }
  if (!task) fail('TASK_NOT_FOUND', `task ${id} was not found in ${files.join(', ') || 'the selected group'}; select --store all to include history`);
  const projection = fieldsFor(fields, [task]);
  checkFields(projection, [task]);
  const projected = projectFields(task, projection);
  if (jsonBytes(projected) + 1 > responseBytes) {
    fail('OUTPUT_TOO_LARGE', `task ${id} exceeds the 32 KiB response budget; select fewer --fields`);
  }
  return projected;
}

export function getTasks(projectPath, ids, options = {}) {
  checkOptions(options);
  if (!Array.isArray(ids) || ids.length === 0
    || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    fail('INVALID_INPUT', 'ids must be a non-empty array of positive safe integers');
  }
  if (new Set(ids).size !== ids.length) fail('INVALID_INPUT', 'ids must not contain duplicates');
  const { stores = [], group, fields = defaultFields, limit = defaultLimit, cursor,
    schemaPath, refreshMode = 'local', noCache = false, onAdvisory } = options;
  checkCacheOptions(noCache, onAdvisory);
  const notify = onceAdvisory(onAdvisory);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    fail('INVALID_INPUT', `limit must be an integer from 1 to ${maxLimit}`);
  }
  fieldsFor(fields, []);
  checkSelection({ stores, group });
  const budget = projectBudget();
  budget.fingerprints = {};
  const project = openProject(projectPath, budget, false, true, schemaPath);
  const settings = { ...defaultSearch, ...project.config?.search };
  let source;
  const useCache = !noCache && settings.mode !== 'scan' && cacheSupported(notify);
  if (useCache) {
    const state = searchSourceState(project);
    source = indexedTasks(project, state, { stores, group }, ids);
  }
  if (!source) {
    const scan = recordEntries(project, { stores, group });
    const wanted = new Set(ids);
    const records = new Map();
    for (const entry of scan.entries) {
      if (wanted.has(entry.record.id)) records.set(entry.record.id, entry.record);
    }
    source = { records: ids.flatMap((id) => records.has(id) ? [records.get(id)] : []), stores: scan.stores };
    if (useCache) {
      try {
        scheduleSearchRefresh(project.root, { schemaPath, detached: refreshMode === 'detached' });
        if (settings.mode === 'indexed') advise(notify, cacheFallback);
      }
      catch { advise(notify, cacheUnavailable); }
    }
  }
  const projection = fieldsFor(fields, source.records);
  checkFields(projection, source.records);
  const binding = cursorBinding({
    ids, fields: projection, group: group ?? (stores.length ? null : 'Active'),
    stores: [...new Set(stores)].sort(),
  });
  const offset = decodeCursor(cursor, binding, 'batch request');
  if (offset > ids.length) fail('INVALID_CURSOR', 'cursor is past the requested IDs; start a new batch request');
  const found = new Map(source.records.map((record) => [record.id, record]));
  const page = {
    tasks: [], not_found: [], hasMore: false, next_cursor: null,
    stores: source.stores, fields: projection,
  };
  if (jsonBytes(page) + 1 > responseBytes) {
    fail('OUTPUT_TOO_LARGE', 'batch metadata exceeds 32 KiB; select fewer --fields or stores');
  }
  for (let index = offset; index < ids.length && index < offset + limit; index++) {
    const task = found.get(ids[index]);
    if (task) page.tasks.push(projectFields(task, projection));
    else page.not_found.push(ids[index]);
    page.hasMore = index + 1 < ids.length;
    page.next_cursor = page.hasMore ? encodeCursor(index + 1, binding) : null;
    if (jsonBytes(page) + 1 > responseBytes) {
      if (task) page.tasks.pop();
      else page.not_found.pop();
      page.hasMore = true;
      page.next_cursor = encodeCursor(index, binding);
      if (!page.tasks.length && !page.not_found.length) {
        fail('OUTPUT_TOO_LARGE', `task ${ids[index]} cannot fit in a 32 KiB batch page; select fewer --fields`);
      }
      break;
    }
  }
  return page;
}
