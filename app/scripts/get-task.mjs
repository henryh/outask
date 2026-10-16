#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { getTask } from '../src/tasks.mjs';
import { cacheOptions, commonHelp, commonOptions, parseInteger, parseOutput, parseProject, parseSchema, parseSelection, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { printOutput, reportError } from './output.mjs';

export const options = commonOptions;
export const usage = 'Usage: node app/scripts/get-task.mjs [project-path] <id> [options]';
export const help = `${usage}

${projectHelp}One positional argument is the ID; two are project-path then ID. Reads never change task files.
  --fields <names>     Comma-separated fields; all (default)
${commonHelp}`;

export function main(args) {
  const { values, positionals, tokens } = parseArgs({ args, options: commonOptions, allowPositionals: true, tokens: true });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const selected = parseProject(positionals, usage, true);
  const output = parseOutput(values);
  const selection = parseSelection(values);
  selection.schemaPath = parseSchema(values, tokens);
  selection.refreshMode = 'detached';
  Object.assign(selection, cacheOptions(values));
  const id = parseInteger(selected.id, 'id', 1);
  const task = getTask(selected.project, id, selection);
  const fields = selection.fields && !selection.fields.includes('all') ? selection.fields : Object.keys(task);
  printOutput(task, fields, output);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
