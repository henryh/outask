import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixture, task, writeStore } from '../../tests/fixtures.mjs';
import { inputBytes, projectBytes, responseBytes } from '../../src/limits.mjs';
import { projectLockPath } from '../../src/project-lock.mjs';
import { refreshSearchIndex } from '../../src/search-index.mjs';
import { databaseSync } from '../../src/sqlite.mjs';

const executable = fileURLToPath(new URL('../../bin/tasks', import.meta.url));
const cli = (root, args) => {
  const result = spawnSync(process.execPath, [executable, ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return result;
};

async function connect(t, root, command = executable, env) {
  const client = new Client({ name: 'task-tracker-acceptance', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [command, 'mcp'], cwd: root, env, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk; });
  await client.connect(transport);
  t.after(async () => { await client.close(); assert.equal(stderr, ''); });
  const call = async (name, args = {}, code) => {
    const result = await client.callTool({ name, arguments: args });
    if (code) {
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.equal(result.structuredContent.error.code, code);
    } else assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  };
  return { client, call };
}

test('MCP validation and writes share the external project lock with core', async (t) => {
  const root = fixture(t, [task(1)]);
  const { call } = await connect(t, root);
  const lock = new (databaseSync())(projectLockPath(root));
  try {
    lock.exec('BEGIN EXCLUSIVE');
    await call('validate_project', {}, 'PROJECT_BUSY');
    await call('create_task', { task: { title: 'While held' } }, 'PROJECT_BUSY');
  } finally { lock.close(); }
  const created = await call('create_task', { task: { title: 'After release' } });
  assert.equal(created.title, 'After release');
  assert.equal((await call('get_task', { id: 1 })).title, 'Task 1');
});

test('MCP and CLI report the shared project byte boundary', async (t) => {
  const root = fixture(t, [task(1)]);
  const { call } = await connect(t, root);
  const path = join(root, 'tasks/active.json');
  const source = readFileSync(path);
  writeFileSync(path, Buffer.concat([source, Buffer.alloc(projectBytes - source.length, 0x20)]));
  assert.deepEqual((await call('list_tasks', { fields: ['id'] })).tasks, [{ id: 1 }]);
  assert.equal(cli(root, ['list', '--fields', 'id', '--format', 'json']).status, 0);
  truncateSync(path, projectBytes + 1);
  await call('list_tasks', { fields: ['id'] }, 'INPUT_TOO_LARGE');
  const result = cli(root, ['list', '--fields', 'id', '--format', 'json']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`INPUT_TOO_LARGE:.*${projectBytes / 1024 / 1024} MiB`));
});

test('installed stdio SDK client discovers tools and maintains a full lifecycle with CLI parity', async (t) => {
  const root = fixture(t, [task(1), task(2, { blockers: [1], parent: 'external/8', custom: { keep: true }, tags: ['a'] })]);
  const installer = fileURLToPath(new URL('../../scripts/install-cli.mjs', import.meta.url));
  const installed = spawnSync(process.execPath, [installer, 'install', '--bin-dir', join(root, 'bin')], { encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  const { client, call } = await connect(t, root, join(root, 'bin/tasks'));
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
    'create_task', 'delete_task', 'get_task', 'get_tasks', 'inspect_blockers', 'inspect_schema', 'list_tasks', 'materialise_schema', 'search_tasks', 'transition_task', 'update_task', 'validate_project',
  ]);
  assert.ok(client.getServerCapabilities().tools);
  const schema = await call('inspect_schema');
  assert.deepEqual(schema, JSON.parse(cli(root, ['schema']).stdout));
  const taskBytes = readFileSync(join(root, 'tasks/active.json'));
  assert.deepEqual(await call('materialise_schema'), schema);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'tasks/task-schema.json'))), schema);
  await call('materialise_schema', {}, 'FILE_EXISTS');
  assert.deepEqual(await call('materialise_schema', { replace: true }), schema);
  assert.deepEqual(readFileSync(join(root, 'tasks/active.json')), taskBytes);
  const list = await call('list_tasks');
  assert.deepEqual(list, JSON.parse(cli(root, ['list', '--format', 'json']).stdout));
  const detail = await call('get_task', { id: 2 });
  assert.deepEqual(detail, JSON.parse(cli(root, ['get', '2', '--format', 'json']).stdout));
  const rawBatch = await client.callTool({ name: 'get_tasks', arguments: { ids: [2, 404, 1], fields: ['id', 'title'] } });
  assert.deepEqual(rawBatch.content, [{ type: 'text', text: 'Task operation completed; see structuredContent.' }]);
  const batch = rawBatch.structuredContent;
  assert.deepEqual(batch, JSON.parse(cli(root, ['get-many', '--id', '2', '--id', '404', '--id', '1',
    '--fields', 'id,title', '--format', 'json']).stdout));
  assert.deepEqual(batch.tasks.map((record) => record.id), [2, 1]);
  assert.deepEqual(batch.not_found, [404]);
  const rawSearch = await client.callTool({ name: 'search_tasks', arguments: {
    query: 'task', fields: ['id', 'title'], search_fields: ['title'],
  } });
  assert.deepEqual(rawSearch.content, [{ type: 'text', text: 'Task operation completed; see structuredContent.' }]);
  assert.deepEqual(rawSearch.structuredContent,
    JSON.parse(cli(root, ['search', 'task', '--fields', 'id,title', '--search-fields', 'title', '--format', 'json']).stdout));
  assert.deepEqual(await call('inspect_blockers', { id: 2 }), JSON.parse(cli(root, ['deps', '2', '--format', 'json']).stdout));
  await call('transition_task', { id: 2, status: 'in_progress' }, 'ACTIVE_BLOCKERS');
  const blocked = cli(root, ['transition', '2', '--status', 'in_progress']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /ACTIVE_BLOCKERS/);
  const created = await call('create_task', { task: { title: 'New task', scope: 'Work', acceptance: ['Check'], external: 'other/4' } });
  assert.equal(created.id, 100);
  assert.equal(created.status, 'pending');
  const changed = await call('update_task', { id: 2, patch: { add: { tags: ['b', 'b'] }, set: { priority: 'high' } } });
  assert.deepEqual(changed.tags, ['a', 'b']);
  assert.deepEqual(changed.custom, { keep: true });
  assert.equal(changed.parent, 'external/8');
  assert.deepEqual(await call('update_task', { id: 2, patch: { add: { tags: ['b'] } } }), changed);
  const next = await call('update_task', { id: 2, patch: { set: { title: 'Updated' } }, if_updated_at: changed.updated_at });
  const stale = await client.callTool({ name: 'update_task', arguments: { id: 2, patch: { set: { title: 'Stale' } }, if_updated_at: changed.updated_at } });
  assert.equal(stale.isError, true);
  const staleCli = cli(root, ['update', '2', '--json', '{"set":{"title":"Stale"}}', '--if-updated-at', changed.updated_at]);
  assert.equal(staleCli.status, 1);
  assert.ok(staleCli.stderr.includes(stale.structuredContent.error.code));
  assert.deepEqual(await call('get_task', { id: 2 }), next);
  await call('transition_task', { id: 1, status: 'done' });
  assert.equal((await call('transition_task', { id: 2, status: 'in_progress' })).status, 'in_progress');
  const archived = await call('delete_task', { id: 2 });
  assert.equal(archived.status, 'cancelled');
  await call('get_task', { id: 2 }, 'TASK_NOT_FOUND');
  assert.deepEqual(await call('get_task', { id: 2, stores: ['all'] }), archived);
  assert.deepEqual(JSON.parse(cli(root, ['get', '2', '--store', 'all', '--format', 'json']).stdout), archived);
  assert.equal((await call('transition_task', { id: 2, status: 'pending' })).id, 2);
  assert.equal((await call('validate_project')).valid, true);
  const records = JSON.parse(readFileSync(join(root, 'tasks/active.json')));
  assert.equal(records.find((item) => item.id === 2).title, 'Updated');
});

test('MCP list, detail and blockers share current-replica results with CLI', async (t) => {
  const root = fixture(t, [task(2, { priority: 'low', blockers: [1] }), task(1, { priority: 'high' })], {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
  });
  assert.equal(refreshSearchIndex(root), true);
  const { call } = await connect(t, root);
  assert.deepEqual(await call('list_tasks', { fields: ['id'], sort: 'priority', desc: true }),
    JSON.parse(cli(root, ['list', '--fields', 'id', '--sort', 'priority', '--desc', '--format', 'json']).stdout));
  assert.deepEqual(await call('list_tasks', { count: true }), { count: 2 });
  assert.equal(cli(root, ['list', '--count']).stdout, '2\n');
  assert.deepEqual(await call('get_task', { id: 2, fields: ['id', 'blockers'] }),
    JSON.parse(cli(root, ['get', '2', '--fields', 'id,blockers', '--format', 'json']).stdout));
  assert.deepEqual(await call('inspect_blockers', { id: 2, depth: 2 }),
    JSON.parse(cli(root, ['deps', '2', '--depth', '2', '--format', 'json']).stdout));
});

test('MCP no_cache forces authoritative JSON for every task-data read', async (t) => {
  const root = fixture(t, [task(2, { blockers: [1], scope: 'JSON needle' }), task(1)], {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    search: { mode: 'indexed' },
  });
  const blocked = join(root, 'not-a-cache-directory');
  writeFileSync(blocked, 'cache unavailable');
  const { client, call } = await connect(t, root, executable, { ...process.env, XDG_CACHE_HOME: blocked });
  assert.deepEqual((await call('list_tasks', { fields: ['id'], no_cache: true })).tasks, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(await call('list_tasks', { count: true, no_cache: true }), { count: 2 });
  assert.equal((await call('get_task', { id: 2, no_cache: true })).scope, 'JSON needle');
  assert.deepEqual((await call('get_tasks', { ids: [2, 1], fields: ['id'], no_cache: true })).tasks, [{ id: 2 }, { id: 1 }]);
  assert.deepEqual((await call('search_tasks', { query: 'needle', fields: ['id'], no_cache: true })).tasks.map(({ id }) => id), [2]);
  assert.deepEqual((await call('inspect_blockers', { id: 2, no_cache: true })).activeBlockers, [1]);
  const raw = await client.callTool({ name: 'get_task', arguments: { id: 2, no_cache: true } });
  assert.deepEqual(raw.content, [{ type: 'text', text: 'Task operation completed; see structuredContent.' }]);
});

test('MCP reports unavailable cache acceleration without failing task data', async (t) => {
  const root = fixture(t, [task(1)]);
  const preload = join(root, 'sqlite-unavailable.mjs');
  const sqliteModule = new URL('../../src/sqlite.mjs', import.meta.url).href;
  writeFileSync(preload, `import { databaseSync } from ${JSON.stringify(sqliteModule)};\nconst DatabaseSync = databaseSync();\nconst exec = DatabaseSync.prototype.exec;\nDatabaseSync.prototype.exec = function(sql) { if (sql === 'SELECT 1') throw new Error('unavailable for test'); return exec.call(this, sql); };\n`);
  const { client } = await connect(t, root, executable, {
    ...process.env, NODE_OPTIONS: `--import=${preload}`,
  });
  const result = await client.callTool({ name: 'get_task', arguments: { id: 1 } });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.equal(result.structuredContent.id, 1);
  assert.deepEqual(result.content, [
    { type: 'text', text: 'Task operation completed; see structuredContent.' },
    { type: 'text', text: 'Advisory CACHE_UNAVAILABLE: SQLite cache acceleration is unavailable; authoritative JSON was used.' },
  ]);
});

test('each call selects one project by cwd, explicit path or registry name and rejects invalid inputs', async (t) => {
  const root = fixture(t, [task(1)]);
  const other = fixture(t, [task(7)]);
  const config = join(root, 'registry.json');
  writeFileSync(config, JSON.stringify({ projects: { other } }));
  const { client, call } = await connect(t, root);
  assert.equal((await call('get_task', { id: 7, project: 'other', config })).id, 7);
  assert.deepEqual((await call('get_tasks', { ids: [7, 404], project: 'other', config, fields: ['id'] })).tasks, [{ id: 7 }]);
  assert.deepEqual((await call('search_tasks', { query: 'Task 7', project: 'other', config, fields: ['id'] })).tasks,
    [{ id: 7, matched_fields: ['title'], snippets: { title: 'Task 7' } }]);
  assert.equal((await call('get_task', { id: 7, project_path: other, config: '/missing' })).id, 7);
  assert.deepEqual((await call('get_tasks', { ids: [7], project_path: other, config: '/missing', fields: ['id'] })).tasks, [{ id: 7 }]);
  assert.deepEqual((await call('search_tasks', { query: 'Task 7', project_path: other, config: '/missing', fields: ['id'] })).tasks,
    [{ id: 7, matched_fields: ['title'], snippets: { title: 'Task 7' } }]);
  assert.equal((await call('get_task', { id: 1 })).id, 1);
  assert.deepEqual((await call('get_tasks', { ids: [1], fields: ['id'] })).tasks, [{ id: 1 }]);
  await call('list_tasks', { project: 'other', project_path: root, config }, 'INVALID_INPUT');
  await call('list_tasks', { project: 'missing', config }, 'PROJECT_NOT_FOUND');
  await call('list_tasks', { stores: ['all'], group: 'Active' }, 'INVALID_INPUT');
  await call('get_tasks', { ids: [1], project: 'other', project_path: root, config }, 'INVALID_INPUT');
  await call('get_tasks', { ids: [1], cursor: 'invalid' }, 'INVALID_CURSOR');
  await call('search_tasks', { query: 'task', project: 'other', project_path: root, config }, 'INVALID_INPUT');
  await call('search_tasks', { query: 'task', stores: ['all'], group: 'Active' }, 'INVALID_INPUT');
  for (const args of [{ limit: 0 }, { id: '1' }, { unknown: true }]) {
    const result = await client.callTool({ name: args.id ? 'get_task' : 'list_tasks', arguments: args });
    assert.equal(result.isError, true);
  }
  for (const args of [{ ids: [] }, { ids: ['1'] }, { ids: [1], unknown: true }]) {
    const result = await client.callTool({ name: 'get_tasks', arguments: args });
    assert.equal(result.isError, true);
  }
  for (const args of [{}, { query: '' }, { query: 'task', search_fields: [''] }, { query: 'task', unknown: true }]) {
    const result = await client.callTool({ name: 'search_tasks', arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal((await call('list_tasks')).total, 1);
});

test('schema_path selects the same project schema as the CLI without overloading registry config', async (t) => {
  const root = fixture(t, [task(1, { status: 'queued' })]);
  writeFileSync(join(root, 'tasks/custom-schema.json'), JSON.stringify({
    stores: { 'active.json': { statuses: ['queued'] } },
    groups: { Active: ['queued'] },
    default_status: 'queued',
  }));
  const registry = join(root, 'registry.json');
  writeFileSync(registry, JSON.stringify({ projects: { selected: root } }));
  const { call } = await connect(t, root);
  const selected = await call('list_tasks', { project: 'selected', config: registry,
    schema_path: 'tasks/custom-schema.json', stores: ['all'] });
  const command = cli(root, ['list', '--project', 'selected', '--config', registry,
    '--schema-path', 'tasks/custom-schema.json', '--store', 'all', '--format', 'json']);
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(selected, JSON.parse(command.stdout));
  const batch = await call('get_tasks', { project: 'selected', config: registry,
    schema_path: 'tasks/custom-schema.json', ids: [1], stores: ['all'], fields: ['id', 'status'] });
  const batchCommand = cli(root, ['get-many', '--project', 'selected', '--config', registry,
    '--schema-path', 'tasks/custom-schema.json', '--store', 'all', '--id', '1',
    '--fields', 'id,status', '--format', 'json']);
  assert.equal(batchCommand.status, 0, batchCommand.stderr);
  assert.deepEqual(batch, JSON.parse(batchCommand.stdout));
  const search = await call('search_tasks', { project: 'selected', config: registry,
    schema_path: 'tasks/custom-schema.json', query: 'Task 1', stores: ['all'], fields: ['id', 'status'] });
  const searchCommand = cli(root, ['search', 'Task 1', '--project', 'selected', '--config', registry,
    '--schema-path', 'tasks/custom-schema.json', '--store', 'all', '--fields', 'id,status', '--format', 'json']);
  assert.equal(searchCommand.status, 0, searchCommand.stderr);
  assert.deepEqual(search, JSON.parse(searchCommand.stdout));
  assert.equal((await call('create_task', { schema_path: 'tasks/custom-schema.json', task: { title: 'MCP selected' } })).status, 'queued');
});

test('bounded list and blocker results, cycle diagnostics and configured requirements match core contracts', async (t) => {
  const root = fixture(t, Array.from({ length: 65 }, (_, index) => task(index + 1, {
    blockers: index < 64 ? [index + 2] : [], scope: 'x'.repeat(900),
  })));
  const { call } = await connect(t, root);
  const first = await call('list_tasks', { fields: ['all'], limit: 50 });
  assert.ok(first.tasks.length < 50);
  assert.equal(first.hasMore, true);
  assert.ok(Buffer.byteLength(JSON.stringify(first, null, 2)) <= responseBytes);
  assert.equal((await call('list_tasks', { offset: first.nextOffset })).tasks[0].id, first.nextOffset + 1);
  const batch = await call('get_tasks', { ids: [65, 404, 64, 63], fields: ['id'], limit: 2 });
  assert.deepEqual(batch.tasks, [{ id: 65 }]);
  assert.deepEqual(batch.not_found, [404]);
  assert.deepEqual((await call('get_tasks', {
    ids: [65, 404, 64, 63], fields: ['id'], limit: 2, cursor: batch.next_cursor,
  })).tasks, [{ id: 64 }, { id: 63 }]);
  const boundedBatch = await call('get_tasks', {
    ids: Array.from({ length: 50 }, (_, index) => index + 1), fields: ['all'], limit: 50,
  });
  assert.equal(boundedBatch.hasMore, true);
  assert.ok(Buffer.byteLength(JSON.stringify(boundedBatch, null, 2)) <= responseBytes);
  const graph = await call('inspect_blockers', { id: 1, depth: 20, limit: 2 });
  assert.equal(graph.eligible, false);
  assert.equal(graph.graph.edges.length, 2);
  assert.equal(graph.graph.cycleStatus, 'unknown');
  writeStore(root, 'active.json', [task(1, { blockers: [2] }), task(2, { blockers: [1] })]);
  const cycle = await call('inspect_blockers', { id: 1, depth: 3 });
  assert.equal(cycle.graph.cycleStatus, 'found');
  assert.deepEqual(cycle, JSON.parse(cli(root, ['deps', '1', '--depth', '3', '--format', 'json']).stdout));
  const invalid = cli(root, ['validate']);
  assert.equal(invalid.status, 1);
  const result = await call('validate_project', {}, 'INVALID_STORE');
  assert.ok(invalid.stderr.includes(result.error.code));
  writeStore(root, 'active.json', [task(1, { acceptance: ['Check'] })]);
  writeStore(root, 'done.json', []);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({
    stores: { 'active.json': { statuses: ['pending', 'in_progress'] }, 'done.json': { statuses: ['done'] } },
    fields: { acceptance: { type: 'array', required: true, min_items: 1, items: 'string', non_empty_items: true } },
  }));
  const rejected = cli(root, ['create', '--json', '{"title":"Missing"}']);
  assert.equal(rejected.status, 1);
  await call('create_task', { task: { title: 'Missing' } }, 'INVALID_STORE');
  await call('create_task', { task: { title: 'Blank', acceptance: [''] } }, 'INVALID_STORE');
  const extended = await call('create_task', { task: { title: 'Valid', acceptance: ['Check'], custom: { owner: 'local' } } });
  assert.deepEqual(extended.custom, { owner: 'local' });
  assert.deepEqual(extended.acceptance, ['Check']);
  await call('create_task', { task: { title: 'Large', acceptance: ['Check'], details: 'x'.repeat(responseBytes) } }, 'OUTPUT_TOO_LARGE');
});

test('batch MCP preserves cache fallback, validation and output-budget errors', async (t) => {
  const indexed = fixture(t, [task(1)], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  const oversized = fixture(t, [task(2, { details: 'x'.repeat(responseBytes) })]);
  const { call } = await connect(t, indexed);
  assert.deepEqual((await call('get_tasks', { ids: [1] })).tasks.map(({ id }) => id), [1]);
  await call('get_tasks', { ids: [1, 1] }, 'INVALID_INPUT');
  await call('get_tasks', { project_path: oversized, ids: [2], fields: ['all'] }, 'OUTPUT_TOO_LARGE');
});

test('search MCP preserves core matches, continuation, cache fallback and response bounds', async (t) => {
  const root = fixture(t, Array.from({ length: 4 }, (_, index) => task(index + 1, {
    scope: `shared match ${index + 1}`,
  })));
  const config = join(root, 'registry.json');
  writeFileSync(config, JSON.stringify({ slow_query_ms: 0 }));
  const { client, call } = await connect(t, root);
  const first = await call('search_tasks', {
    query: 'SHARED', fields: ['id', 'scope'], search_fields: ['scope'], limit: 2, config,
  });
  assert.deepEqual(first.tasks.map((record) => record.id), [1, 2]);
  assert.deepEqual(first.tasks[0].matched_fields, ['scope']);
  assert.equal(first.tasks[0].snippets.scope, 'shared match 1');
  assert.equal(first.hasMore, true);
  assert.equal(first.advisories[0].code, 'SLOW_SCAN');
  assert.ok(Buffer.byteLength(JSON.stringify(first, null, 2)) <= responseBytes);
  const second = await call('search_tasks', {
    query: 'SHARED', fields: ['id', 'scope'], search_fields: ['scope'], limit: 2,
    cursor: first.next_cursor, config,
  });
  assert.deepEqual(second.tasks.map((record) => record.id), [3, 4]);
  assert.equal(second.hasMore, false);
  await call('search_tasks', { query: 'different', fields: ['id', 'scope'], search_fields: ['scope'],
    limit: 2, cursor: first.next_cursor, config }, 'INVALID_CURSOR');

  const indexed = fixture(t, [task(10)], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  assert.deepEqual((await call('search_tasks', { project_path: indexed, query: 'task' })).tasks.map(({ id }) => id), [10]);
  const oversized = fixture(t, [task(11, { scope: 'large match', details: 'x'.repeat(responseBytes) })]);
  await call('search_tasks', { project_path: oversized, query: 'large', fields: ['all'] }, 'OUTPUT_TOO_LARGE');

  const raw = await client.callTool({ name: 'search_tasks', arguments: { query: 'shared', fields: ['id'] } });
  assert.deepEqual(raw.content, [{ type: 'text', text: 'Task operation completed; see structuredContent.' }]);
  assert.ok(Buffer.byteLength(JSON.stringify(raw.structuredContent, null, 2)) <= responseBytes);
});

test('removing optional MCP dependencies leaves CLI and standalone scripts usable without touching data', (t) => {
  const root = fixture(t, [task(1)]);
  const copy = join(root, 'application');
  const app = fileURLToPath(new URL('../../', import.meta.url));
  cpSync(app, copy, { recursive: true, filter: (path) => !path.includes('/mcp/node_modules') });
  const before = readFileSync(join(root, 'tasks/active.json'), 'utf8');
  for (const args of [
    [join(copy, 'bin/tasks'), 'list', '--format', 'json'],
    [join(copy, 'scripts/get-task.mjs'), '1', '--format', 'json'],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  }
  const missing = spawnSync(process.execPath, [join(copy, 'bin/tasks'), 'mcp'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /ADAPTER_NOT_INSTALLED/);
  assert.equal(readFileSync(join(root, 'tasks/active.json'), 'utf8'), before);
});

test('oversized stdio input closes the transport before changing task data', (t) => {
  const root = fixture(t, [task(1)]);
  const before = readFileSync(join(root, 'tasks/active.json'), 'utf8');
  const result = spawnSync(process.execPath, [executable, 'mcp'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    input: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_task","arguments":{"task":{"title":"' + 'x'.repeat(inputBytes),
  });
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /buffer.*size|size.*buffer/i);
  assert.equal(readFileSync(join(root, 'tasks/active.json'), 'utf8'), before);
});
