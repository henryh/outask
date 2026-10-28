import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configurePath } from '../scripts/install-path.mjs';

function fixture(t, shell = '/bin/bash') {
  const home = mkdtempSync(join(tmpdir(), "Outask profile's "));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, bin: join(home, "custom bin's [literal]"), env: { HOME: home, SHELL: shell, PATH: '/usr/bin:/bin' } };
}
const zsh = existsSync('/bin/zsh') ? '/bin/zsh' : undefined;
const zshEvidence = zsh ? 'actual zsh' : 'bash compatibility check; actual zsh unavailable';
function source(profiles, env, shell = '/bin/bash') {
  const result = spawnSync(shell, ['-f', '-c', 'for profile in "$@"; do . "$profile"; done; printf "%s" "$PATH"', shell, ...profiles], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('bash startup files preserve contents and mode and add a quoted custom path once', (t) => {
  const f = fixture(t);
  const rc = join(f.home, '.bashrc');
  const login = join(f.home, '.bash_login');
  writeFileSync(rc, '# existing content without final newline', { mode: 0o640 });
  writeFileSync(login, '# existing login\n', { mode: 0o600 });
  const output = configurePath(f.bin, { env: f.env, platform: 'linux' }).join('\n');
  assert.match(output, /PATH configured in/);
  assert.match(output, /Run immediately:/);
  assert.match(output, /Open a new terminal/);
  assert.doesNotMatch(output, /export PATH=/);
  const first = readFileSync(rc, 'utf8');
  configurePath(f.bin, { env: f.env, platform: 'linux' });
  assert.equal(readFileSync(rc, 'utf8'), first);
  assert.ok(first.startsWith('# existing content without final newline\n'));
  assert.equal(statSync(rc).mode & 0o777, 0o640);
  assert.equal(source([rc, login, rc], f.env), `${f.bin}:${f.env.PATH}`);
  assert.equal(source([login], { ...f.env, PATH: `${f.bin}:${f.env.PATH}` }), `${f.bin}:${f.env.PATH}`);
});

test(`macOS zsh respects ZDOTDIR (${zshEvidence})`, (t) => {
  const f = fixture(t, '/bin/zsh');
  const zdotdir = join(f.home, "shell settings's");
  const env = { ...f.env, ZDOTDIR: zdotdir };
  configurePath(f.bin, { env, platform: 'darwin' });
  const profile = join(zdotdir, '.zprofile');
  assert.equal(source([profile, profile], env, zsh), `${f.bin}:${env.PATH}`);
  assert.equal(statSync(profile).mode & 0o777, 0o600);
  configurePath(f.bin, { env: f.env, platform: 'darwin' });
  assert.equal(source([join(f.home, '.zprofile')], f.env, zsh), `${f.bin}:${env.PATH}`);
});

test(`Linux zsh configures interactive and login startup files without repetition (${zshEvidence})`, (t) => {
  const f = fixture(t, '/bin/zsh');
  const rc = join(f.home, '.zshrc');
  const profile = join(f.home, '.zprofile');
  writeFileSync(rc, '# user settings\n', { mode: 0o640 });
  configurePath(f.bin, { env: f.env, platform: 'linux' });
  const original = readFileSync(rc, 'utf8');
  configurePath(f.bin, { env: f.env, platform: 'linux' });
  assert.equal(readFileSync(rc, 'utf8'), original);
  assert.ok(original.startsWith('# user settings\n'));
  assert.equal(statSync(rc).mode & 0o777, 0o640);
  for (const files of [[rc], [profile], [profile, rc, profile]]) {
    assert.equal(source(files, f.env, zsh), `${f.bin}:${f.env.PATH}`);
  }
});

test('profile errors and unsupported shells explain immediate use and manual remediation', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.bashrc'));
  const messages = configurePath(f.bin, { env: f.env, platform: 'linux' }).join('\n');
  assert.match(messages, /Command installed.*PATH setup failed/);
  assert.match(messages, /manually/);
  assert.equal(source([join(f.home, '.profile')], f.env), `${f.bin}:${f.env.PATH}`);
  const unsupported = configurePath(f.bin, { env: { ...f.env, SHELL: '/bin/fish' } }).join('\n');
  assert.match(unsupported, /Automatic PATH setup is unavailable for fish/);
  assert.match(unsupported, /Run immediately:/);
  assert.match(unsupported, /export PATH=/);
});

test('reinstallation consolidates complete Outask PATH blocks while preserving user shell content', t => {
  const f = fixture(t);
  const profile = join(f.home, '.bashrc');
  const block = path => `# Outask command path\ncase ":\${PATH-}:" in\n  *:'${path}':*) ;;\n  *) export PATH='${path}':"$PATH" ;;\nesac\n`;
  writeFileSync(profile, `# user before\n${block('/tmp/obsolete installation')}${block('/tmp/second')}`
    + '# Outask command path\n# user-owned customised block\nexport OTHER=retained\n');
  configurePath(f.bin, { env: f.env });
  const contents = readFileSync(profile, 'utf8');
  assert.doesNotMatch(contents, /obsolete installation|\/tmp\/second/);
  assert.match(contents, /# user before/);
  assert.match(contents, /# user-owned customised block\nexport OTHER=retained/);
  assert.equal((contents.match(/^# Outask command path$/gm) || []).length, 2);
  configurePath(f.bin, { env: f.env });
  assert.equal(readFileSync(profile, 'utf8'), contents);
});
