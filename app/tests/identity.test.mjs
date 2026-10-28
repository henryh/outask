import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applicationRoot, cacheRoot, configPath } from '../src/locations.mjs';
import { readConfig } from '../src/config.mjs';
import { fixture, task } from './fixtures.mjs';

test('platform application roots remain stable and explicit cache/config locations remain supported', () => {
  const env = { HOME: '/users/operator', USERPROFILE: 'C:\\Users\\operator', LOCALAPPDATA: '/local' };
  assert.equal(applicationRoot(env, 'linux'), '/users/operator/.local/share/outask');
  assert.equal(applicationRoot(env, 'darwin'), '/users/operator/Library/Application Support/Outask');
  assert.equal(applicationRoot(env, 'win32'), join('/local', 'Programs/Outask'));
  assert.equal(cacheRoot({ HOME: '/users/operator' }), join(applicationRoot({ HOME: '/users/operator' }), 'cache'));
  assert.equal(configPath({ HOME: '/users/operator' }), join(applicationRoot({ HOME: '/users/operator' }), 'config.json'));
  assert.equal(cacheRoot({ XDG_CACHE_HOME: '/selected/cache' }), '/selected/cache/outask/cache');
  assert.equal(configPath({ XDG_CONFIG_HOME: '/selected/config' }), '/selected/config/outask/config.json');
});

test('default registry recognises legacy settings without rewriting and prefers canonical settings', t => {
  const home = fixture(t, []);
  const env = { HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'local') };
  const legacy = join(home, '.config/task-tracker/config.json');
  mkdirSync(join(home, '.config/task-tracker'), { recursive: true });
  writeFileSync(legacy, '{"projects":{},"unknown":{"preserved":true}}\n');
  assert.equal(readConfig(undefined, env).path, legacy);
  const canonical = configPath(env);
  mkdirSync(applicationRoot(env), { recursive: true });
  writeFileSync(canonical, '{"slow_query_ms":42}\n');
  assert.equal(readConfig(undefined, env).path, canonical);
  assert.equal(readConfig(undefined, env).slowQueryMs, 42);
  assert.equal(readConfig(undefined, { ...env, TASK_TRACKER_CONFIG: legacy }).path, legacy);
  assert.equal(readConfig(legacy, env).settings.unknown.preserved, true);
});

test('both CLI names share canonical help, continuations, reads, errors and exit codes', t => {
  assert.deepEqual(readdirSync(new URL('../bin/', import.meta.url)).sort(), ['outask', 'tasks']);
  const root = fixture(t, [task(1), task(2)]);
  for (const args of [['--version'], ['--help'], ['list', '--help'], ['list', '--limit', '1', '--no-cache'],
    ['get', '1', '--fields', 'all', '--format', 'json', '--no-cache'], ['get', '999', '--no-cache'], ['unknown']]) {
    const outputs = ['outask', 'tasks'].map(name => {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../bin/${name}`, import.meta.url)), ...args], {
        cwd: root, encoding: 'utf8', timeout: 10000,
      });
      assert.ifError(result.error);
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    });
    assert.deepEqual(outputs[1], outputs[0]);
  }
});
