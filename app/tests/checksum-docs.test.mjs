import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const guide = readFileSync(new URL('../../docs/releases.md', import.meta.url), 'utf8');
const section = guide.split('## Verify a download\n')[1].split('\n## ')[0];
const commands = [...section.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]);
const platforms = [
  { name: 'Linux', target: 'linux-x64', command: commands[0], shell: 'sh' },
  { name: 'macOS', target: 'macos-arm64', command: commands[1], shell: 'sh' },
  { name: 'Windows', target: 'windows-x64', command: commands[2], shell: 'powershell.exe' },
];

for (const platform of platforms) {
  const native = process.platform === 'win32' ? platform.name === 'Windows'
    : process.platform === 'darwin' ? platform.name === 'macOS' : platform.name === 'Linux';
  test(`documented ${platform.name} checksum command accepts matching bytes and rejects corruption or missing entries`, { skip: !native }, t => {
    const directory = mkdtempSync(join(tmpdir(), 'outask-checksum-docs-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const archive = `Outask-1.5.1-${platform.target}.tar.gz`;
    const bytes = Buffer.from('downloaded archive\r\n\0\xff', 'latin1');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const entries = platforms.map(p => `${checksum}  Outask-1.5.1-${p.target}.tar.gz\n`);
    const path = join(directory, 'verify.ps1');
    if (platform.name === 'Windows') writeFileSync(path, platform.command);
    const invoke = () => spawnSync(platform.shell, platform.name === 'Windows'
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path]
      : ['-c', platform.command], { cwd: directory, encoding: 'utf8' });
    writeFileSync(join(directory, archive), bytes);
    writeFileSync(join(directory, 'SHA256SUMS'), entries.join(''));
    const matching = invoke();
    assert.ifError(matching.error);
    assert.equal(matching.status, 0, matching.stderr);
    assert.match(matching.stdout, /OK/);
    writeFileSync(join(directory, archive), 'altered bytes');
    const changed = invoke();
    assert.notEqual(changed.status, 0, changed.stdout);
    writeFileSync(join(directory, archive), bytes);
    writeFileSync(join(directory, 'SHA256SUMS'), entries.filter(entry => !entry.endsWith(`  ${archive}\n`)).join(''));
    const missing = invoke();
    assert.notEqual(missing.status, 0, missing.stdout);
  });
}
