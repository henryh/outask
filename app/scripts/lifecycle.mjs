import { parseArgs } from 'node:util';
import { deleteTask, transitionTask } from '../src/transition.mjs';
import { fail } from '../src/errors.mjs';
import { parseInteger, parseProject, parseSchema, projectHelp } from './arguments.mjs';
import { checkOptions } from './task-write-input.mjs';
import { reportError } from './output.mjs';

export function lifecycleCommand(deleting) {
  const command = deleting ? 'delete-task' : 'transition-task';
  const statusUsage = deleting ? '[--status <Archive-status>] ' : '--status <status> ';
  const usage = `Usage: node app/scripts/${command}.mjs [project-path] <id> ${statusUsage}[--store <name>] [--if-updated-at <timestamp>] [--format json]`;
  const options = {
    'if-updated-at': { type: 'string' }, store: { type: 'string' },
    status: { type: 'string' },
    'schema-path': { type: 'string' },
    format: { type: 'string', default: 'json' }, help: { type: 'boolean', short: 'h' },
  };
  const help = `${usage}\n${projectHelp}Move one retained task and return the complete task as JSON. --if-updated-at optionally checks the exact current timestamp under the write lock.\n${deleting ? 'Delete retains the task in Archive; choose --status when several Archive statuses exist.' : 'Any configured status is allowed; use an Active status to restore retained history.'}\nActual changes advance updated_at; no-ops preserve it. --if-updated-at expects a canonical UTC millisecond value, e.g. 2026-09-19T12:00:00.000Z.\nUnknown --status values report configured status choices. Status names are case-sensitive.\nConfigured destination files must exist. Use --store for ambiguous destinations. --schema-path selects a project-relative schema file. Run validation to recover interrupted moves.\n`;
  function main(args) {
    const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, tokens: true, options });
    if (values.help) { process.stdout.write(help); return; }
    checkOptions(tokens);
    const { project, id } = parseProject(positionals, usage, true);
    if (values.format !== 'json') fail('INVALID_INPUT', 'format must be json');
    const settings = { ifUpdatedAt: values['if-updated-at'], store: values.store, schemaPath: parseSchema(values, tokens) };
    const result = deleting ? deleteTask(project, parseInteger(id, 'id', 1), { ...settings, status: values.status })
      : transitionTask(project, parseInteger(id, 'id', 1), values.status, settings);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return { usage, options, help, main };
}

export function runLifecycle(deleting) {
  try { lifecycleCommand(deleting).main(process.argv.slice(2)); } catch (error) { reportError(error); }
}
