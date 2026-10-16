#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { inspectSchema, materialiseSchema } from '../src/schema.mjs';
import { fail } from '../src/errors.mjs';
import { parseProject, parseSchema, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { reportError } from './output.mjs';

export const options = {
  write: { type: 'boolean' }, replace: { type: 'boolean' },
  'schema-path': { type: 'string' }, help: { type: 'boolean', short: 'h' },
};
export const usage = 'Usage: node app/scripts/schema.mjs [project-path] [options]';
export const help = `${usage}

Inspect the effective task schema as readable JSON, including default stores and groups.
${projectHelp}Schema inspection needs no task stores. Output is always JSON (a configuration document).
  --write              Materialise the effective schema at the selected schema path
  --replace            Allow --write to replace an existing schema; preserves custom fields
  --schema-path <file>  Select an existing project-relative schema
  --help, -h           Show this help
Without a schema, --write creates tasks/task-schema.json. Explicit paths must exist.
Task records are never changed. Existing stores must validate before writing.
An empty project can obtain a skeleton; validation needs a task store first.
Run tasks validate after editing the schema to refresh service metadata.
`;

export function main(args) {
  const { values, positionals, tokens } = parseArgs({ args, options, allowPositionals: true, tokens: true });
  if (values.help) { process.stdout.write(help); return; }
  const { project } = parseProject(positionals, usage);
  const schemaPath = parseSchema(values, tokens);
  if (values.replace && !values.write) fail('INVALID_INPUT', '--replace requires --write');
  const schema = values.write ? materialiseSchema(project, { schemaPath, replace: values.replace })
    : inspectSchema(project, { schemaPath });
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
}

if (isMain(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { reportError(error); }
}
