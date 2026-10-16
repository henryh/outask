#!/usr/bin/env node
import { reportError } from '../app/scripts/output.mjs';
import { run, targetList, root } from './release-config.mjs';

try {
  const args = ['app/scripts/release.mjs'];
  for (const target of targetList()) args.push('--target', target);
  run(process.execPath, args, { cwd: root });
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}
