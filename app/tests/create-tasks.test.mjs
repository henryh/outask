import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, cpSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTask } from '../src/create.mjs';
import { inputBytes, projectBytes } from '../src/limits.mjs';
import { getTask } from '../src/tasks.mjs';
import { validateProject } from '../src/validation.mjs';
import { projectLockPath } from '../src/project-lock.mjs';
import { databaseSync } from '../src/sqlite.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

const state = (root) => JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.json'), 'utf8'));
const script = fileURLToPath(new URL('../scripts/create-task.mjs', import.meta.url));
const operation = new URL('../src/create.mjs', import.meta.url).href;

function unstamped(record) {
  const { updated_at, ...fields } = record;
  assert.equal(new Date(updated_at).toISOString(), updated_at);
  return fields;
}

function rejected(root, input, code, options) {
  const before = snapshot(root);
  assert.throws(() => createTask(root, input, options), { code });
  assert.deepEqual(snapshot(root), before);
}

function launch(root, input, preload) {
  const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), script, root, '--input', '-', '--format', 'json'], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const complete = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  child.stdin.end(JSON.stringify(input));
  return { child, complete };
}

function observeLock(root) {
  const path = join(root, 'lock-observer.mjs');
  writeFileSync(path, `import { databaseSync } from ${JSON.stringify(new URL('../src/sqlite.mjs', import.meta.url).href)};\nconst DatabaseSync = databaseSync();\nconst exec = DatabaseSync.prototype.exec;\nDatabaseSync.prototype.exec = function(sql) {\n  if (sql === 'BEGIN EXCLUSIVE') process.send('waiting');\n  return exec.call(this, sql);\n};\n`);
  return path;
}

test('standalone creation returns the complete task and preserves existing task source', (t) => {
  const root = fixture(t, []);
  const original = '[\r\n\t{"id":1,"title":"Original","status":"pending","number":9007199254740993,"escaped":"\\u0041","custom":{"keep":true}}\r\n]\r\n';
  const path = join(root, 'tasks/active.json');
  writeFileSync(path, original);
  chmodSync(path, 0o640);
  writeStore(root, '.task-tracker.json', { note: 'keep', validated: { owner: 'operator' } });
  const before = snapshot(root);
  const input = { title: 'Created through stdin', reference: { project: '/not/followed', id: 7 } };
  const result = run('create-task', [root, '--input', '-', '--format', 'json'], { input: JSON.stringify(input) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const created = JSON.parse(result.stdout);
  assert.deepEqual(unstamped(created), { id: 100, title: input.title, status: 'pending', priority: 'medium', blockers: [], reference: input.reference });
  const retrieved = run('get-task', [root, '100', '--format', 'json']);
  assert.equal(retrieved.status, 0, retrieved.stderr);
  assert.deepEqual(JSON.parse(retrieved.stdout), created);
  assert.ok(readFileSync(path, 'utf8').startsWith(original.slice(0, original.lastIndexOf(']')).trimEnd()));
  assert.deepEqual(readFileSync(join(root, 'tasks/done.json')), before['done.json']);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o640);
  assert.equal(state(root).note, 'keep');
  assert.equal(state(root).validated.owner, 'operator');
  assert.equal(validateProject(root).refreshed, false);
  const inputFile = join(root, 'new-task.json');
  writeFileSync(inputFile, JSON.stringify({ title: 'From a file', priority: 'high', blockers: [99] }));
  const second = run('create-task', [root, '--input', inputFile]);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(unstamped(JSON.parse(second.stdout)), { id: 101, title: 'From a file', status: 'pending', priority: 'high', blockers: [99] });
});

test('minimal creation honours custom statuses and project extension requirements', (t) => {
  const root = fixture(t, [], {
    stores: { 'active.json': { statuses: ['todo', 'doing'], required_fields: ['acceptance'] } },
    groups: { Active: ['todo', 'doing'] }, format: 'minimal', default_status: 'todo', working_statuses: ['doing'],
    required_fields: ['scope'], plan: { required_for_statuses: ['doing'] },
  });
  unlinkSync(join(root, 'tasks/done.json'));
  rejected(root, { title: 'Missing extension' }, 'INVALID_STORE');
  rejected(root, { title: 'Empty extension', scope: 'Work', acceptance: [] }, 'INVALID_STORE');
  const created = createTask(root, { title: 'Minimal with extensions', scope: 'Work', acceptance: ['Check'] });
  assert.deepEqual(unstamped(created), { id: 1, title: 'Minimal with extensions', status: 'todo', scope: 'Work', acceptance: ['Check'] });
  assert.deepEqual(getTask(root, 1), created);
  rejected(root, { title: 'No plan', status: 'doing', scope: 'Work', acceptance: ['Check'] }, 'INVALID_STORE');
  const working = { title: 'Work', status: 'doing', scope: 'Work', acceptance: ['Check'], techdesign: 'Design', stages: ['Implement'] };
  rejected(root, { ...working, blockers: [1] }, 'ACTIVE_BLOCKERS');
  const started = createTask(root, { ...working, blockers: [500], priority: 'low' });
  assert.deepEqual(started.blockers, [500]);
  assert.equal(started.priority, 'low');
  assert.equal(started.id, 2);
});

test('minimal creation adds only updated_at to id, title and status', (t) => {
  const root = fixture(t, [], { stores: { 'active.json': { statuses: ['pending'] } }, format: 'minimal' });
  const result = run('create-task', [root, '--input', '-'], { input: '{"title":"Three fields"}' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(unstamped(JSON.parse(result.stdout)), { id: 100, title: 'Three fields', status: 'pending' });
});

test('explicit IDs cannot collide with any retained store and never lower the counter', (t) => {
  const root = fixture(t, [task(1)], {
    stores: {
      'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] },
      'archive.json': { statuses: ['archive'] }, 'legacy.json': { statuses: ['old'], validate: false },
    }, groups: { Active: ['pending'], Done: ['done'], Archive: ['archive', 'old'] },
  });
  writeStore(root, 'archive.json', [task(150, { status: 'archive' })]);
  writeStore(root, 'legacy.json', [{ id: 700, legacyOnly: true }]);
  writeStore(root, 'retained.json', [task(900, { status: 'historical' })]);
  for (const id of [1, 99, 150, 700, 900]) rejected(root, { id, title: 'Duplicate' }, 'ID_CONFLICT');
  assert.equal(createTask(root, { title: 'Automatic' }).id, 901);
  assert.equal(createTask(root, { id: 950, title: 'Explicit high' }).id, 950);
  assert.equal(createTask(root, { id: 50, title: 'Unused lower ID' }).id, 50);
  assert.equal(state(root).counter, 950);
  rejected(root, { id: 50, title: 'Duplicate' }, 'ID_CONFLICT');
  assert.equal(createTask(root, { title: 'Next' }).id, 951);
});

test('missing state and external task, file-set and configuration edits refresh allocation', (t) => {
  const root = fixture(t, [task(1)]);
  const first = createTask(root, { title: 'Missing service' });
  assert.equal(first.id, 100);
  const saved = state(root);
  delete saved.counter;
  saved.operator = { keep: true };
  writeStore(root, '.task-tracker.json', saved);
  assert.equal(createTask(root, { title: 'Missing counter' }).id, 101);
  writeStore(root, 'active.json', [task(1), first, task(500)]);
  assert.equal(createTask(root, { title: 'Manual higher ID' }).id, 501);
  writeStore(root, 'old.json', [task(800)]);
  assert.equal(createTask(root, { title: 'Added file' }).id, 801);
  unlinkSync(join(root, 'tasks/old.json'));
  assert.equal(createTask(root, { title: 'Removed file' }).id, 802);
  assert.equal(state(root).validated.files['tasks/old.json'], undefined);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({ stores: { 'active.json': { statuses: ['pending'] } }, required_fields: ['scope'] }));
  rejected(root, { title: 'External config invalidates retained records', scope: 'Present' }, 'INVALID_STORE');
  unlinkSync(join(root, 'docs/task-schema.json'));
  writeStore(root, 'old.json', [task(500)]);
  rejected(root, { title: 'External duplicate' }, 'INVALID_STORE');
  writeFileSync(join(root, 'tasks/old.json'), '[');
  rejected(root, { title: 'Malformed history' }, 'INVALID_JSON');
  unlinkSync(join(root, 'tasks/old.json'));
  assert.deepEqual(state(root).operator, { keep: true });
});

test('normal automatic creates hash history without parsing it and retain current certificates', (t) => {
  const root = fixture(t, [task(1)]);
  writeStore(root, 'done.json', [task(99, { status: 'done', historyMarker: 'history' })]);
  validateProject(root);
  const parse = JSON.parse;
  let historyParses = 0;
  const mocked = t.mock.method(JSON, 'parse', (source, ...args) => {
    if (typeof source === 'string' && source.includes('historyMarker')) historyParses++;
    return parse(source, ...args);
  });
  createTask(root, { title: 'First fast allocation' });
  createTask(root, { title: 'Second fast allocation' });
  createTask(root, { id: 500, title: 'Explicit above the counter' });
  assert.equal(historyParses, 0);
  writeStore(root, 'retained.json', [task(900)]);
  assert.equal(createTask(root, { title: 'Changed file set' }).id, 901);
  assert.equal(historyParses, 1);
  createTask(root, { id: 20, title: 'Explicit below the counter' });
  assert.equal(historyParses, 2);
  mocked.mock.restore();
  assert.equal(validateProject(root).refreshed, false);
});

test('counter edits and missing counter certificates require revalidation before allocating', (t) => {
  const root = fixture(t, [task(1)]);
  writeStore(root, 'done.json', [task(99, { status: 'done', historyMarker: true })]);
  validateProject(root);
  writeStore(root, '.task-tracker.json', { ...state(root), counter: 0 });
  assert.equal(createTask(root, { title: 'After a lowered counter' }).id, 100);
  const service = state(root);
  delete service.validated.counter;
  writeStore(root, '.task-tracker.json', service);
  const parse = JSON.parse;
  let historyParses = 0;
  t.mock.method(JSON, 'parse', (source, ...args) => {
    if (typeof source === 'string' && source.includes('historyMarker')) historyParses++;
    return parse(source, ...args);
  });
  assert.equal(createTask(root, { title: 'After a missing certificate' }).id, 101);
  assert.equal(historyParses, 1);
  assert.equal(state(root).validated.counter, 101);
  writeStore(root, 'active.json', [task(1)]);
  writeStore(root, '.task-tracker.json', { ...state(root), counter: 0 });
  assert.equal(createTask(root, { title: 'Keep the certified allocation floor' }).id, 102);
});

test('working-state blockers, self-links, cycles and invalid fields reject without writing', (t) => {
  const root = fixture(t, [task(1, { blockers: [100] }), task(2)]);
  validateProject(root);
  for (const status of ['in_progress', 'review']) {
    rejected(root, { title: 'Blocked work', status, blockers: [2, 99, 1000, 2] }, 'ACTIVE_BLOCKERS');
  }
  rejected(root, { title: 'Creates a cycle', blockers: [1] }, 'INVALID_STORE');
  rejected(root, { title: 'Self link', blockers: [100] }, 'INVALID_STORE');
  rejected(root, { id: 102, title: 'Inactive self link', status: 'done', blockers: [102] }, 'INVALID_STORE');
  for (const input of [{ title: '' }, { title: 'Bad priority', priority: 'urgent' }, { title: 'Bad blockers', blockers: ['2'] }]) {
    rejected(root, input, 'INVALID_STORE');
  }
  const started = createTask(root, { title: 'Inactive references', status: 'in_progress', blockers: [99, 1000], parent: 'elsewhere#2' });
  assert.deepEqual(started.blockers, [99, 1000]);
  assert.equal(started.parent, 'elsewhere#2');
});

test('mixed stores and explicit destinations use current Active membership', (t) => {
  const root = fixture(t, [], {
    stores: { 'active.json': { statuses: ['todo', 'doing'] }, 'mixed.json': { statuses: ['todo', 'doing', 'done'] },
      'legacy.json': { statuses: ['todo'], validate: false } },
    groups: { Active: ['todo', 'doing'], Done: ['done'] }, default_status: 'todo', working_statuses: ['doing'],
  });
  writeStore(root, 'mixed.json', [task(2, { status: 'todo' }), task(3, { status: 'done' })]);
  writeStore(root, 'legacy.json', [{ id: 4, status: 'todo' }]);
  rejected(root, { title: 'Ambiguous' }, 'INVALID_INPUT');
  rejected(root, { title: 'Wrong store' }, 'INVALID_INPUT', { store: 'done' });
  rejected(root, { title: 'Blocked', status: 'doing', blockers: [2] }, 'ACTIVE_BLOCKERS', { store: 'active' });
  rejected(root, { title: 'Exempt active blocker', status: 'doing', blockers: [4] }, 'ACTIVE_BLOCKERS', { store: 'active' });
  assert.equal(createTask(root, { title: 'Mixed history is inactive', status: 'doing', blockers: [3] }, { store: 'mixed' }).id, 100);
  rejected(root, { title: '', status: 'todo' }, 'INVALID_STORE', { store: 'legacy' });
});

test('two simultaneous standalone creators wait for coordination and retain unique tasks', { timeout: 10000 }, async (t) => {
  const root = fixture(t, [task(1)]);
  const lock = new (databaseSync())(projectLockPath(root));
  lock.exec('BEGIN EXCLUSIVE');
  t.after(() => { if (lock.isOpen) lock.close(); });
  const preload = observeLock(root);
  const first = launch(root, { title: 'First process' }, preload);
  const second = launch(root, { title: 'Second process' }, preload);
  t.after(() => { first.child.kill(); second.child.kill(); });
  await Promise.all([once(first.child, 'message'), once(second.child, 'message')]);
  lock.close();
  const results = await Promise.all([first.complete, second.complete]);
  for (const result of results) {
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
  }
  const created = results.map((result) => JSON.parse(result.stdout));
  assert.deepEqual(created.map((record) => record.id).sort((a, b) => a - b), [100, 101]);
  for (const record of created) assert.deepEqual(getTask(root, record.id), record);
  assert.equal(state(root).counter, 101);
  assert.equal(validateProject(root).refreshed, false);
});

test('creation rechecks active blockers after acquiring the coordinated write boundary', { timeout: 10000 }, async (t) => {
  const root = fixture(t, [task(1)]);
  validateProject(root);
  const service = readFileSync(join(root, 'tasks/.task-tracker.json'));
  const lock = new (databaseSync())(projectLockPath(root));
  lock.exec('BEGIN EXCLUSIVE');
  t.after(() => { if (lock.isOpen) lock.close(); });
  const pending = launch(root, { title: 'Formerly ready', status: 'in_progress', blockers: [2] }, observeLock(root));
  t.after(() => pending.child.kill());
  await once(pending.child, 'message');
  writeStore(root, 'active.json', [task(1), task(2)]);
  const active = readFileSync(join(root, 'tasks/active.json'));
  lock.close();
  const result = await pending.complete;
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ACTIVE_BLOCKERS.*Active blockers: 2/);
  assert.deepEqual(readFileSync(join(root, 'tasks/active.json')), active);
  assert.deepEqual(readFileSync(join(root, 'tasks/.task-tracker.json')), service);
});

test('an interrupted task replacement is recovered without reusing or losing the retained ID', (t) => {
  const root = fixture(t, [task(1)]);
  const acknowledged = createTask(root, { title: 'Acknowledged task' });
  const before = readFileSync(join(root, 'tasks/.task-tracker.json'));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { rename(from, to); if (to.endsWith('/tasks/active.json')) process.exit(75); };
    syncBuiltinESMExports();
    const { createTask } = await import(${JSON.stringify(operation)});
    createTask(process.argv[1], {title: 'Interrupted task'});
  `, root], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 75, child.stderr);
  assert.deepEqual(readFileSync(join(root, 'tasks/.task-tracker.json')), before);
  assert.equal(getTask(root, 101).title, 'Interrupted task');
  const recovered = createTask(root, { title: 'After recovery' });
  assert.equal(recovered.id, 102);
  assert.deepEqual(getTask(root, acknowledged.id), acknowledged);
  assert.equal(getTask(root, 101).title, 'Interrupted task');
  assert.equal(validateProject(root).refreshed, false);
});

test('a post-task service write failure reports the saved ID and recovers on the next create', (t) => {
  const root = fixture(t, [task(1)]);
  validateProject(root);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to.endsWith('/tasks/.task-tracker.json')) throw Object.assign(new Error('injected write failure'), { code: 'EIO' });
      return rename(from, to);
    };
    syncBuiltinESMExports();
    const { createTask } = await import(${JSON.stringify(operation)});
    try { createTask(process.argv[1], {title: 'Saved before failure'}); }
    catch (error) { console.log(JSON.stringify({code: error.code, message: error.message})); }
  `, root], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const error = JSON.parse(child.stdout);
  assert.equal(error.code, 'WRITE_INCOMPLETE');
  assert.match(error.message, /task 100 was saved.*do not blindly repeat/);
  assert.equal(getTask(root, 100).title, 'Saved before failure');
  assert.equal(createTask(root, { title: 'Recovered' }).id, 101);
  assert.equal(validateProject(root).refreshed, false);
});

test('oversized responses, oversized resulting stores, bad inputs and exhaustion fail before writing', (t) => {
  const root = fixture(t, [task(1)]);
  rejected(root, { title: 'Large response', detail: '🙂'.repeat(9000) }, 'OUTPUT_TOO_LARGE');
  for (const input of [null, [], { id: 0, title: 'Bad ID' }, { title: 'Unsupported', extra: undefined }]) {
    rejected(root, input, 'INVALID_INPUT');
  }
  const before = snapshot(root);
  const malformed = run('create-task', [root, '--input', '-'], { input: '[' });
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stdout, '');
  assert.match(malformed.stderr, /INVALID_JSON/);
  const oversized = run('create-task', [root, '--input', '-'], { input: ' '.repeat(inputBytes + 1) });
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /INPUT_TOO_LARGE/);
  assert.deepEqual(snapshot(root), before);
  unlinkSync(join(root, 'tasks/done.json'));
  const active = JSON.stringify([task(1)]);
  writeFileSync(join(root, 'tasks/active.json'), `${active}${' '.repeat(projectBytes - Buffer.byteLength(active) - 40)}`);
  rejected(root, { title: 'Would exceed project budget' }, 'INPUT_TOO_LARGE');
  writeStore(root, 'active.json', [task(Number.MAX_SAFE_INTEGER)]);
  rejected(root, { title: 'Exhausted' }, 'ID_EXHAUSTED');
  assert.equal(createTask(root, { id: 2, title: 'Explicit unused ID' }).id, 2);
  assert.equal(state(root).counter, Number.MAX_SAFE_INTEGER);
});

test('creation configuration is validated consistently by validation and creation', (t) => {
  const root = fixture(t, []);
  mkdirSync(join(root, 'docs'));
  for (const extra of [{ format: 'unknown' }, { default_status: 'unknown' }, { working_statuses: 'in_progress' },
    { working_statuses: ['unknown'] }, { working_statuses: ['done'] }]) {
    writeFileSync(join(root, 'docs/task-schema.json'), JSON.stringify({ stores: {
      'active.json': { statuses: ['pending', 'in_progress'] }, 'done.json': { statuses: ['done'] },
    }, ...extra }));
    rejected(root, { title: 'Bad configuration' }, 'INVALID_CONFIG');
    assert.throws(() => validateProject(root), { code: 'INVALID_CONFIG' });
  }
});

test('malformed UTF-8 in an existing task fails creation without changing task or service bytes', (t) => {
  const root = fixture(t, [task(1)]);
  validateProject(root);
  const source = Buffer.concat([
    Buffer.from('[{"id":1,"title":"Original","status":"pending","extension":"'),
    Buffer.from([0xff]), Buffer.from('"}]\n'),
  ]);
  writeFileSync(join(root, 'tasks/active.json'), source);
  const before = snapshot(root);
  const result = run('create-task', [root, '--input', '-'], { input: '{"title":"New task"}' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INVALID_JSON:.*active\.json: invalid UTF-8/);
  assert.deepEqual(snapshot(root), before);
});

for (const boundary of ['stdin', 'file']) {
  test(`malformed UTF-8 in create ${boundary} input fails before persistence`, (t) => {
    const root = fixture(t, [task(1)]);
    validateProject(root);
    const input = Buffer.concat([Buffer.from('{"title":"New task","extension":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    const before = snapshot(root);
    const path = join(root, 'new-task.json');
    if (boundary === 'file') writeFileSync(path, input);
    const result = run('create-task', [root, '--input', boundary === 'file' ? path : '-'], boundary === 'stdin' ? { input } : {});
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /INVALID_JSON:.*invalid UTF-8/);
    assert.deepEqual(snapshot(root), before);
  });
}

test('valid UTF-8 survives shared source reads and creation from stdin and files', (t) => {
  const root = fixture(t, [task(1)]);
  const extension = 'Ελληνικά café 🙂 �';
  const source = `[{"id":1,"title":"Original","status":"pending","extension":"${extension}"}]\n`;
  writeFileSync(join(root, 'tasks/active.json'), source);
  const input = Buffer.from(JSON.stringify({ title: 'UTF-8 input', extension }));
  const path = join(root, 'new-task.json');
  writeFileSync(path, input);
  for (const [selected, options] of [['-', { input }], [path, {}]]) {
    const result = run('create-task', [root, '--input', selected], options);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).extension, extension);
  }
  assert.ok(readFileSync(join(root, 'tasks/active.json'), 'utf8').startsWith(source.slice(0, source.lastIndexOf(']'))));
  assert.equal(getTask(root, 1).extension, extension);
  assert.equal(validateProject(root).refreshed, false);
});

test('inline JSON command creates in cwd using the documented relative script path', (t) => {
  const root = fixture(t, [task(1)]);
  mkdirSync(join(root, 'app'));
  for (const directory of ['scripts', 'src']) {
    cpSync(new URL(`../${directory}`, import.meta.url), join(root, 'app', directory), { recursive: true });
  }
  const result = spawnSync(process.execPath, ['app/scripts/create-task.mjs', '--json', '{"title":"Пробная задача"}'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const created = JSON.parse(result.stdout);
  assert.deepEqual(unstamped(created), { id: 100, title: 'Пробная задача', status: 'pending', priority: 'medium', blockers: [] });
  assert.deepEqual(getTask(root, 100), created);
  assert.equal(state(root).counter, 100);
  assert.equal(state(root).validated.counter, 100);
  assert.equal(validateProject(root).refreshed, false);
});

test('inline JSON honours an explicit project instead of the current directory', (t) => {
  const cwd = fixture(t, [task(1)]);
  const selected = fixture(t, [task(2)]);
  const before = snapshot(cwd);
  const result = run('create-task', [selected, '--json={"title":"Explicit project"}'], { cwd });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(getTask(selected, 100).title, 'Explicit project');
  assert.deepEqual(snapshot(cwd), before);
});

test('file and stdin creation also accept the current directory default', (t) => {
  const root = fixture(t, [task(1)]);
  writeFileSync(join(root, 'input.json'), '{"title":"File in cwd"}');
  const file = run('create-task', ['--input', 'input.json'], { cwd: root });
  assert.equal(file.status, 0, file.stderr);
  assert.equal(JSON.parse(file.stdout).title, 'File in cwd');
  const stdin = run('create-task', ['--input', '-'], { cwd: root, input: '{"title":"Stdin in cwd"}' });
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(JSON.parse(stdin.stdout).id, 101);
  assert.equal(JSON.parse(stdin.stdout).title, 'Stdin in cwd');
});

test('missing, repeated, conflicting and malformed creation sources leave data unchanged', (t) => {
  const root = fixture(t, [task(1)]);
  validateProject(root);
  const before = snapshot(root);
  const scenarios = [
    [[], 'INVALID_INPUT'],
    [['--json', '{"title":"First"}', '--json', '{"title":"Second"}'], 'INVALID_INPUT'],
    [['--input', 'missing.json', '--input', '-'], 'INVALID_INPUT'],
    [['--json', '{"title":"Combined"}', '--input', '-'], 'INVALID_INPUT'],
    [['--json', '['], 'INVALID_JSON'],
    [['--json', ''], 'INVALID_JSON'],
    [['--json', '[]'], 'INVALID_INPUT'],
    [[root, root, '--json', '{"title":"Two projects"}'], 'INVALID_INPUT'],
  ];
  for (const [args, code] of scenarios) {
    const result = run('create-task', args, { cwd: root });
    assert.equal(result.status, 1, `args: ${JSON.stringify(args)}; stderr: ${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.startsWith(`${code}:`), result.stderr);
    assert.deepEqual(snapshot(root), before);
  }
});

test('oversized inline JSON is rejected at the command input boundary', (t) => {
  const root = fixture(t, [task(1)]);
  const before = snapshot(root);
  // Build argv in the child because operating systems cap individual shell arguments below 8 MiB.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.argv = [process.execPath, ${JSON.stringify(script)}, '--json', ' '.repeat(${inputBytes + 1})];
    await import(${JSON.stringify(new URL('../scripts/create-task.mjs', import.meta.url).href)});
  `], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /INPUT_TOO_LARGE:.*8 MiB/);
  assert.deepEqual(snapshot(root), before);
});
