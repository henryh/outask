#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createTask } from '../src/create.mjs';
import { fail } from '../src/errors.mjs';
import { parseProject, parseSchema, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { checkOptions, taskWriteHelp, readTaskWriteInput, taskWriteOptions } from './task-write-input.mjs';
import { reportError } from './output.mjs';

export const options = taskWriteOptions;
export const usage = 'Usage: node app/scripts/create-task.mjs [project-path] [field options | --json <object> | --input <file|->] [options]';
export const help = `${usage}\n${projectHelp}Create one task. JSON is the full task structure; omitted id is allocated. Project format/default_status settings apply (normally pending, medium priority and empty blockers). Creation sets updated_at; caller-supplied updated_at is rejected.\n${taskWriteHelp}\n`;

export async function main(args) {
  const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, tokens: true, options });
  if (values.help) { process.stdout.write(help); return; }
  checkOptions(tokens);
  const { project } = parseProject(positionals, usage);
  if (values.format !== 'json') fail('INVALID_INPUT', 'format must be json');
  const input = await readTaskWriteInput(values, false);
  const task = createTask(project, input, { store: values.store, schemaPath: parseSchema(values, tokens) });
  process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
}

if (isMain(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { reportError(error); }
}
