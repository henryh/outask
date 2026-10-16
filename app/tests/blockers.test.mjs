import assert from 'node:assert/strict';
import fs, { readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { inspectBlockers } from '../src/blockers.mjs';
import { inputBytes, projectBytes, responseBytes } from '../src/limits.mjs';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';

function inspect(root, id, ...args) {
  const result = run('inspect-blockers', [root, String(id), '--format', 'json', ...args]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= responseBytes);
  return JSON.parse(result.stdout);
}

function rejected(result, code) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`^${code}:`));
  assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= responseBytes);
}

test('inspection uses every Active store and only active IDs in mixed stores', (context) => {
  const root = fixture(context, [], {
    stores: {
      'queue.json': { statuses: ['todo'] }, 'mixed.json': { statuses: ['doing', 'shipped'] },
      'done.json': { statuses: ['shipped'] }, 'archive.json': { statuses: ['cancelled'] },
    },
    groups: { Active: ['todo', 'doing'], Done: ['shipped'], Archive: ['cancelled'] },
  });
  rmSync(join(root, 'tasks/active.json'));
  writeStore(root, 'queue.json', [task(1, { status: 'todo', blockers: [99, 3, 2, 4, 2, 404] })]);
  writeStore(root, 'mixed.json', [
    task(4, { status: 'shipped', blockers: [1] }), task(3, { status: 'doing' }), task(2, { status: 'doing' }),
  ]);
  writeFileSync(join(root, 'tasks/done.json'), 'history is not valid JSON');
  writeFileSync(join(root, 'tasks/.task-tracker.json'), 'service state is not task data');
  const before = snapshot(root);
  const opened = [];
  const open = fs.openSync;
  context.mock.method(fs, 'openSync', (path, ...args) => {
    opened.push(path);
    return open(path, ...args);
  });
  syncBuiltinESMExports();
  let result;
  try {
    result = inspectBlockers(root, 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(opened, [
    join(root, 'docs/task-schema.json'), join(root, 'tasks/mixed.json'), join(root, 'tasks/queue.json'),
  ]);
  assert.deepEqual(result.activeBlockers, [2, 3]);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.graph.edges, [{ from: 1, to: 2 }, { from: 1, to: 3 }]);
  assert.equal(result.graph.cycleStatus, 'none');
  assert.deepEqual(inspect(root, 1), result);
  assert.deepEqual(snapshot(root), before);
});

test('Done and Archive moves release work on the next command without changing dependents', (context) => {
  const root = fixture(context, [], {
    stores: {
      'dependents.json': { statuses: ['pending'] }, 'active.json': { statuses: ['pending'] },
      'done.json': { statuses: ['done'] }, 'archive.json': { statuses: ['archive'] },
    },
  });
  const dependent = task(1, { blockers: [2, 99, 404], extension: { keep: ['all', 'data'] } });
  writeStore(root, 'dependents.json', [dependent]);
  const path = join(root, 'tasks/dependents.json');
  const bytes = readFileSync(path);
  for (const [file, status] of [['done.json', 'done'], ['archive.json', 'archive']]) {
    writeStore(root, 'active.json', [task(2)]);
    assert.deepEqual(inspect(root, 1).activeBlockers, [2]);
    // These are operator edits: the application has no mutation command yet.
    writeStore(root, file, [task(2, { status })]);
    writeStore(root, 'active.json', []);
    const moved = snapshot(root);
    const released = inspect(root, 1);
    assert.equal(released.eligible, true);
    assert.deepEqual(released.activeBlockers, []);
    assert.deepEqual(snapshot(root), moved);
    assert.deepEqual(readFileSync(path), bytes);
    rmSync(join(root, 'tasks', file));
    assert.equal(inspect(root, 1).eligible, true);
  }
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8'))[0], dependent);
});

test('minimum tasks and project hierarchy or external references never create edges', (context) => {
  const root = fixture(context, [task(1), task(2, {
    type: 'epic', parent: 1, reference: { path: '/missing/other-project', id: 1 },
    links: ['https://example.invalid/tasks/1', 'neighbour:3'], blockers: [99, 404],
  })]);
  rmSync(join(root, 'tasks/done.json'));
  const before = snapshot(root);
  for (const id of [1, 2]) {
    const result = inspect(root, id, '--depth', '20');
    assert.equal(result.eligible, true);
    assert.deepEqual(result.activeBlockers, []);
    assert.deepEqual(result.graph.edges, []);
    assert.equal(result.graph.cycleStatus, 'none');
  }
  assert.deepEqual(snapshot(root), before);
});

test('active self-links and reintroduced cycle nodes produce closed ID paths', (context) => {
  const root = fixture(context, [task(1, { blockers: [2] }), task(7, { blockers: [7] })]);
  writeStore(root, 'done.json', [task(2, { status: 'done', blockers: [1] })]);
  const inactive = inspectBlockers(root, 1, { depth: 2 });
  assert.equal(inactive.eligible, true);
  assert.equal(inactive.graph.cycleStatus, 'none');
  const self = inspect(root, 7);
  assert.equal(self.eligible, false);
  assert.deepEqual(self.activeBlockers, [7]);
  assert.deepEqual(self.graph.cycle, [7, 7]);
  assert.equal(self.graph.cycleStatus, 'found');
  writeStore(root, 'active.json', [task(2, { blockers: [1] }), task(1, { blockers: [2] })]);
  const before = snapshot(root);
  const cycle = inspect(root, 1, '--depth', '2');
  assert.equal(cycle.eligible, false);
  assert.deepEqual(cycle.graph.cycle, [1, 2, 1]);
  assert.equal(cycle.graph.cycleStatus, 'found');
  const human = run('inspect-blockers', [root, '1', '--depth', '2']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /eligible: no\nactive blockers: 2\ncycle: 1 -> 2 -> 1/);
  assert.deepEqual(snapshot(root), before);
});

test('shared descendants are not cycles and disconnected cycles do not affect the selected task', (context) => {
  const records = [
    task(1, { blockers: [3, 2] }), task(2, { blockers: [4] }), task(3, { blockers: [4] }), task(4),
    task(5, { blockers: [6] }), task(6, { blockers: [5] }),
  ];
  const root = fixture(context, records);
  const result = inspectBlockers(root, 1, { depth: 3 });
  assert.deepEqual(result.graph.edges, [
    { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 },
  ]);
  assert.equal(result.graph.cycleStatus, 'none');
  records[3].blockers = [2];
  writeStore(root, 'active.json', records.reverse());
  const cycle = inspectBlockers(root, 1, { depth: 3 });
  assert.deepEqual(cycle.graph.cycle, [2, 4, 2]);
  assert.equal(cycle.graph.cycleStatus, 'found');
});

test('depth and edge limits disclose incomplete cycle checks without changing direct eligibility', (context) => {
  const root = fixture(context, [
    task(1, { blockers: [4, 2, 99] }), task(2, { blockers: [3] }), task(3, { blockers: [1] }), task(4),
  ]);
  const shallow = inspectBlockers(root, 1);
  assert.deepEqual(shallow.activeBlockers, [2, 4]);
  assert.equal(shallow.eligible, false);
  assert.equal(shallow.graph.cycleStatus, 'unknown');
  assert.deepEqual(shallow.graph.cycle, []);
  assert.deepEqual(shallow.graph.truncated, { depth: true, limit: false, response: false });
  const limited = inspect(root, 1, '--depth', '3', '--limit', '1');
  assert.deepEqual(limited.activeBlockers, shallow.activeBlockers);
  assert.equal(limited.eligible, shallow.eligible);
  assert.deepEqual(limited.graph.edges, [{ from: 1, to: 2 }]);
  assert.deepEqual(limited.graph.truncated, { depth: false, limit: true, response: false });
  assert.equal(limited.graph.cycleStatus, 'unknown');
  const complete = inspectBlockers(root, 1, { depth: 3, limit: 4 });
  assert.deepEqual(complete.graph.cycle, [1, 2, 3, 1]);
  assert.equal(complete.graph.cycleStatus, 'found');
  assert.deepEqual(complete.graph.truncated, { depth: false, limit: false, response: false });
});

test('the 32 KiB budget shortens graph details but never truncates active blocker IDs', (context) => {
  const ids = Array.from({ length: 1400 }, (_, index) => Number.MAX_SAFE_INTEGER - index).reverse();
  const root = fixture(context, [task(1, { blockers: ids }), ...ids.map((id) => task(id))]);
  const result = inspect(root, 1, '--limit', '50');
  assert.deepEqual(result.activeBlockers, ids);
  assert.equal(result.eligible, false);
  assert.equal(result.graph.truncated.response, true);
  assert.ok(result.graph.edges.length < 50);
  assert.equal(result.graph.cycleStatus, 'unknown');
  const human = run('inspect-blockers', [root, '1', '--limit', '50']);
  assert.equal(human.status, 0, human.stderr);
  assert.ok(Buffer.byteLength(human.stdout + human.stderr, 'utf8') <= responseBytes);
  assert.match(human.stdout, /truncated: limit, response/);
  const oversized = Array.from({ length: 1600 }, (_, index) => Number.MAX_SAFE_INTEGER - index);
  writeStore(root, 'active.json', [task(1, { blockers: oversized }), ...oversized.map((id) => task(id))]);
  const before = snapshot(root);
  assert.throws(() => inspectBlockers(root, 1), { code: 'OUTPUT_TOO_LARGE' });
  for (const format of ['text', 'json']) {
    rejected(run('inspect-blockers', [root, '1', '--format', format]), 'OUTPUT_TOO_LARGE');
  }
  assert.deepEqual(snapshot(root), before);
});

test('invalid examined blocker fields fail instead of claiming eligibility', (context) => {
  const root = fixture(context, []);
  for (const blockers of [null, 'outside:2', [0], ['2'], [Number.MAX_SAFE_INTEGER + 1]]) {
    writeStore(root, 'active.json', [task(1, { blockers })]);
    assert.throws(() => inspectBlockers(root, 1), { code: 'INVALID_STORE', message: /task 1: blockers/ });
  }
  writeStore(root, 'active.json', [task(1, { blockers: [2] }), task(2, { blockers: null })]);
  rejected(run('inspect-blockers', [root, '1']), 'INVALID_STORE');
});

test('missing and failed Active reads are errors and input limits never read separate history', (context) => {
  const root = fixture(context, [task(1, { blockers: [99] })]);
  truncateSync(join(root, 'tasks/done.json'), inputBytes + 1);
  assert.equal(inspect(root, 1).eligible, true);
  rejected(run('inspect-blockers', [root, '99']), 'TASK_NOT_FOUND');
  const path = join(root, 'tasks/active.json');
  writeFileSync(path, '{broken');
  rejected(run('inspect-blockers', [root, '1']), 'INVALID_JSON');
  truncateSync(path, projectBytes + 1);
  rejected(run('inspect-blockers', [root, '1']), 'INPUT_TOO_LARGE');
  rmSync(path);
  rejected(run('inspect-blockers', [root, '1']), 'READ_ERROR');
});

test('public options and script arguments enforce bounded Active-only inspection', (context) => {
  const root = fixture(context, [task(1)]);
  for (const options of [null, [], { depth: 0 }, { depth: 21 }, { depth: 1.5 }, { limit: 0 },
    { limit: 51 }, { limit: '1' }, { stores: ['all'] }, { group: 'Done' }]) {
    assert.throws(() => inspectBlockers(root, 1, options), { code: 'INVALID_INPUT' });
  }
  for (const id of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => inspectBlockers(root, id), { code: 'INVALID_INPUT' });
  }
  for (const args of [[root], [root, '1', root], [root, '1', '--depth', '21'],
    [root, '1', '--limit', '0'], [root, '1', '--store', 'all'], [root, '1', '--format', 'ids']]) {
    rejected(run('inspect-blockers', args), 'INVALID_INPUT');
  }
  const help = run('inspect-blockers', ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Maximum graph hops/);
  assert.match(help.stdout, /cycleStatus: unknown/);
  const chosen = run('inspect-blockers', ['.', '1', '--format', 'json'], { cwd: root });
  assert.equal(chosen.status, 0, chosen.stderr);
  assert.equal(JSON.parse(chosen.stdout).eligible, true);
});
