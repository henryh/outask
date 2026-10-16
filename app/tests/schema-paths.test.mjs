import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHttpServer } from '../http.mjs';
import { createTask } from '../src/create.mjs';
import { listTasks } from '../src/tasks.mjs';
import { transitionTask } from '../src/transition.mjs';
import { validateProject } from '../src/validation.mjs';
import { fixture, snapshot, task, writeStore } from './fixtures.mjs';

const executable = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const schema = (status = 'queued') => ({
  stores: { 'active.json': { statuses: [status, 'working'] }, 'done.json': { statuses: ['done'] } },
  groups: { Active: [status, 'working'], Done: ['done'] },
  default_status: status,
});

function writeSchema(root, relative, value) {
  mkdirSync(join(root, relative, '..'), { recursive: true });
  writeFileSync(join(root, relative), JSON.stringify(value));
}

test('automatic selection prefers the new tasks location and retains legacy-only projects', (t) => {
  const current = fixture(t, [task(1, { status: 'queued' })]);
  writeSchema(current, 'tasks/task-schema.json', schema());
  assert.equal(listTasks(current).tasks[0].status, 'queued');
  assert.equal(validateProject(current).valid, true);
  assert.equal(JSON.parse(readFileSync(join(current, 'tasks/.task-tracker.json'))).validated.files['tasks/task-schema.json'] !== undefined, true);

  const legacy = fixture(t, [task(1, { status: 'legacy' })], schema('legacy'));
  assert.equal(listTasks(legacy).tasks[0].status, 'legacy');
  assert.equal(validateProject(legacy).valid, true);
  assert.equal(JSON.parse(readFileSync(join(legacy, 'tasks/.task-tracker.json'))).validated.files['docs/task-schema.json'] !== undefined, true);
});

test('automatic ambiguity and unsafe explicit paths fail before changing project files', (t) => {
  const root = fixture(t, [task(1)], schema('pending'));
  writeSchema(root, 'tasks/task-schema.json', schema('pending'));
  rmSync(join(root, 'tasks/.task-tracker.json'));
  const before = snapshot(root);
  assert.throws(() => listTasks(root), /both exist.*select one explicitly/);
  assert.throws(() => listTasks(root, { schemaPath: '../outside.json' }), /stay inside/);
  assert.deepEqual(snapshot(root), before);
  assert.equal(listTasks(root, { schemaPath: 'tasks/task-schema.json' }).total, 1);
  assert.equal(listTasks(root, { schemaPath: 'docs/task-schema.json' }).total, 1);
});

test('a schema inside tasks is excluded from stores while driving core reads, writes and fingerprints', (t) => {
  const root = fixture(t, [task(1, { status: 'queued' })]);
  writeSchema(root, 'tasks/custom-schema.json', schema());
  const options = { schemaPath: 'tasks/custom-schema.json' };
  assert.equal(listTasks(root, { ...options, stores: ['all'] }).total, 2);
  const created = createTask(root, { title: 'Selected' }, options);
  assert.equal(created.status, 'queued');
  assert.equal(validateProject(root, options).valid, true);
  const state = JSON.parse(readFileSync(join(root, 'tasks/.task-tracker.json')));
  assert.match(state.validated.files['tasks/custom-schema.json'], /^[a-f0-9]{64}$/);
  assert.equal(transitionTask(root, created.id, 'working', options).status, 'working');
  writeSchema(root, 'tasks/custom-schema.json', {
    stores: { 'active.json': { statuses: ['backlog'] } }, groups: { Active: ['backlog'] }, default_status: 'backlog',
  });
  assert.throws(() => transitionTask(root, created.id, 'working', options), /allowed configured statuses: backlog/);
});

test('standalone and CLI schema selectors match and registry config keeps its own meaning', (t) => {
  const root = fixture(t, [task(1, { status: 'queued' })]);
  writeSchema(root, 'tasks/custom-schema.json', schema());
  const script = fileURLToPath(new URL('../scripts/list-tasks.mjs', import.meta.url));
  const standalone = spawnSync(process.execPath, [script, root, '--schema-path', 'tasks/custom-schema.json', '--store', 'all', '--format', 'json'], { encoding: 'utf8' });
  assert.equal(standalone.status, 0, standalone.stderr);
  const registry = join(root, 'registry.json');
  writeFileSync(registry, JSON.stringify({ projects: { selected: root } }));
  const cli = spawnSync(process.execPath, [executable, 'list', '--project', 'selected', '--config', registry,
    '--schema-path', 'tasks/custom-schema.json', '--store', 'all', '--format', 'json'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), JSON.parse(standalone.stdout));
});

test('HTTP startup fixes one explicit schema for every request', async (t) => {
  const root = fixture(t, [task(1, { status: 'queued' })]);
  writeSchema(root, 'tasks/custom-schema.json', schema());
  const token = 'schema_path_http_token_1234567890';
  const server = createHttpServer(root, { token, schemaPath: 'tasks/custom-schema.json' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const result = await new Promise((resolve, reject) => {
    const call = request(`http://127.0.0.1:${server.address().port}/tasks`, { headers: { Authorization: `Bearer ${token}` } }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    call.on('error', reject);
    call.end();
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.tasks[0].status, 'queued');
});

test('schema symlinks and symlink ancestors are rejected before service preparation', (t) => {
  const outside = fixture(t, [task(9)]);
  writeSchema(outside, 'config/schema.json', schema('pending'));

  const linkedFile = fixture(t, [task(1)]);
  rmSync(join(linkedFile, 'tasks/.task-tracker.json'));
  mkdirSync(join(linkedFile, 'config'));
  symlinkSync(join(outside, 'config/schema.json'), join(linkedFile, 'config/schema.json'));
  assert.throws(() => listTasks(linkedFile, { schemaPath: 'config/schema.json' }), /must not contain symbolic links/);
  assert.equal(existsSync(join(linkedFile, 'tasks/.task-tracker.json')), false);

  const linkedAncestor = fixture(t, [task(2)]);
  rmSync(join(linkedAncestor, 'tasks/.task-tracker.json'));
  symlinkSync(join(outside, 'config'), join(linkedAncestor, 'config'));
  assert.throws(() => validateProject(linkedAncestor, { schemaPath: 'config/schema.json' }), /must not contain symbolic links/);
  assert.equal(existsSync(join(linkedAncestor, 'tasks/.task-tracker.json')), false);

  const legacy = fixture(t, [task(3)]);
  rmSync(join(legacy, 'tasks/.task-tracker.json'));
  mkdirSync(join(legacy, 'docs'));
  symlinkSync(join(outside, 'config/schema.json'), join(legacy, 'docs/task-schema.json'));
  assert.throws(() => listTasks(legacy), /must not contain symbolic links/);
  assert.equal(existsSync(join(legacy, 'tasks/.task-tracker.json')), false);
});

test('an in-tasks schema cannot configure itself as a task store', (t) => {
  const root = fixture(t, [task(1)]);
  writeSchema(root, 'tasks/custom-schema.json', {
    stores: { 'custom-schema.json': { statuses: ['pending'] } }, groups: { Active: ['pending'] },
  });
  rmSync(join(root, 'tasks/.task-tracker.json'));
  assert.throws(() => listTasks(root, { schemaPath: 'tasks/custom-schema.json', stores: ['all'] }), /reserved store name custom-schema.json/);
  assert.equal(existsSync(join(root, 'tasks/.task-tracker.json')), false);
});
