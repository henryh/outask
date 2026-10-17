import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const app = fileURLToPath(new URL('..', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
const mcp = JSON.parse(readFileSync(join(app, 'mcp/package.json'), 'utf8'));
const preflight = readFileSync(join(app, 'runtime.cjs'), 'utf8');

function check(version) {
  return () => vm.runInNewContext(preflight, {
    require: (path) => {
      assert.equal(path, './package.json');
      return manifest;
    },
    process: { versions: { node: version } },
  });
}

test('runtime and adapter require the Node.js 22 FTS5 baseline', () => {
  assert.equal(manifest.engines.node, '>=22.23.3');
  assert.equal(mcp.engines.node, manifest.engines.node);
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /Node\.js\s+(?:>=)?22\.23\.3\b/);
  assert.doesNotMatch(readme, /18\.19|20\.10/);
  assert.throws(check('22.23.2'), /INCOMPATIBLE_RUNTIME:.*>=22\.23\.3/);
  assert.doesNotThrow(check('22.23.3'));
  assert.doesNotThrow(check('24.0.0'));
});
