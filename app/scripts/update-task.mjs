#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { updateTask } from '../src/update.mjs';
import { fail } from '../src/errors.mjs';
import { parseInteger, parseProject, parseSchema, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { checkOptions, taskWriteHelp, readTaskWriteInput, taskWriteOptions } from './task-write-input.mjs';
import { reportError } from './output.mjs';

export const options = { ...taskWriteOptions, 'if-updated-at': { type: 'string' } };
export const usage = 'Usage: node app/scripts/update-task.mjs [project-path] <id> [field options | --json <object> | --input <file|->] [options]';
export const help = `${usage}\n${projectHelp}Update one retained task. Patch: {set:{field:value},add:{field:[values]},remove:{field:[values]},unset:[fields]}. Each field may occur once. Text, objects and arrays replace completely.\nArray additions deduplicate structurally; removals delete all equal elements. Absent removals and duplicate-only additions are silent no-ops. unset removes optional fields.\nid and updated_at cannot be patched. Actual changes advance updated_at; no-ops preserve it. --if-updated-at checks the exact timestamp, including no-ops.\n${taskWriteHelp}  --if-updated-at <timestamp>  Reject stale edits using the last-read UTC millisecond timestamp\n`;

export async function main(args) {
  const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, tokens: true, options });
  if (values.help) { process.stdout.write(help); return; }
  checkOptions(tokens);
  const { project, id } = parseProject(positionals, usage, true);
  if (values.format !== 'json') fail('INVALID_INPUT', 'format must be json');
  const input = await readTaskWriteInput(values, true);
  const task = updateTask(project, parseInteger(id, 'id', 1), input, {
    store: values.store, ifUpdatedAt: values['if-updated-at'], schemaPath: parseSchema(values, tokens),
  });
  process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
}

if (isMain(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { reportError(error); }
}
