import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { inspectBlockers, maxDepth } from '../src/blockers.mjs';
import { readConfig } from '../src/config.mjs';
import { createTask } from '../src/create.mjs';
import { errorText, fail } from '../src/errors.mjs';
import { inputBytes, maxLimit } from '../src/limits.mjs';
import { selectProject } from '../src/projects.mjs';
import { jsonBytes } from '../src/response.mjs';
import { searchTasks } from '../src/search.mjs';
import { countTasks, getTask, getTasks, listTasks } from '../src/tasks.mjs';
import { deleteTask, transitionTask } from '../src/transition.mjs';
import { updateTask } from '../src/update.mjs';
import { validateProject } from '../src/validation.mjs';
import { inspectSchema, materialiseSchema } from '../src/schema.mjs';

const text = z.string().min(1);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const limit = z.number().int().min(1).max(maxLimit).optional();
const selection = {
  project: text.optional().describe('Configured project name; exclusive with project_path.'),
  project_path: text.optional().describe('Project directory; defaults to server working directory.'),
  config: text.optional().describe('Name registry path; otherwise TASK_TRACKER_CONFIG or XDG default.'),
  schema_path: text.optional().describe('Project-relative task schema; overrides automatic default/legacy selection.'),
};
const reading = {
  stores: z.array(text).optional().describe('Store names; ["all"] includes retained history. Exclusive with group.'),
  group: z.enum(['Active', 'Done', 'Archive']).optional(),
  fields: z.array(text).optional().describe('Field projection; ["all"] includes extension fields.'),
  no_cache: z.boolean().optional().describe('Read authoritative JSON only; never open or refresh the SQLite cache.'),
};
const writing = {
  store: text.optional().describe('Destination store, when ambiguous.'),
  if_updated_at: text.optional().describe('Exact last-read updated_at; rejects stale writes.'),
};
const object = z.record(z.string(), z.unknown());
const writes = ({ store, if_updated_at }) => ({ store, ifUpdatedAt: if_updated_at });
const reads = ({ no_cache, ...args }) => ({ ...args, noCache: no_cache ?? false });

export function createServer() {
  const server = new McpServer({ name: 'task-tracker', version: '0.1.0' });
  function register(name, description, shape, operation, cacheRead = false) {
    server.registerTool(name, {
      description,
      inputSchema: z.strictObject({ ...selection, ...shape }),
    }, async (args) => {
      try {
        if (jsonBytes(args, 0, inputBytes) > inputBytes) fail('INPUT_TOO_LARGE', 'tool arguments exceed 8 MiB');
        const { project, project_path, config, schema_path, ...input } = args;
        if (project !== undefined && project_path !== undefined) {
          fail('INVALID_INPUT', 'select exactly one project: project or project_path');
        }
        const path = selectProject({ name: project, path: project_path, config });
        const advisories = [];
        const result = operation(path, {
          ...input, schemaPath: schema_path,
          ...(cacheRead ? { onAdvisory: (advisory) => advisories.push(advisory) } : {}),
        }, { config });
        // Core operations bound their complete result before committing any write.
        // Avoid duplicating the payload in text, which would double the wire budget.
        return {
          content: [
            { type: 'text', text: 'Task operation completed; see structuredContent.' },
            ...advisories.map((advisory) => ({ type: 'text', text: `Advisory ${advisory.code}: ${advisory.message}` })),
          ],
          structuredContent: result,
        };
      } catch (error) {
        const result = { code: error.code ?? 'INTERNAL_ERROR', message: errorText(error.message) };
        return { isError: true, content: [{ type: 'text', text: `${result.code}: ${result.message}` }], structuredContent: { error: result } };
      }
    });
  }
  register('list_tasks', 'List tasks (Active by default), with bounded pagination. Defaults: id,title,status; limit 10; offset 0; sort id.', {
    ...reading, limit, offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    filters: z.array(z.strictObject({ field: text, value: z.string() })).optional(),
    status: text.optional().describe('Exact case-sensitive status filter.'),
    ids: z.array(id).optional(), sort: text.optional(), desc: z.boolean().optional(),
    count: z.boolean().optional().describe('Return only the matching count; omit pagination and projection arguments.'),
  }, (path, { desc, count, status, filters = [], ...args }) => {
    const query = { ...reads(args), descending: desc, filters: [...filters, ...(status === undefined ? [] : [{ field: 'status', value: status }])] };
    return count ? { count: countTasks(path, query) } : listTasks(path, query);
  }, true);
  register('get_task', 'Get one task, including all fields by default. Active only unless stores or group select history.', {
    ...reading, id,
  }, (path, { id, ...args }) => getTask(path, id, reads(args)), true);
  register('get_tasks', 'Get requested tasks in caller ID order, report missing IDs and continue with a bounded cursor.', {
    ...reading, ids: z.array(id).min(1), limit, cursor: text.optional(),
  }, (path, { ids, ...args }) => getTasks(path, ids, reads(args)), true);
  register('search_tasks', 'Search task content with bounded results, snippets and stable continuation.', {
    ...reading, query: text, search_fields: z.array(text).optional(), limit, cursor: text.optional(),
  }, (path, { query, search_fields, ...args }, { config }) => searchTasks(path, query, {
    ...reads(args), searchFields: search_fields, slowQueryMs: readConfig(config).slowQueryMs, refreshMode: 'detached',
  }), true);
  register('create_task', 'Create a task with a safe project-wide ID. Returns the complete persisted record.', {
    task: object.describe('Task fields; title required, status defaults from project. Extensions preserved.'), store: writing.store,
  }, (path, { task, store, schemaPath }) => createTask(path, task, { store, schemaPath }));
  register('update_task', 'Patch a retained task atomically. Duplicate additions are silent no-ops. Returns the complete record.', {
    ...writing, id, patch: z.strictObject({
      set: object.optional(), add: z.record(z.string(), z.array(z.unknown())).optional(),
      remove: z.record(z.string(), z.array(z.unknown())).optional(), unset: z.array(text).optional(),
    }),
  }, (path, args) => updateTask(path, args.id, args.patch, { ...writes(args), schemaPath: args.schemaPath }));
  register('transition_task', 'Move a retained task to an exact configured status; Active blockers prevent starting. Returns the complete record.', {
    ...writing, id, status: text,
  }, (path, args) => transitionTask(path, args.id, args.status, { ...writes(args), schemaPath: args.schemaPath }));
  register('delete_task', 'Archive a task with its ID and fields retained; optionally select an Archive status. Returns the complete record.', {
    ...writing, id, status: text.optional(),
  }, (path, args) => deleteTask(path, args.id, { ...writes(args), status: args.status, schemaPath: args.schemaPath }));
  register('inspect_blockers', 'Inspect exact Active blockers and eligibility, plus a bounded graph. Cycles are diagnostics; defaults: depth 1, limit 10.', {
    id, limit, depth: z.number().int().min(1).max(maxDepth).optional(),
    no_cache: z.boolean().optional().describe('Read authoritative JSON only; never open or refresh the SQLite cache.'),
  }, (path, { id, ...args }) => inspectBlockers(path, id, reads(args)), true);
  register('validate_project', 'Validate retained stores after manual edits and refresh service metadata without rewriting task records.', {}, validateProject);
  register('inspect_schema', 'Inspect the complete effective project task schema as editable JSON; no task stores required.', {}, inspectSchema);
  register('materialise_schema', 'Write the effective schema at the selected project schema path without changing task records. Existing schema requires replace.', {
    replace: z.boolean().optional().describe('Explicitly allow replacement of the existing schema; custom fields are preserved.'),
  }, materialiseSchema);
  return server;
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: inputBytes });
  server.server.onerror = (error) => process.stderr.write(`${errorText(error.message)}\n`);
  process.stdin.once('end', () => { void server.close(); });
  await server.connect(transport);
}
