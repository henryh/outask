#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fail } from '../src/errors.mjs';
import { validateProject } from '../src/validation.mjs';
import { parseProject, parseSchema, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { reportError } from './output.mjs';

export const options = {
  format: { type: 'string', default: 'text' }, 'schema-path': { type: 'string' }, help: { type: 'boolean', short: 'h' },
};
export const usage = 'Usage: node app/scripts/validate-task-stores.mjs [project-path] [--format text|json]';
export const help = `${usage}\n${projectHelp}Validate all retained stores and refresh tasks/.task-tracker.json after success.\nTask files remain unchanged. --schema-path selects a project-relative schema file.\n`;

export function main(args) {
  const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, options, tokens: true });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const { project } = parseProject(positionals, usage);
  if (!['text', 'json'].includes(values.format)) fail('INVALID_INPUT', usage);
  const result = validateProject(project, { schemaPath: parseSchema(values, tokens) });
  process.stdout.write(values.format === 'json' ? `${JSON.stringify(result)}\n`
    : `Validation passed (${result.tasks} tasks, ${result.stores} stores). Counter: ${result.counter}; service state ${result.refreshed ? 'refreshed' : 'unchanged'}.\n`);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
