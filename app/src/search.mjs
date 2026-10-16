import { performance } from 'node:perf_hooks';
import { defaultSlowQueryMs } from './config.mjs';
import { advise, cacheFallback, cacheSupported, cacheUnavailable, checkCacheOptions, onceAdvisory } from './cache.mjs';
import { cursorBinding, decodeCursor, encodeCursor } from './cursor.mjs';
import { fail } from './errors.mjs';
import { checkFields, defaultFields, fieldsFor, ownValue, projectFields } from './fields.mjs';
import { defaultLimit, maxLimit, responseBytes } from './limits.mjs';
import { jsonBytes } from './response.mjs';
import { projectBudget } from './input.mjs';
import { indexedSearch, scheduleSearchRefresh, searchSourceState } from './search-index.mjs';
import { checkSelection, defaultSearch, openProject, recordEntries } from './stores.mjs';

export const defaultSearchFields = ['title', 'scope', 'acceptance', 'dependencies', 'sources', 'notes'];
const snippetLength = 160;
const isText = (value) => typeof value === 'string' && value.trim() !== '';

function scalarText(value) {
  if (value === null) return 'null';
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  return undefined;
}

function matchingScalar(value, needle) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    const text = scalarText(current);
    if (text !== undefined) {
      if (text.toLowerCase().includes(needle)) return text;
      continue;
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) pending.push(current[index]);
    } else if (current !== null && typeof current === 'object') {
      for (const entry of Object.values(current)) pending.push(entry);
    }
  }
  return undefined;
}

function snippet(text, needle) {
  if ([...text].length <= snippetLength) return text;
  const match = text.toLowerCase().indexOf(needle);
  const start = Math.max(0, match - 60);
  const prefix = start > 0 ? '…' : '';
  const end = start + snippetLength - prefix.length - 1;
  return `${prefix}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function matchTask(task, searchFields, needle) {
  const matchedFields = [];
  const snippets = {};
  for (const field of searchFields) {
    if (!Object.hasOwn(task, field)) continue;
    const text = matchingScalar(ownValue(task, field), needle);
    if (text === undefined) continue;
    matchedFields.push(field);
    snippets[field] = snippet(text, needle);
  }
  return { matchedFields, snippets };
}

function fingerprint(query, selectors) {
  return cursorBinding({
    query, search_fields: selectors.searchFields, fields: selectors.fields,
    group: selectors.group ?? (selectors.stores.length ? null : 'Active'),
    stores: [...new Set(selectors.stores)].sort(),
  });
}

function checkOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    fail('INVALID_INPUT', 'options must be an object');
  }
}

export function searchTasks(projectPath, query, options = {}) {
  checkOptions(options);
  if (!isText(query)) fail('INVALID_INPUT', 'query must be a non-empty string');
  const { stores = [], group, fields = defaultFields, searchFields = defaultSearchFields,
    limit = defaultLimit, cursor, schemaPath, slowQueryMs = defaultSlowQueryMs, refreshMode = 'local',
    noCache = false, onAdvisory } = options;
  checkCacheOptions(noCache, onAdvisory);
  const notify = onceAdvisory(onAdvisory);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    fail('INVALID_INPUT', `limit must be an integer from 1 to ${maxLimit}`);
  }
  if (!Number.isSafeInteger(slowQueryMs) || slowQueryMs < 0) {
    fail('INVALID_INPUT', 'slowQueryMs must be a non-negative safe integer');
  }
  checkSelection({ stores, group });
  fieldsFor(fields, []);
  fieldsFor(searchFields, []);
  const budget = projectBudget();
  budget.fingerprints = {};
  const project = openProject(projectPath, budget, false, true, schemaPath);
  const settings = { ...defaultSearch, ...project.config?.search };
  const started = performance.now();
  let source;
  const useCache = !noCache && settings.mode !== 'scan' && cacheSupported(notify);
  let usedScan = !useCache;
  let refreshAvailable = false;
  let scanBudget;
  let scanFingerprints;
  let projection;
  let searched;
  let binding;
  const needle = query.toLowerCase();
  const matches = [];
  const fixedFields = !fields.includes('all') && !searchFields.includes('all');
  let fixedOffset;
  if (!usedScan) {
    const state = searchSourceState(project);
    source = indexedSearch(project, state, { stores, group, searchFields }, query.toLowerCase());
    if (!source) usedScan = true;
  }
  if (usedScan) {
    scanBudget = project.budget.remaining;
    const scan = recordEntries(project, { stores, group });
    if (fixedFields) {
      projection = fieldsFor(fields, []);
      searched = fieldsFor(searchFields, []);
      binding = fingerprint(query, { stores, group, fields: projection, searchFields: searched });
      fixedOffset = decodeCursor(cursor, binding, 'search');
    }
    const fieldsSeen = {};
    let total = 0;
    for (const { record } of scan.entries) {
      if (fixedFields && total >= fixedOffset && matches.length <= limit) {
        const match = matchTask(record, searched, needle);
        if (match.matchedFields.length) matches.push({ index: total, task: record, ...match });
      }
      total++;
      for (const field of Object.keys(record)) fieldsSeen[field] = null;
    }
    scanFingerprints = { ...budget.fingerprints };
    source = {
      available: total ? [fieldsSeen] : [],
      stores: scan.stores,
      total,
    };
    if (useCache) {
      try {
        scheduleSearchRefresh(project.root, { schemaPath, detached: refreshMode === 'detached' });
        refreshAvailable = true;
        if (settings.mode === 'indexed') advise(notify, cacheFallback);
      }
      catch { advise(notify, cacheUnavailable); }
    }
  }
  try {
    projection ??= fieldsFor(fields, source.available);
    searched ??= fieldsFor(searchFields, source.available);
    checkFields(projection, source.available);
    binding ??= fingerprint(query, { stores, group, fields: projection, searchFields: searched });
    const offset = decodeCursor(cursor, binding, 'search');
    if (offset > source.total) fail('INVALID_CURSOR', 'cursor is past the current search data; start a new search');
    const batchSize = Math.max(limit + 1, 32);
    if (usedScan && !fixedFields) {
      project.budget = { remaining: scanBudget, limit: budget.limit, fingerprints: {} };
      const scan = recordEntries(project, { stores, group });
      let index = 0;
      for (const { record } of scan.entries) {
        if (index++ < offset || matches.length > limit) continue;
        const match = matchTask(record, searched, needle);
        if (match.matchedFields.length) matches.push({ index: index - 1, task: record, ...match });
      }
      if (Object.entries(project.budget.fingerprints).some(([path, hash]) => scanFingerprints[path] !== hash)) {
        fail('PROJECT_CHANGED', 'task files changed during search; retry after edits finish');
      }
    } else if (!usedScan) {
      let candidates = source.read(offset, batchSize);
      while (true) {
        for (const candidate of candidates) {
          if (candidate.index < offset) continue;
          const match = matchTask(candidate.record, searched, needle);
          if (match.matchedFields.length) matches.push({ index: candidate.index, task: candidate.record, ...match });
          if (matches.length > limit) break;
        }
        if (matches.length > limit || candidates.length < batchSize) break;
        candidates = source.read(candidates.at(-1).index + 1, batchSize);
      }
    }
  } finally {
    source.close?.();
  }
  const elapsed = performance.now() - started;
  const page = {
    tasks: [], hasMore: false, next_cursor: null, stores: source.stores,
    fields: projection, search_fields: searched,
  };
  if (usedScan && elapsed > slowQueryMs) {
    page.advisories = [{
      code: 'SLOW_SCAN',
      elapsed_ms: Math.max(0.001, Math.ceil(elapsed * 1000) / 1000),
      message: noCache
        ? 'Search used authoritative JSON because no-cache was requested.'
        : refreshAvailable
        ? 'Search used a full scan while the index refreshes in the background.'
        : settings.mode === 'auto' || settings.mode === 'indexed'
        ? 'Search used authoritative JSON because SQLite cache acceleration was unavailable.'
        : 'Search used a full scan; set search.mode to auto to build and use an index.',
    }];
  }
  if (jsonBytes(page) + 1 > responseBytes) {
    fail('OUTPUT_TOO_LARGE', 'search metadata exceeds 32 KiB; select fewer --fields or --search-fields');
  }
  for (const match of matches.slice(0, limit)) {
    page.tasks.push({
      ...projectFields(match.task, projection),
      matched_fields: match.matchedFields,
      snippets: match.snippets,
    });
    page.hasMore = matches.length > page.tasks.length;
    page.next_cursor = page.hasMore ? encodeCursor(match.index + 1, binding) : null;
    if (jsonBytes(page) + 1 > responseBytes) {
      page.tasks.pop();
      if (!page.tasks.length) {
        fail('OUTPUT_TOO_LARGE', `task ${match.task.id} cannot fit in a 32 KiB search page; select fewer --fields or --search-fields`);
      }
      const previous = matches[page.tasks.length - 1];
      page.hasMore = true;
      page.next_cursor = encodeCursor(previous.index + 1, binding);
      break;
    }
  }
  return page;
}
