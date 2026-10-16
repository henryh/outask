import { fail } from './errors.mjs';
import { advise, cacheSupported, cacheUnavailable, checkCacheOptions, onceAdvisory } from './cache.mjs';
import { defaultLimit, maxLimit, responseBytes } from './limits.mjs';
import { jsonBytes } from './response.mjs';
import { indexedBlockers, scheduleSearchRefresh, searchSourceState } from './search-index.mjs';
import { projectBudget } from './input.mjs';
import { openProject, recordEntries } from './stores.mjs';

export const defaultDepth = 1;
export const maxDepth = 20;

function findCycle(id, edges) {
  const links = new Map();
  for (const { from, to } of edges) {
    if (!links.has(from)) links.set(from, []);
    links.get(from).push(to);
  }
  const visited = new Set();
  const path = [];
  // The edge limit bounds this recursion, including the returned cycle path.
  function visit(current) {
    const ancestor = path.indexOf(current);
    if (ancestor !== -1) return [...path.slice(ancestor), current];
    if (visited.has(current)) return [];
    visited.add(current);
    path.push(current);
    for (const next of links.get(current) ?? []) {
      const cycle = visit(next);
      if (cycle.length) return cycle;
    }
    path.pop();
    return [];
  }
  return visit(id);
}

function inspectGraph(id, activeLinks, depth, limit) {
  const graph = {
    depth, limit, edges: [], cycle: [], cycleStatus: 'none',
    truncated: { depth: false, limit: false, response: false },
  };
  const visited = new Set([id]);
  const pending = [{ id, depth: 0 }];
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index];
    const blockers = activeLinks(current.id);
    if (current.depth === depth) {
      if (blockers.length) graph.truncated.depth = true;
      continue;
    }
    for (const to of blockers) {
      if (graph.edges.length === limit) {
        graph.truncated.limit = true;
        return graph;
      }
      graph.edges.push({ from: current.id, to });
      if (!visited.has(to)) {
        visited.add(to);
        pending.push({ id: to, depth: current.depth + 1 });
      }
    }
  }
  return graph;
}

export function inspectBlockers(projectPath, id, options = {}) {
  if (!Number.isSafeInteger(id) || id <= 0) fail('INVALID_INPUT', 'id must be a positive safe integer');
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['depth', 'limit', 'schemaPath', 'refreshMode', 'noCache', 'onAdvisory'].includes(key))) {
    fail('INVALID_INPUT', 'options contains an unsupported blocker inspection setting');
  }
  const { noCache = false, onAdvisory } = options;
  checkCacheOptions(noCache, onAdvisory);
  const notify = onceAdvisory(onAdvisory);
  const { depth = defaultDepth, limit = defaultLimit } = options;
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > maxDepth) {
    fail('INVALID_INPUT', `depth must be an integer from 1 to ${maxDepth}`);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    fail('INVALID_INPUT', `limit must be an integer from 1 to ${maxLimit}`);
  }
  const budget = projectBudget();
  budget.fingerprints = {};
  const project = openProject(projectPath, budget, false, true, options.schemaPath);
  const useCache = !noCache && cacheSupported(notify);
  const state = useCache ? searchSourceState(project) : undefined;
  let active = useCache ? indexedBlockers(project, state) : undefined;
  if (!active) {
    if (useCache) {
      try {
        scheduleSearchRefresh(project.root, {
          schemaPath: options.schemaPath, detached: options.refreshMode === 'detached',
        });
      } catch { advise(notify, cacheUnavailable); }
    }
    const { entries } = recordEntries(project, { group: 'Active' });
    active = new Map();
    for (const { record } of entries) {
      active.set(record.id, Object.hasOwn(record, 'blockers') ? { blockers: record.blockers } : {});
    }
  }
  try {
    if (!active.has(id)) fail('TASK_NOT_FOUND', `task ${id} was not found in Active; inspect history separately with get-task.mjs`);
    const links = new Map();
    function activeLinks(current) {
      if (links.has(current)) return links.get(current);
      const blockers = active.get(current).blockers;
      if (blockers !== undefined && (!Array.isArray(blockers)
        || !blockers.every((blocker) => Number.isSafeInteger(blocker) && blocker > 0))) {
        fail('INVALID_STORE', `task ${current}: blockers must be an array of positive safe integer local IDs, or omitted`);
      }
      const selected = [...new Set((blockers ?? []).filter((blocker) => active.has(blocker)))].sort((a, b) => a - b);
      links.set(current, selected);
      return selected;
    }
    const activeBlockers = activeLinks(id);
    const graph = inspectGraph(id, activeLinks, depth, limit);
    const result = { id, eligible: activeBlockers.length === 0, activeBlockers, graph };
    // Preserve exact direct eligibility; only graph details may be shortened.
    while (true) {
      graph.cycle = findCycle(id, graph.edges);
      graph.cycleStatus = graph.cycle.length ? 'found'
        : Object.values(graph.truncated).some(Boolean) ? 'unknown' : 'none';
      if (jsonBytes(result) + 1 <= responseBytes) return result;
      if (!graph.edges.length) {
        fail('OUTPUT_TOO_LARGE', `task ${id}: exact active blocker result exceeds 32 KiB; inspect smaller Active task selections with list/get`);
      }
      graph.edges.pop();
      graph.truncated.response = true;
    }
  } finally {
    active.close?.();
  }
}
