import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { appendRecord, changeFields, recordSpans, removeRecord } from '../src/source.mjs';
import { updateTask } from '../src/update.mjs';
import { fixture, snapshot, task } from './fixtures.mjs';

test('record spans retain compact, CRLF, nested, escaped and numeric source bytes', () => {
  const compact = '[{"id":1,"n":1e+03},{"id":2,"n":9007199254740993}]\n';
  const crlf = '[\r\n  {"id":1,"nested":{"x":[1,2]}},\r\n  {"id":2,"escaped":"\\u0041"}\r\n]\r\n';

  assert.deepEqual(recordSpans(compact).map(([start, end]) => compact.slice(start, end)), [
    '{"id":1,"n":1e+03}',
    '{"id":2,"n":9007199254740993}',
  ]);
  assert.deepEqual(recordSpans(crlf).map(([start, end]) => crlf.slice(start, end)), [
    '{"id":1,"nested":{"x":[1,2]}}',
    '{"id":2,"escaped":"\\u0041"}',
  ]);
});

test('field edits change only effective keys and retain untouched lexemes', () => {
  const source = '{"id":1 , "\\u0074itle":"old","title":"effective","n":9007199254740993,"fraction":1.2300,"exp":1e+03,"nested":{"x":[1,2]},"drop":1,"drop":2}';

  assert.equal(changeFields(source, {}), source);
  assert.equal(
    changeFields(source, { title: 'new', nested: { ok: true }, added: ['x'] }, ['drop']),
    '{"id":1 , "\\u0074itle":"old","title":"new","n":9007199254740993,"fraction":1.2300,"exp":1e+03,"nested":{\n    "ok": true\n  },\n  "added": [\n    "x"\n  ]}',
  );
});

test('record removal and append retain the established store layout', () => {
  const source = '[\r\n  {"id":1},\r\n  {"id":2},\r\n  {"id":3}\r\n]\r\n';
  const spans = recordSpans(source);

  assert.equal(removeRecord(source, spans, 0), '[\r\n  {"id":2},\r\n  {"id":3}\r\n]\r\n');
  assert.equal(removeRecord(source, spans, 1), '[\r\n  {"id":1},\r\n  {"id":3}\r\n]\r\n');
  assert.equal(removeRecord(source, spans, 2), '[\r\n  {"id":1},\r\n  {"id":2}\r\n]\r\n');
  assert.equal(appendRecord('[\r\n  {"id":1}\r\n]\r\n', '{"id":2}', 1), '[\r\n  {"id":1},\n  {"id":2}\n]\r\n');
});

test('public mutations still reject comments, trailing commas and malformed recovery input', (t) => {
  for (const invalid of [
    '[{"id":1,"title":"Task 1","status":"pending"} // comment\n]\n',
    '[{"id":1,"title":"Task 1","status":"pending",}]\n',
    '[{"id":1,"title":"Task 1","status":"pending"}\n',
  ]) {
    const root = fixture(t, [task(1)]);
    const path = join(root, 'tasks/active.json');
    writeFileSync(path, invalid);
    const before = snapshot(root);
    assert.throws(() => updateTask(root, 1, { set: { title: 'Changed' } }), { code: 'INVALID_JSON' });
    assert.deepEqual(snapshot(root), before);
  }
});
