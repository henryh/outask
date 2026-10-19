import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { linkSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHttpServer } from '../http.mjs';
import { inspectBlockers } from '../src/blockers.mjs';
import { createTask } from '../src/create.mjs';
import { projectBytes, responseBytes } from '../src/limits.mjs';
import { projectLockPath } from '../src/project-lock.mjs';
import { databaseSync } from '../src/sqlite.mjs';
import { searchTasks } from '../src/search.mjs';
import { refreshSearchIndex } from '../src/search-index.mjs';
import { getTask, getTasks, listTasks } from '../src/tasks.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

const token = 'test_read_token_'.repeat(3);
const authorization = `Bearer ${token}`;

async function serve(t, root, origins = [], options = {}) {
  const server = createHttpServer(root, { token, origins, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, method = 'GET', body, headers = {}) => {
    const { response, text } = await new Promise((resolve, reject) => {
      const req = request(base + path, { method, headers: { Authorization: authorization, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) }), ...headers } }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ response, text }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    assert.ok(Buffer.byteLength(text) <= responseBytes);
    return { status: response.statusCode, headers: response.headers, data: text ? JSON.parse(text) : null };
  };
}

async function expectError(call, status, code) {
  const result = await call;
  assert.equal(result.status, status, JSON.stringify(result));
  assert.equal(result.data.error.code, code);
}

test('HTTP reads an uninitialised project as empty without writing task records', async (t) => {
  const root = fixture(t, []);
  rmSync(join(root, 'tasks'), { recursive: true });
  const api = await serve(t, root);
  assert.deepEqual((await api('/tasks?count=true')).data, { count: 0 });
  for (const suffix of ['', '&no-cache=true']) {
    for (let repeat = 0; repeat < 2; repeat++) {
      const page = await api(`/tasks?group=Active&fields=id,title,status&limit=50${suffix}`);
      assert.equal(page.status, 200);
      assert.deepEqual(page.data.tasks, []);
      assert.equal(page.data.hasMore, false);
      assert.equal(page.data.nextOffset, null);
      const count = await api(`/tasks?count=true${suffix}`);
      assert.equal(count.status, 200);
      assert.deepEqual(count.data, { count: 0 });
    }
    await expectError(api(`/tasks?limit=100${suffix}`), 400, 'INVALID_INPUT');
    await expectError(api(`/tasks/1?fields=id${suffix}`), 404, 'TASK_NOT_FOUND');
  }
  assert.deepEqual(readdirSync(root), ['tasks']);
  assert.deepEqual(readdirSync(join(root, 'tasks')), ['.task-tracker.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.json'))), {});
  assert.equal(createTask(root, { title: 'First real task' }).id, 1);
  assert.deepEqual((await api('/tasks?fields=id')).data.tasks, [{ id: 1 }]);
  assert.deepEqual((await api('/tasks?count=true')).data, { count: 1 });
  rmSync(join(root, 'tasks/active.json'));
  await expectError(api('/tasks?fields=id'), 500, 'READ_ERROR');
  await expectError(api('/tasks?count=true&no-cache=true'), 500, 'READ_ERROR');
});

test('HTTP uses the shared project byte boundary without exposing writes', async (t) => {
  const root = fixture(t, [task(1)]);
  const api = await serve(t, root);
  const path = join(root, 'tasks/active.json');
  const source = readFileSync(path);
  writeFileSync(path, Buffer.concat([source, Buffer.alloc(projectBytes - source.length, 0x20)]));
  assert.deepEqual((await api('/tasks?fields=id')).data.tasks, [{ id: 1 }]);
  truncateSync(path, projectBytes + 1);
  await expectError(api('/tasks?fields=id'), 413, 'INPUT_TOO_LARGE');
  await expectError(api('/tasks', 'POST', { title: 'Not allowed' }), 405, 'METHOD_NOT_ALLOWED');
});

test('HTTP list and detail preserve core results through a current read replica', async (t) => {
  const root = fixture(t, [task(2, { priority: 'low', blockers: [1] }), task(1, { priority: 'high' })]);
  assert.equal(refreshSearchIndex(root), true);
  const api = await serve(t, root);
  const query = { fields: ['id'], sort: 'priority', descending: true };
  assert.deepEqual((await api('/tasks?fields=id&sort=priority&desc=true')).data, listTasks(root, query));
  assert.deepEqual((await api('/tasks?count=true')).data, { count: 2 });
  assert.deepEqual((await api('/tasks/2?fields=id,blockers')).data, getTask(root, 2, { fields: ['id', 'blockers'] }));
  assert.deepEqual((await api('/tasks/2/blockers?depth=2')).data, inspectBlockers(root, 2, { depth: 2 }));
});

test('HTTP no-cache forces JSON for every task-data route without SQLite access', async (t) => {
  const root = fixture(t, [task(2, { blockers: [1], scope: 'JSON needle' }), task(1)], {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    search: { mode: 'indexed' },
  });
  assert.equal(refreshSearchIndex(root), true);
  const api = await serve(t, root);
  const DatabaseSync = databaseSync();
  let sqliteCalls = 0;
  for (const method of ['exec', 'prepare']) t.mock.method(DatabaseSync.prototype, method, () => {
    sqliteCalls++;
    throw new Error('SQLite cache must not be touched');
  });
  try {
    assert.deepEqual((await api('/tasks?fields=id&no-cache=true')).data.tasks, [{ id: 1 }, { id: 2 }]);
    assert.deepEqual((await api('/tasks?count=true&no-cache=true')).data, { count: 2 });
    assert.equal((await api('/tasks/2?no-cache=true')).data.scope, 'JSON needle');
    assert.deepEqual((await api('/tasks/batch?ids=2,1&fields=id&no-cache=true')).data.tasks, [{ id: 2 }, { id: 1 }]);
    assert.deepEqual((await api('/tasks/search?query=needle&fields=id&no-cache=true')).data.tasks.map(({ id }) => id), [2]);
    assert.deepEqual((await api('/tasks/2/blockers?no-cache=true')).data.activeBlockers, [1]);
    assert.equal(sqliteCalls, 0);
  } finally {
    t.mock.restoreAll();
  }
  await expectError(api('/tasks?no-cache=yes'), 400, 'INVALID_INPUT');
});

test('HTTP reports unavailable cache acceleration without failing task data', (t) => {
  const root = fixture(t, [task(1)]);
  const preload = join(root, 'sqlite-unavailable.mjs');
  writeFileSync(preload, `import { DatabaseSync } from 'node:sqlite';\nconst exec = DatabaseSync.prototype.exec;\nDatabaseSync.prototype.exec = function(sql) { if (sql === 'SELECT 1') throw new Error('unavailable for test'); return exec.call(this, sql); };\n`);
  const module = new URL('../http.mjs', import.meta.url).href;
  const source = `import { createHttpServer } from ${JSON.stringify(module)};\nconst server = createHttpServer(${JSON.stringify(root)}, { token: ${JSON.stringify(token)} });\nawait new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));\nconst response = await fetch('http://127.0.0.1:' + server.address().port + '/tasks/1', { headers: { Authorization: ${JSON.stringify(authorization)} } });\nconst body = await response.json();\nprocess.stdout.write(JSON.stringify({ status: response.status, warning: response.headers.get('warning'), body }));\nawait new Promise((resolve) => server.close(resolve));\n`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import=${preload}` }, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.status, 200);
  assert.equal(observed.body.id, 1);
  assert.match(observed.warning, /199 task-tracker "CACHE_UNAVAILABLE: SQLite cache acceleration is unavailable/);
});

test('HTTP indexed search and batch report an unusable cache root exactly once', (t) => {
  const root = fixture(t, [task(1, { scope: 'JSON result' })], {
    stores: { 'active.json': { statuses: ['pending'] } }, search: { mode: 'indexed' },
  });
  const blocked = join(root, 'cache-root');
  writeFileSync(blocked, 'not a directory');
  const config = join(root, 'program.json');
  writeFileSync(config, JSON.stringify({ slow_query_ms: 0 }));
  const module = new URL('../http.mjs', import.meta.url).href;
  const source = `import { createHttpServer } from ${JSON.stringify(module)};\n`
    + `const server = createHttpServer(${JSON.stringify(root)}, { token: ${JSON.stringify(token)}, config: ${JSON.stringify(config)} });\n`
    + `await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));\n`
    + `const read = async (path) => { const response = await fetch('http://127.0.0.1:' + server.address().port + path, { headers: { Authorization: ${JSON.stringify(authorization)} } }); return { status: response.status, warning: response.headers.get('warning'), body: await response.json() }; };\n`
    + `process.stdout.write(JSON.stringify({ search: await read('/tasks/search?query=result'), batch: await read('/tasks/batch?ids=1&fields=id') }));\n`
    + `await new Promise((resolve) => server.close(resolve));\n`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: blocked }, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  const warning = '199 task-tracker "CACHE_UNAVAILABLE: SQLite cache acceleration is unavailable; authoritative JSON was used."';
  assert.equal(observed.search.status, 200);
  assert.deepEqual(observed.search.body.tasks.map(({ id }) => id), [1]);
  assert.equal(observed.search.warning, warning);
  assert.match(observed.search.body.advisories[0].message, /cache acceleration was unavailable/);
  assert.doesNotMatch(observed.search.body.advisories[0].message, /refresh/i);
  assert.equal(observed.batch.status, 200);
  assert.deepEqual(observed.batch.body.tasks, [{ id: 1 }]);
  assert.equal(observed.batch.warning, warning);
  assert.equal(readFileSync(blocked, 'utf8'), 'not a directory');
});

test('HTTP search and batch preserve shared projections, selections and cursor pages', async (t) => {
  const root = fixture(t, [task(1, { scope: 'Release plan' }), task(2, { title: 'Release notes' })]);
  const api = await serve(t, root);
  const query = '/tasks/search?query=release&search-fields=title,%20scope&fields=id,title&limit=1';
  const first = await api(query);
  assert.equal(first.status, 200);
  assert.deepEqual(first.data, searchTasks(root, 'release', { searchFields: ['title', 'scope'], fields: ['id', 'title'], limit: 1 }));
  const cli = run('search-tasks', [root, 'release', '--search-fields', 'title,scope', '--fields', 'id,title', '--limit', '1', '--format', 'json']);
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(first.data, JSON.parse(cli.stdout));
  assert.equal(first.data.hasMore, true);
  const second = await api(`${query}&cursor=${encodeURIComponent(first.data.next_cursor)}`);
  assert.deepEqual(second.data.tasks.map(({ id }) => id), [2]);
  assert.equal(second.data.hasMore, false);
  await expectError(api(`${query.replace('release', 'other')}&cursor=${encodeURIComponent(first.data.next_cursor)}`), 400, 'INVALID_CURSOR');
  assert.deepEqual((await api('/tasks/search?query=task&group=Done&fields=id')).data.tasks.map(({ id }) => id), [99]);
  assert.equal((await api('/tasks/search?query=absent')).data.tasks.length, 0);

  const batchQuery = '/tasks/batch?ids=2,99,1&limit=2';
  const page = await api(batchQuery);
  assert.equal(page.status, 200);
  assert.deepEqual(page.data, getTasks(root, [2, 99, 1], { limit: 2 }));
  const batchCli = run('get-tasks', [root, '--id', '2', '--id', '99', '--id', '1', '--limit', '2', '--format', 'json']);
  assert.equal(batchCli.status, 0, batchCli.stderr);
  assert.deepEqual(page.data, JSON.parse(batchCli.stdout));
  assert.deepEqual(page.data.not_found, [99]);
  assert.deepEqual((await api(`${batchQuery}&cursor=${encodeURIComponent(page.data.next_cursor)}`)).data.tasks.map(({ id }) => id), [1]);
  await expectError(api(`${batchQuery.replace('2,99,1', '1,99,2')}&cursor=${encodeURIComponent(page.data.next_cursor)}`), 400, 'INVALID_CURSOR');
  assert.deepEqual((await api('/tasks/batch?ids=99,2,1&store=active&store=done&fields=id')).data.tasks, [{ id: 99 }, { id: 2 }, { id: 1 }]);
  writeStore(root, 'active.json', [task(1, { title: 'Edited release' })]);
  assert.equal((await api('/tasks/search?query=edited')).data.tasks[0].title, 'Edited release');
  assert.equal((await api('/tasks/batch?ids=1')).data.tasks[0].title, 'Edited release');
});

test('new HTTP reads validate queries and retain authentication, CORS and one-project isolation', async (t) => {
  const root = fixture(t, [task(1)]);
  const outside = fixture(t, [task(200, { title: 'Outside secret' })]);
  rmSync(join(root, 'tasks/.task-tracker.json'));
  const api = await serve(t, root, ['https://ui.example']);
  const before = snapshot(root);
  const outsideBefore = snapshot(outside);
  for (const route of ['/tasks/search?query=outside', '/tasks/batch?ids=200']) {
    await expectError(api(route, 'GET', undefined, { Authorization: '' }), 401, 'UNAUTHORIZED');
    await expectError(api(route, 'GET', undefined, { Origin: 'https://evil.example' }), 403, 'ACCESS_DENIED');
    await expectError(api(route, 'POST'), 405, 'METHOD_NOT_ALLOWED');
    await expectError(api(route, 'GET', {}), 400, 'INVALID_INPUT');
    const preflight = await api(route, 'OPTIONS', undefined, { Authorization: '', Origin: 'https://ui.example', 'Access-Control-Request-Method': 'GET' });
    assert.equal(preflight.status, 204);
    for (const selector of ['project', 'project_path', 'project-path', 'config', 'schema_path', 'schema-path', 'registry']) {
      await expectError(api(`${route}&${selector}=${encodeURIComponent(outside)}`), 400, 'INVALID_INPUT');
    }
    for (const suffix of ['limit=51', 'limit=1&limit=2', 'fields=id,', 'store=active&group=Done', 'store=../../outside', 'unknown=true']) {
      await expectError(api(`${route}&${suffix}`), 400, 'INVALID_INPUT');
    }
  }
  for (const route of ['/tasks/search', '/tasks/search?query=', '/tasks/search?query=a&query=b', '/tasks/search?query=a&search-fields=title,', '/tasks/batch', '/tasks/batch?ids=', '/tasks/batch?ids=1,1', '/tasks/batch?ids=0', '/tasks/batch?ids=9007199254740992', '/tasks/batch?ids=1&ids=2']) {
    await expectError(api(route), 400, 'INVALID_INPUT');
  }
  assert.deepEqual(snapshot(root), before);
  assert.equal((await api('/tasks/search?query=outside')).data.tasks.length, 0);
  assert.deepEqual((await api('/tasks/batch?ids=200')).data.not_found, [200]);
  assert.deepEqual(snapshot(outside), outsideBefore);
  for (const route of ['/tasks/search?query=task', '/tasks/batch?ids=1']) {
    await expectError(api(`${route}&cursor=invalid`), 400, 'INVALID_CURSOR');
  }
  symlinkSync(join(outside, 'tasks/active.json'), join(root, 'tasks/escape.json'));
  for (const route of ['/tasks/search?query=task', '/tasks/batch?ids=1']) {
    await expectError(api(route), 403, 'ACCESS_DENIED');
  }
});

test('HTTP search and batch preserve cache fallback, advisories and output budgets', async (t) => {
  const stores = { 'active.json': { statuses: ['pending'] } };
  const root = fixture(t, [task(1)], { stores, search: { mode: 'indexed' } });
  const config = join(root, 'program.json');
  writeFileSync(config, JSON.stringify({ slow_query_ms: 0 }));
  const api = await serve(t, root, [], { config });
  const fallback = await api('/tasks/search?query=task');
  assert.equal(fallback.status, 200);
  assert.deepEqual(fallback.data.tasks.map(({ id }) => id), [1]);
  assert.match(fallback.headers.warning, /CACHE_FALLBACK/);
  assert.equal((await api('/tasks/batch?ids=1')).status, 200);
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({ stores, search: { mode: 'scan' } }));
  const page = await api('/tasks/search?query=task');
  assert.equal(page.status, 200);
  assert.equal(page.data.advisories[0].code, 'SLOW_SCAN');
  assert.ok(page.data.advisories[0].elapsed_ms > 0);
  writeStore(root, 'active.json', [task(1, { text: 'x'.repeat(responseBytes) })]);
  for (const route of ['/tasks/search?query=task', '/tasks/batch?ids=1']) {
    await expectError(api(`${route}&fields=all`), 400, 'OUTPUT_TOO_LARGE');
    assert.equal((await api(`${route}&fields=id`)).status, 200);
  }
  writeStore(root, 'active.json', [task(1, { text: 'x'.repeat(18000) }), task(2, { text: 'y'.repeat(18000) })]);
  for (const route of ['/tasks/search?query=task&fields=all', '/tasks/batch?ids=1,2&fields=all']) {
    const first = await api(route);
    assert.equal(first.data.tasks.length, 1);
    assert.equal(first.data.hasMore, true);
    const second = await api(`${route}&cursor=${encodeURIComponent(first.data.next_cursor)}`);
    assert.equal(second.data.tasks[0].id, 2);
    assert.equal(second.data.hasMore, false);
  }
});

test('HTTP first-read service preparation shares the project writer lock', async (t) => {
  const root = fixture(t, [task(1)]);
  rmSync(join(root, 'tasks/.task-tracker.json'));
  const api = await serve(t, root);
  const lock = new (databaseSync())(projectLockPath(root));
  try {
    lock.exec('BEGIN EXCLUSIVE');
    const blocked = await api('/tasks');
    assert.equal(blocked.data.error.code, 'PROJECT_BUSY');
    assert.deepEqual(Object.keys(snapshot(root)).sort(), ['active.json', 'done.json']);
  } finally { lock.close(); }
  assert.equal((await api('/tasks')).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.json'))), {});
});

test('authenticated HTTP reads share CLI semantics and see external edits', async (t) => {
  const root = fixture(t, [task(1, { blockers: [2], extension: { retained: true } }), task(2)]);
  const api = await serve(t, root);
  assert.deepEqual((await api('/schema')).data, JSON.parse(run('schema', [root]).stdout));
  await expectError(api('/schema', 'POST'), 405, 'METHOD_NOT_ALLOWED');
  await expectError(api('/schema?write=true'), 400, 'INVALID_INPUT');
  assert.deepEqual((await api('/tasks')).data, JSON.parse(run('list-tasks', [root, '--format', 'json']).stdout));
  assert.deepEqual((await api('/tasks?count=true')).data, { count: 2 });
  assert.deepEqual((await api('/tasks/1/blockers')).data, JSON.parse(run('inspect-blockers', [root, '1', '--format', 'json']).stdout));
  assert.deepEqual((await api('/tasks/1')).data, JSON.parse(run('get-task', [root, '1', '--format', 'json']).stdout));
  const first = (await api('/tasks?limit=1')).data;
  assert.equal(first.hasMore, true);
  assert.equal((await api(`/tasks?limit=1&offset=${first.nextOffset}`)).data.tasks[0].id, 2);
  assert.equal(run('update-task', [root, '1', '--json', '{"set":{"title":"CLI changed"}}']).status, 0);
  assert.equal((await api('/tasks/1')).data.title, 'CLI changed');
  const records = JSON.parse(readFileSync(join(root, 'tasks/active.json')));
  records[0].title = 'Manual change';
  writeStore(root, 'active.json', records);
  assert.equal((await api('/tasks/1')).data.title, 'Manual change');
  await expectError(api('/tasks/99'), 404, 'TASK_NOT_FOUND');
  assert.equal((await api('/tasks/99?store=all')).data.status, 'done');
});

test('HTTP field and store lists match CLI whitespace and empty-name handling', async (t) => {
  const root = fixture(t, [task(1)]);
  const api = await serve(t, root);
  const cli = run('list-tasks', [root, '--fields', 'id, title', '--store', 'active, done', '--format', 'json']);
  assert.equal(cli.status, 0, cli.stderr);
  const selected = await api('/tasks?fields=id,%20title&store=active,%20done');
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.data, JSON.parse(cli.stdout));
  assert.deepEqual((await api('/tasks?fields=id,%20title&store=%20active%20&store=%20done%20')).data, selected.data);
  assert.deepEqual((await api('/tasks/1?fields=id,%20title&store=%20active%20')).data, { id: 1, title: 'Task 1' });
  for (const query of ['fields=id,%20', 'store=active,%20']) {
    await expectError(api(`/tasks?${query}`), 400, 'INVALID_INPUT');
  }
});

test('authentication, rejected writes and CORS do not touch project files', async (t) => {
  const root = fixture(t, [task(1)]);
  rmSync(join(root, 'tasks/.task-tracker.json'));
  const api = await serve(t, root, ['https://ui.example']);
  const before = snapshot(root);
  await expectError(api('/tasks', 'GET', undefined, { Authorization: '', Origin: 'https://evil.example' }), 401, 'UNAUTHORIZED');
  for (const Authorization of ['', 'Bearer wrong', `Bearer ${'z'.repeat(48)}`, `Basic ${token}`]) {
    const result = await api('/tasks', 'GET', undefined, { Authorization });
    assert.equal(result.status, 401);
    assert.equal(result.headers['www-authenticate'], 'Bearer realm="tasks"');
    assert.ok(!JSON.stringify(result).includes(token));
  }
  for (const [path, method, status, code] of [
    ['/tasks', 'POST', 405, 'METHOD_NOT_ALLOWED'], ['/tasks/1', 'PATCH', 405, 'METHOD_NOT_ALLOWED'],
    ['/tasks/1', 'DELETE', 405, 'METHOD_NOT_ALLOWED'], ['/tasks/1/transition', 'POST', 404, 'NOT_FOUND'],
    ['/validate', 'POST', 404, 'NOT_FOUND'],
  ]) await expectError(api(path, method, {}), status, code);
  await expectError(api('/tasks', 'GET', undefined, { Origin: 'https://ui.example.evil' }), 403, 'ACCESS_DENIED');
  for (const headers of [
    { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    { Origin: 'https://ui.example', 'Access-Control-Request-Method': 'POST' },
    { Origin: 'https://ui.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-Custom' },
    {},
  ]) await expectError(api('/tasks', 'OPTIONS', undefined, { Authorization: '', ...headers }), 403, 'ACCESS_DENIED');
  const preflight = await api('/tasks', 'OPTIONS', undefined, { Authorization: '', Origin: 'https://ui.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.data, null);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://ui.example');
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET');
  assert.equal(preflight.headers['access-control-allow-headers'], 'Authorization');
  assert.deepEqual(snapshot(root), before);
  const proxy = await api('/tasks', 'GET', undefined, { Host: 'tasks.example', Origin: 'https://ui.example', 'Sec-Fetch-Site': 'cross-site', 'X-Forwarded-Proto': 'https' });
  assert.equal(proxy.status, 200);
  assert.equal(proxy.headers['access-control-allow-origin'], 'https://ui.example');
  assert.equal(proxy.headers.vary, 'Origin');
  await expectError(api('/tasks', 'GET', undefined, { Authorization: '', Origin: 'https://ui.example' }), 401, 'UNAUTHORIZED');
});

test('HTTP rejects arbitrary selectors, traversal and malformed read inputs', async (t) => {
  const api = await serve(t, fixture(t, [task(1)]));
  for (const query of ['project_path=/tmp', 'project=other', 'config=/tmp/config', 'store=../../outside', 'limit=1&limit=2', 'count=1', 'filters=null&status=pending', 'limit=51']) {
    await expectError(api(`/tasks?${query}`), 400, 'INVALID_INPUT');
  }
  await expectError(api('/tasks', 'GET', undefined, { Origin: 'https://example.com' }), 403, 'ACCESS_DENIED');
  await expectError(api('/tasks', 'GET', {}), 400, 'INVALID_INPUT');
  await expectError(api('/unknown'), 404, 'NOT_FOUND');
});

test('each request rejects links in stores, metadata, schema and directories before accessing targets', async (t) => {
  const root = fixture(t, [task(1)]);
  const outside = fixture(t, [task(200)]);
  const api = await serve(t, root);
  const target = join(outside, 'tasks/active.json');
  const original = readFileSync(target);
  for (const relative of ['tasks/escape.json', 'tasks/.task-tracker.pending', 'tasks/.task-tracker.json', 'tasks/task-schema.json']) {
    const path = join(root, relative);
    rmSync(path, { force: true });
    symlinkSync(target, path);
    await expectError(api('/tasks'), 403, 'ACCESS_DENIED');
    assert.deepEqual(readFileSync(target), original);
    rmSync(path);
  }
  linkSync(target, join(root, 'tasks/hardlink.json'));
  await expectError(api('/tasks'), 403, 'ACCESS_DENIED');
  rmSync(join(root, 'tasks/hardlink.json'));
  rmSync(join(root, 'tasks'), { recursive: true });
  symlinkSync(join(outside, 'tasks'), join(root, 'tasks'));
  await expectError(api('/tasks'), 403, 'ACCESS_DENIED');
});

test('HTTP defaults stay compact and oversized details remain bounded', async (t) => {
  const root = fixture(t);
  const api = await serve(t, root);
  const page = (await api('/tasks')).data;
  assert.equal(page.tasks.length, 10);
  assert.deepEqual(Object.keys(page.tasks[0]), ['id', 'title', 'status']);
  writeStore(root, 'active.json', [task(1, { text: 'x'.repeat(responseBytes) })]);
  await expectError(api('/tasks/1'), 400, 'OUTPUT_TOO_LARGE');
  assert.equal((await api('/tasks/1?fields=id,title')).status, 200);
});

async function startProcess(t, args, root, readToken = token) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, TASKS_HTTP_TOKEN: readToken } });
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
  }
  t.after(stop);
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [chunk] = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(stderr); })]);
  const url = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(url, chunk.toString());
  assert.ok(!chunk.toString().includes(readToken));
  return { url, stop };
}

test('public process startup and restart rotate the fixed-project read token', async (t) => {
  const root = fixture(t, [task(1)]);
  const executable = fileURLToPath(new URL('../bin/tasks', import.meta.url));
  const server = await startProcess(t, [executable, 'http', '--project-path', root, '--port', '0'], root);
  assert.equal((await fetch(`${server.url}/tasks`)).status, 401);
  assert.equal((await fetch(`${server.url}/tasks`, { headers: { authorization } })).status, 200);
  await server.stop();
  const replacement = 'replacement_read_token_'.repeat(3);
  const restarted = await startProcess(t, [fileURLToPath(new URL('../http.mjs', import.meta.url)), root, '--port', new URL(server.url).port], root, replacement);
  assert.equal(restarted.url, server.url);
  assert.equal((await fetch(`${restarted.url}/tasks`, { headers: { authorization } })).status, 401);
  assert.equal((await fetch(`${restarted.url}/tasks`, { headers: { authorization: `Bearer ${replacement}` } })).status, 200);
  await restarted.stop();
  assert.equal(run('list-tasks', [root, '--format', 'json']).status, 0);
});

test('startup rejects invalid secret/origin configuration without disclosing it', (t) => {
  const root = fixture(t, [task(1)]);
  const before = snapshot(root);
  for (const secret of [undefined, '', 'short', 'unsafe!'.repeat(10), 'x'.repeat(513)]) {
    assert.throws(() => createHttpServer(root, { token: secret ?? '' }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      if (secret) assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  for (const origin of ['*', 'null', 'https://ui.example/', 'https://user@ui.example', 'https://ui.example/path']) {
    assert.throws(() => createHttpServer(root, { token, origins: [origin] }), { code: 'INVALID_INPUT' });
  }
  assert.throws(() => createHttpServer(root, { token, schemaPath: 'missing.json' }), { code: 'READ_ERROR' });
  assert.throws(() => createHttpServer(root, { token, schemaPath: '../outside.json' }), { code: 'INVALID_INPUT' });
  const result = run('../http', [root], { env: { ...process.env, TASKS_HTTP_TOKEN: '' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TASKS_HTTP_TOKEN/);
  assert.deepEqual(snapshot(root), before);
});

test('HTTP public selectors retain cwd, positional and configured project selection', async (t) => {
  const root = fixture(t, [task(1, { title: 'Current' })]);
  const selected = fixture(t, [task(1, { title: 'Selected' })]);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config/schema.json'), JSON.stringify({ stores: { 'active.json': { statuses: ['pending'] } } }));
  const config = join(root, 'registry.json');
  writeFileSync(config, JSON.stringify({ projects: { example: selected }, slow_query_ms: 0 }));
  const executable = fileURLToPath(new URL('../bin/tasks', import.meta.url));
  for (const [args, title] of [
    [[], 'Current'], [[selected], 'Selected'],
    [['--project', 'example', '--config', config], 'Selected'],
    [['--schema-path', 'config/schema.json'], 'Current'],
  ]) {
    const server = await startProcess(t, [executable, 'http', ...args, '--port', '0', '--allow-origin', 'https://ui.example', '--allow-origin', 'http://localhost:3000'], root);
    const response = await fetch(`${server.url}/tasks/1`, { headers: { authorization, Origin: 'http://localhost:3000' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, title);
    const search = await fetch(`${server.url}/tasks/search?query=${title}`, { headers: { authorization } });
    assert.equal(search.status, 200);
    const page = await search.json();
    assert.equal(page.tasks[0].title, title);
    if (args.includes('--config')) assert.equal(page.advisories[0].code, 'SLOW_SCAN');
    const batch = await fetch(`${server.url}/tasks/batch?ids=1`, { headers: { authorization } });
    assert.equal(batch.status, 200);
    assert.equal((await batch.json()).tasks[0].title, title);
    await server.stop();
  }
});
