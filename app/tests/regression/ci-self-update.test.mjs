import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test('CI dispatch keeps feature tests source-only and scopes installed self updates', t => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const work = mkdtempSync(join(tmpdir(), 'outask-ci-dispatch-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const preload = join(work, 'capture.mjs'), trace = join(work, 'trace.jsonl');
  // Exercise the real runner's dispatch without building payloads or recursively running tests.
  writeFileSync(preload, `import cp from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
cp.spawnSync=(command,args,options)=>{
  appendFileSync(process.env.OUTASK_CI_TRACE,JSON.stringify({command,args,selfUpdates:options.env.OUTASK_SELF_UPDATE_TESTS})+'\\n');
  return {status:0,stdout:args.includes('app/scripts/release.mjs')?JSON.stringify({artifacts:[{archive:'fixture.tar.gz'}]}):'# tests 1\\n',stderr:''};
};
syncBuiltinESMExports();`);
  for (const mode of [undefined, 'test-feature', 'test', 'distribution', 'npm', 'regression', 'archive', 'npm-archive']) {
    writeFileSync(trace, '');
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(root, 'scripts/ci.mjs'), ...(mode ? [mode] : [])], {
      cwd: root, encoding: 'utf8', env: { ...process.env, OUTASK_CI_TRACE: trace, OUTASK_SELF_UPDATE_TESTS: '1' },
    });
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    const calls = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const tests = calls.filter(call => call.args.includes('--test'));
    const includesPackagedTests = tests.some(call => call.args.includes(join('app/tests', 'release.test.mjs')));
    assert.equal(includesPackagedTests, [undefined, 'test', 'regression'].includes(mode), `${mode}: packaged suite dispatch`);
    if (mode === 'test-feature') {
      assert.equal(calls.length, 2);
      assert.equal(tests.length, 2);
      assert.ok(tests[0].args.includes(join('app/tests', 'cli.test.mjs')));
      assert.ok(tests[1].args.includes(join('app/mcp/tests', 'client.test.mjs')));
    }
    const includesDedicated = tests.some(call => call.args.some(arg => /tests[\\/]regression[\\/]/.test(arg)));
    assert.equal(includesDedicated, ['regression', 'archive'].includes(mode), `${mode}: dedicated suite dispatch`);
    const smoke = calls.filter(call => call.args.some(arg => /(?:distribution|npm)-smoke\.mjs$/.test(arg)));
    assert.equal(smoke.length, ['test-feature', 'test'].includes(mode) ? 0 : ['archive', 'npm', 'npm-archive'].includes(mode) ? 1 : 2);
    for (const call of smoke) assert.equal(call.selfUpdates, ['regression', 'archive', 'npm-archive'].includes(mode) ? '1' : undefined, `${mode}: installed self-update dispatch`);
  }
});
