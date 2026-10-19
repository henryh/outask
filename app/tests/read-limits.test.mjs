import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, mkdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { inputBytes, projectBytes, responseBytes } from '../src/limits.mjs';
import { jsonBytes } from '../src/response.mjs';
import { countTasks, getTask, listTasks } from '../src/tasks.mjs';
import { detail, fixture, list, run, snapshot, task, writeStore } from './fixtures.mjs';

function bounded(result) {
  assert.ok(Buffer.byteLength(result.stdout + result.stderr, 'utf8') <= responseBytes);
}

function rejected(result, code, guidance) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(code));
  if (guidance) assert.match(result.stderr, guidance);
  bounded(result);
}

function continuePage(result, cwd) {
  const command = result.stderr.split('Next page: ')[1]?.trimEnd();
  assert.ok(command, result.stderr);
  const next = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 10000 });
  assert.ifError(next.error);
  assert.equal(next.status, 0, next.stderr);
  bounded(next);
  return next;
}

test('page limits are mandatory in reusable operations and both list/count script paths', (context) => {
  const root = fixture(context, Array.from({ length: 51 }, (_, index) => task(index + 1)));
  const before = snapshot(root);
  assert.equal(listTasks(root).tasks.length, 10);
  assert.equal(listTasks(root, { limit: 50 }).tasks.length, 50);
  const final = listTasks(root, { offset: 50, limit: 50 });
  assert.deepEqual(final.tasks.map(({ id }) => id), [51]);
  assert.equal(final.hasMore, false);
  assert.equal(final.nextOffset, null);
  for (const limit of [0, -1, 51, 100, Number.MAX_SAFE_INTEGER, 1.5, '10']) {
    assert.throws(() => listTasks(root, { limit }), { code: 'INVALID_INPUT' });
    assert.throws(() => countTasks(root, { limit }), { code: 'INVALID_INPUT' });
  }
  for (const limit of ['0', '51', '100', '999999999999999999999']) {
    for (const count of [[], ['--count']]) {
      rejected(run('list-tasks', [root, '--limit', limit, ...count]), 'INVALID_INPUT', /1 to 50/);
    }
  }
  for (const name of ['list-tasks', 'get-task']) {
    assert.doesNotMatch(run(name, ['--help']).stdout, /unlimited|--limit 0|requests all/);
  }
  assert.deepEqual(snapshot(root), before);
});

test('escaped and multibyte JSON pages retain complete values and continue without missing records', (context) => {
  const field = 'details "\\\n😀';
  const value = '"\\\n\t\u0000é😀\ud800'.repeat(350);
  const records = Array.from({ length: 12 }, (_, index) => task(index + 1, { [field]: { value, nested: [false, null, 3.5] } }));
  const root = fixture(context, records);
  const before = snapshot(root);
  const ids = [];
  let offset = 0;
  do {
    const page = listTasks(root, { fields: ['all'], limit: 50, offset });
    const result = list(root, '--fields', 'all', '--limit', '50', '--offset', String(offset), '--format', 'json');
    bounded(result);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), page);
    assert.equal(jsonBytes(page), Buffer.byteLength(JSON.stringify(page, null, 2)));
    assert.ok(page.tasks.length > 0 && page.tasks.length < records.length);
    for (const record of page.tasks) assert.deepEqual(record, records[record.id - 1]);
    ids.push(...page.tasks.map(({ id }) => id));
    if (page.hasMore) assert.equal(page.nextOffset, offset + page.tasks.length);
    else assert.equal(page.nextOffset, null);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(ids, records.map(({ id }) => id));
  assert.deepEqual(snapshot(root), before);
});

test('the exact JSON response boundary includes newlines and list metadata', (context) => {
  const root = fixture(context, [task(1, { scope: '' })]);
  const empty = { id: 1, scope: '' };
  const overhead = Buffer.byteLength(`${JSON.stringify(empty, null, 2)}\n`);
  const room = responseBytes - overhead;
  const value = 'é'.repeat(Math.floor(room / 2)) + (room % 2 ? 'x' : '');
  writeStore(root, 'active.json', [task(1, { scope: value })]);
  assert.deepEqual(getTask(root, 1, { fields: ['id', 'scope'] }), { id: 1, scope: value });
  assert.equal(Buffer.byteLength(detail(root, 1, '--fields', 'id,scope', '--format', 'json').stdout), responseBytes);
  assert.throws(() => listTasks(root, { fields: ['id', 'scope'] }), { code: 'OUTPUT_TOO_LARGE' });
  writeStore(root, 'active.json', [task(1, { scope: `${value}x` })]);
  assert.throws(() => getTask(root, 1, { fields: ['id', 'scope'] }), { code: 'OUTPUT_TOO_LARGE' });

  writeStore(root, 'active.json', [task(1, { scope: '' })]);
  const page = listTasks(root, { fields: ['id', 'scope'] });
  const pageRoom = responseBytes - Buffer.byteLength(`${JSON.stringify(page, null, 2)}\n`);
  writeStore(root, 'active.json', [task(1, { scope: 'x'.repeat(pageRoom) })]);
  assert.equal(Buffer.byteLength(list(root, '--fields', 'id,scope', '--format', 'json').stdout), responseBytes);
  writeStore(root, 'active.json', [task(1, { scope: 'x'.repeat(pageRoom + 1) })]);
  rejected(run('list-tasks', [root, '--fields', 'id,scope', '--format', 'json']), 'OUTPUT_TOO_LARGE', /--fields/);
});

test('oversized records fail in every full-record format while narrow projections and scalar counts work', (context) => {
  const root = fixture(context, [task(1, { scope: 'é'.repeat(responseBytes) })]);
  const before = snapshot(root);
  assert.throws(() => getTask(root, 1), { code: 'OUTPUT_TOO_LARGE' });
  assert.throws(() => listTasks(root, { fields: ['all'], maxOutputBytes: inputBytes }), { code: 'OUTPUT_TOO_LARGE' });
  assert.equal(countTasks(root, { fields: ['all'] }), 1);
  assert.deepEqual(getTask(root, 1, { fields: ['id', 'title'] }), { id: 1, title: 'Task 1' });
  for (const format of ['json', 'text', 'table']) {
    rejected(run('list-tasks', [root, '--fields', 'all', '--format', format]), 'OUTPUT_TOO_LARGE', /--fields/);
    rejected(run('get-task', [root, '1', '--format', format]), 'OUTPUT_TOO_LARGE', /--fields/);
    bounded(list(root, '--fields', 'id,title', '--format', format));
    assert.equal(list(root, '--fields', 'all', '--count', '--format', format).stdout, '1\n');
  }
  assert.equal(list(root, '--fields', 'all', '--format', 'ids').stdout, '1\n');
  rejected(run('list-tasks', [root, '--full']), 'OUTPUT_TOO_LARGE', /--fields/);
  assert.equal(detail(root, 1, '--fields', 'all', '--format', 'ids').stdout, '1\n');
  assert.deepEqual(snapshot(root), before);
});

test('a large later record is left for the next page and never silently skipped', (context) => {
  const records = [task(1), task(2, { scope: 'x'.repeat(responseBytes) }), task(3)];
  const root = fixture(context, records);
  const page = listTasks(root, { fields: ['all'] });
  assert.deepEqual(page.tasks, [records[0]]);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 1);
  assert.throws(() => listTasks(root, { fields: ['all'], offset: page.nextOffset }), { code: 'OUTPUT_TOO_LARGE' });
  assert.deepEqual(listTasks(root, { fields: ['id'], offset: page.nextOffset }).tasks, [{ id: 2 }, { id: 3 }]);
});

test('field metadata and deep values fail before large JSON serialisation', (context) => {
  const root = fixture(context, [task(1, { ['field'.repeat(9000)]: 0 })]);
  assert.throws(() => listTasks(root, { fields: ['all'] }), { code: 'OUTPUT_TOO_LARGE' });
  assert.equal(countTasks(root, { fields: ['all'] }), 1);
  assert.deepEqual(getTask(root, 1, { fields: ['id'] }), { id: 1 });
  const deep = `${'['.repeat(20000)}0${']'.repeat(20000)}`;
  writeFileSync(join(root, 'tasks/active.json'), `[{"id":1,"title":"Deep","status":"pending","details":${deep}}]`);
  assert.throws(() => getTask(root, 1), { code: 'OUTPUT_TOO_LARGE' });
  rejected(run('get-task', [root, '1']), 'OUTPUT_TOO_LARGE', /--fields/);
  assert.equal(countTasks(root), 1);
  assert.equal(detail(root, 1, '--format', 'ids').stdout, '1\n');
});

test('table padding and text field expansion shorten pages using the actual displayed count', { skip: process.platform === 'win32' }, (context) => {
  const records = Array.from({ length: 50 }, (_, index) => task(index + 1, {
    a: index === 0 ? 'a'.repeat(1000) : '', b: index === 1 ? 'b'.repeat(1000) : '',
  }));
  const root = fixture(context, records);
  assert.equal(listTasks(root, { limit: 50, fields: ['id', 'a', 'b'] }).tasks.length, 50);
  const table = list(root, '--limit', '50', '--fields', 'id,a,b', '--format', 'table', '--max-width', '1000');
  bounded(table);
  const shown = Number(table.stderr.match(/records 1-(\d+)/)[1]);
  assert.ok(shown > 1 && shown < 50);
  assert.equal(table.stdout.trimEnd().split('\n').length, shown + 1);
  const next = continuePage(table);
  assert.match(next.stderr, new RegExp(`records ${shown + 1}-`));

  const field = 'wide'.repeat(3000);
  writeStore(root, 'active.json', Array.from({ length: 50 }, (_, index) => task(index + 1, index === 0 ? { [field]: 'value' } : {})));
  const text = list(root, '--limit', '50', '--fields', 'all', '--format', 'text');
  bounded(text);
  assert.match(text.stderr, /records 1-2 of 50/);
  assert.match(continuePage(text).stderr, /records 3-/);
});

test('a single padded table that cannot fit produces no partial stdout', (context) => {
  const fields = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`field${index}`, 'x'.repeat(1500)]));
  const root = fixture(context, [task(1, fields)]);
  assert.deepEqual(getTask(root, 1), task(1, fields));
  for (const [name, args] of [['list-tasks', [root, '--fields', 'all']], ['get-task', [root, '1']]]) {
    rejected(run(name, [...args, '--format', 'table', '--max-width', '1500']), 'OUTPUT_TOO_LARGE', /--fields/);
    const small = run(name, [...args, '--format', 'table', '--max-width', '60']);
    assert.equal(small.status, 0, small.stderr);
    bounded(small);
  }
});

test('copied continuation commands use portable paths, preserve every query argument and shell quote data safely', { skip: process.platform === 'win32' }, (context) => {
  const root = fixture(context, []);
  const tracker = join(root, "-tracker ' $(touch script-injected) `touch script-other`");
  symlinkSync(new URL('../', import.meta.url), tracker, 'dir');
  const project = join(root, "project ' $(touch injected) `touch other`");
  mkdirSync(join(project, 'tasks'), { recursive: true });
  const needle = "quoted ' $(touch filtered) `touch another`";
  writeStore(project, 'active.json', [task(1, { priority: 'low', note: needle }), task(2, { note: needle }), task(3, { priority: 'high', note: needle })]);
  writeStore(project, 'done.json', []);
  const flags = ['--store', 'active', '--store=done', '--where', `note=${needle}`, '--where=status=pending',
    '--id=1', '--id', '2', '--id=3', '--sort', 'priority', '--desc', '--fields', 'id,title,note',
    '--format', 'text', '--max-width', '13', '--limit', '1'];
  const first = spawnSync(process.execPath, [join(tracker, 'scripts/list-tasks.mjs'), project, ...flags, '--offset=0', '--offset', '0'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(first.error);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /Next page: node '\.\/-tracker /);
  bounded(first);
  const next = continuePage(first, root);
  assert.equal(next.stdout, list(project, ...flags, '--offset', '1').stdout);
  assert.match(next.stdout, /^id: 2\n/);
  assert.match(next.stderr, /--store=done/);
  for (const name of ['injected', 'other', 'filtered', 'another', 'script-injected', 'script-other']) assert.equal(existsSync(join(root, name)), false);

  const terminated = run('list-tasks', [...flags, '--', project], { cwd: root });
  assert.equal(terminated.status, 0, terminated.stderr);
  assert.equal(continuePage(terminated, root).stdout, next.stdout);

  const defaulted = run('list-tasks', flags, { cwd: project });
  assert.equal(defaulted.status, 0, defaulted.stderr);
  assert.equal(continuePage(defaulted, project).stdout, next.stdout);
});

test('overlong page guidance and error diagnostics remain bounded', (context) => {
  const value = "'".repeat(9000);
  const root = fixture(context, [task(1, { scope: value }), task(2, { scope: value })]);
  rejected(run('list-tasks', [root, '--where', `scope=${value}`, '--limit', '1']), 'OUTPUT_TOO_LARGE', /shorten/);
  assert.equal(list(root, '--where', `scope=${value}`, '--limit', '1', '--format', 'json').stderr, '');
  rejected(run('list-tasks', [root, `--${'x'.repeat(50000)}`]), 'INVALID_INPUT');
});

test('project input accounting includes configuration and only the selected stores', (context) => {
  const root = fixture(context, [task(1, { scope: 'x'.repeat(projectBytes / 2) })], {
    stores: { 'active.json': { statuses: ['pending'] } }, padding: 'x'.repeat(projectBytes / 2),
  });
  const path = join(root, 'tasks/active.json');
  const size = statSync(path).size;
  assert.ok(size < projectBytes);
  assert.throws(() => listTasks(root), { code: 'INPUT_TOO_LARGE' });
  rejected(run('get-task', [root, '1', '--fields', 'id']), 'INPUT_TOO_LARGE', /active.json.*fewer stores/);
  rmSync(join(root, 'docs/task-schema.json'));
  assert.deepEqual(getTask(root, 1, { fields: ['id'] }), { id: 1 });
  truncateSync(join(root, 'tasks/done.json'), projectBytes + 1);
  assert.equal(countTasks(root), 1);
  assert.throws(() => listTasks(root, { stores: ['all'] }), { code: 'INPUT_TOO_LARGE' });
  assert.equal(statSync(path).size, size);
  writeFileSync(join(root, 'docs/task-schema.json'), 'x'.repeat(projectBytes + 1));
  rejected(run('list-tasks', [root, '--count']), 'INPUT_TOO_LARGE', new RegExp(`task-schema.json.*${projectBytes / 1024 / 1024} MiB`));
});

test('exact project budget is accepted and a larger file is rejected before any read', (context) => {
  const root = fixture(context, [task(1)]);
  const path = join(root, 'tasks/active.json');
  const source = JSON.stringify([task(1)]);
  writeFileSync(path, source + ' '.repeat(projectBytes - Buffer.byteLength(source)));
  assert.equal(statSync(path).size, projectBytes);
  assert.equal(countTasks(root), 1);
  assert.equal(list(root, '--count').stdout, '1\n');
  truncateSync(path, projectBytes + 1);
  let calls = 0;
  context.mock.method(fs, 'readSync', () => { calls++; throw new Error('oversized input must not be read'); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => getTask(root, 1, { fields: ['id'] }), { code: 'INPUT_TOO_LARGE' });
    assert.equal(calls, 0);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('actual reads stay inside the shared budget even when file metadata understates its size', (context) => {
  const root = fixture(context, [task(1)]);
  const path = join(root, 'tasks/active.json');
  truncateSync(path, projectBytes + 1);
  const read = fs.readSync;
  const stat = fs.fstatSync;
  let stats = 0;
  let bytes = 0;
  context.mock.method(fs, 'fstatSync', (...args) => {
    const result = stat(...args);
    if (stats++ === 0) result.size = 1;
    return result;
  });
  context.mock.method(fs, 'readSync', (...args) => {
    assert.ok(args[3] <= 64 * 1024);
    const count = read(...args);
    bytes += count;
    assert.ok(bytes <= projectBytes);
    return count;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => listTasks(root), { code: 'INPUT_TOO_LARGE' });
    assert.equal(bytes, projectBytes);
    assert.equal(statSync(path).size, projectBytes + 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
