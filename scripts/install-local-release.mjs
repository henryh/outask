#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportError } from '../app/scripts/output.mjs';
import { archiveName, hostTarget, root, run } from './release-config.mjs';

try {
  const outDir = mkdtempSync(join(tmpdir(), 'task-tracker-release-'));
  try {
    const target = hostTarget();
    run(process.execPath, ['app/scripts/release.mjs', '--out-dir', outDir], { cwd: root });
    run('tar', ['-xzf', join(outDir, archiveName(target)), '-C', outDir]);
    const args = [];
    if (process.env.BIN_DIR) args.push('--bin-dir', process.env.BIN_DIR);
    if (process.env.RELEASE_ROOT) args.push('--release-root', process.env.RELEASE_ROOT);
    const installation = join(outDir, 'OutaskAI');
    run(process.execPath, [join(installation, 'app/runtime.cjs')]);
    run(process.execPath, [join(installation, 'install.mjs'), ...args]);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}
