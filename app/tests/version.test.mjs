import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distributionVersion } from '../src/version.mjs';

test('zero-patch package versions use compact distribution identifiers', () => {
  assert.equal(distributionVersion('0.12.0'), '0.12');
});

test('non-zero patch versions remain complete distribution identifiers', () => {
  assert.equal(distributionVersion('0.12.1'), '0.12.1');
});
