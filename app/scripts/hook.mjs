#!/usr/bin/env node
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fail } from '../src/errors.mjs';
import { parseProject, parseSchema, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { reportError } from './output.mjs';

export const options = {
  install: { type: 'boolean' }, remove: { type: 'boolean' }, 'schema-path': { type: 'string' }, help: { type: 'boolean', short: 'h' },
};
export const usage = 'Usage: node app/scripts/hook.mjs [project-path] --install|--remove';
export const help = `${usage}\n${projectHelp}Explicitly install/remove a POSIX pre-commit hook at the selected Git root.\nChecks working-tree files, NOT the index; refreshes service metadata without staging it.\nExisting hooks and shared locations require manual integration; see the diagnostic.\nHook management leaves task stores/service metadata untouched. --schema-path is persisted in the generated validator command.
Repeat installation/removal is safe. Keep this checkout and Node on PATH available.\n`;
const validator = fileURLToPath(new URL('./validate-task-stores.mjs', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
function inspect(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
function git(project, args) {
  const result = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' });
  if (result.error || result.status !== 0) fail('HOOK_UNAVAILABLE', `Git could not resolve hooks: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trimEnd();
}
function inside(root, path) {
  const tail = relative(root, path);
  return tail !== '..' && !tail.startsWith('../') && !isAbsolute(tail);
}

export function main(args) {
  const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, options, tokens: true });
  if (values.help) { process.stdout.write(help); return; }
  if (Boolean(values.install) === Boolean(values.remove)) fail('INVALID_INPUT', usage);
  const { project: selected } = parseProject(positionals, usage);
  const project = realpathSync(selected);
  const schemaPath = parseSchema(values, tokens);
  const schemaOption = schemaPath === undefined ? '' : ` --schema-path ${quote(schemaPath)}`;
  const command = `node ${quote(validator)} ${quote(project)}${schemaOption}`;
  const manual = (reason, shared = false) => {
    const invocation = shared ? `node ${quote(validator)} "$(git rev-parse --show-toplevel)"${schemaOption}` : command;
    fail('HOOK_CONFLICT', `${reason}. No hook changed. In your existing hook/manager, run:\n${invocation} || exit $?\nKeep existing checks and propagate failures; remove that line manually to undo integration.`);
  };
  const root = realpathSync(git(project, ['rev-parse', '--show-toplevel']));
  if (root !== project) manual('Select the Git root for automatic installation; nested projects require manual integration');
  const hook = resolve(project, git(project, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']), 'pre-commit');
  // A configured directory may be shared by other repositories, including through a symlink.
  let ancestor = dirname(hook);
  while (!inspect(ancestor)) ancestor = dirname(ancestor);
  if (!inside(root, hook) || !inside(root, realpathSync(ancestor))) manual(`Shared/external hook location ${hook}`, true);
  if (values.install && git(project, ['worktree', 'list', '--porcelain', '-z'])
    .split('\0').filter((field) => field.startsWith('worktree ')).length > 1) {
    manual('Repository has linked worktrees; automatic hook installation is unavailable', true);
  }
  // Git may share this hook with a worktree created after installation.
  const content = `#!/bin/sh\n# task-tracker: working-tree validation; index is not validated or staged.
root=$(git rev-parse --show-toplevel) || exit $?
if [ "$root" != ${quote(project)} ]; then
  printf '%s\\n' 'HOOK_CONFLICT: This hook belongs to another working tree. Integrate validation for the invoking worktree manually.' >&2
  exit 1
fi
exec ${command}\n`;
  const present = inspect(hook);
  if (present && (!present.isFile() || readFileSync(hook, 'utf8') !== content)) manual(`Existing or modified hook at ${hook}`);
  if (values.remove) {
    if (present) unlinkSync(hook);
    process.stdout.write(`${present ? 'Removed' : 'Already absent'}: ${hook}.\n`);
  } else {
    if (!present) {
      mkdirSync(dirname(hook), { recursive: true });
      writeFileSync(hook, content, { flag: 'wx', mode: 0o755 });
    } else chmodSync(hook, 0o755);
    process.stdout.write(`${present ? 'Already installed' : 'Installed'}: ${hook}. Checks working-tree files, not staged data; stage refreshed service metadata yourself.\n`);
  }
}

if (isMain(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { reportError(error); }
}
