#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fail } from '../src/errors.mjs';
import { defaultLimit, maxLimit, responseBytes } from '../src/limits.mjs';
import { updatePage } from '../src/pagination.mjs';
import { textBuffer } from '../src/response.mjs';
import { countTasks, listTasks } from '../src/tasks.mjs';
import { cacheOptions, commonHelp, commonOptions, parseInteger, parseOutput, parseProject, parseSchema, parseSelection, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { nextCommand } from './continuation.mjs';
import { formatOutput, printOutput, reportError } from './output.mjs';

export const options = {
  ...commonOptions,
  format: { type: 'string' }, full: { type: 'boolean' },
  where: { type: 'string', multiple: true }, status: { type: 'string' },
  id: { type: 'string', multiple: true }, sort: { type: 'string', default: 'id' },
  desc: { type: 'boolean', default: false }, limit: { type: 'string', default: String(defaultLimit) },
  offset: { type: 'string', default: '0' }, count: { type: 'boolean', default: false },
};
export const usage = 'Usage: node app/scripts/list-tasks.mjs [project-path] [options]';
export const help = `${usage}

${projectHelp}Reads never change task files.
  --fields <names>     Comma-separated fields; id,title,status (default), or all
  --full              All fields; text unless --format is supplied; excludes --fields/ids
${commonHelp.replace('text (default), table, json or ids', 'table (default), text, json or ids')}  --status <status>   Exact, case-sensitive status filter
  --where <field>=<value>  Repeatable AND filters; status is exact
  --id <id>           Repeatable ID filter (OR within IDs)
  --sort <field>      id (default); priority orders high, medium, low
  --desc             Reverse primary sort; ties always use ascending ID
  --limit <n>         Page size from 1 to 50 (default: 10); responses up to 32 KiB
  --offset <n>        Skip matching records (default: 0)
  --count            Print match count, ignoring pagination
`;

function parseFilters(values) {
  const filters = (values.where ?? []).map((expression) => {
    const separator = expression.indexOf('=');
    if (separator < 1) fail('INVALID_INPUT', '--where expects <field>=<value>');
    return { field: expression.slice(0, separator), value: expression.slice(separator + 1) };
  });
  if (values.status !== undefined) filters.push({ field: 'status', value: values.status });
  return filters;
}

function parseQuery(values) {
  return {
    ...parseSelection(values), filters: parseFilters(values),
    ids: (values.id ?? []).map((id) => parseInteger(id, '--id', 1)),
    sort: values.sort, descending: values.desc,
    limit: parseInteger(values.limit, '--limit', 1, maxLimit), offset: parseInteger(values.offset, '--offset'),
    refreshMode: 'detached',
    ...cacheOptions(values),
  };
}

function pageInfo(page, args, tokens, invocation) {
  const range = page.tasks.length ? `records ${page.offset + 1}-${page.offset + page.tasks.length}` : 'no records';
  const buffer = textBuffer();
  buffer.add(`Showing ${range} of ${page.total} matches.\n`);
  if (page.hasMore) {
    const command = nextCommand(args, tokens, 'offset', page.nextOffset, invocation);
    if (command === undefined) return undefined;
    buffer.add(`Next page: ${command}\n`);
  }
  return buffer.finish();
}

function showPage(page, output, args, tokens, invocation) {
  if (output.format === 'json') {
    printOutput(page, page.fields, output);
    return;
  }
  while (true) {
    const info = pageInfo(page, args, tokens, invocation);
    if (info === undefined) fail('OUTPUT_TOO_LARGE', 'page guidance exceeds 32 KiB; shorten field selections or filters');
    const text = formatOutput(page.tasks, page.fields, output, responseBytes - Buffer.byteLength(info, 'utf8'));
    if (text !== undefined) {
      process.stdout.write(text);
      process.stderr.write(info);
      return;
    }
    if (page.tasks.length <= 1) {
      fail('OUTPUT_TOO_LARGE', 'first task cannot fit in a rendered 32 KiB page; select fewer --fields, a smaller --max-width or shorter filters');
    }
    page.tasks.pop();
    updatePage(page);
  }
}

export function main(args, guidance) {
  const { values, positionals, tokens } = parseArgs({ args, options, allowPositionals: true, tokens: true });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const { project } = parseProject(positionals, usage);
  if (values.full && (values.fields !== undefined || values.format === 'ids')) {
    fail('INVALID_INPUT', '--full cannot be combined with --fields or --format ids');
  }
  values.format ??= values.full ? 'text' : 'table';
  if (values.full) values.fields = 'all';
  const output = parseOutput(values);
  const query = parseQuery(values);
  query.schemaPath = parseSchema(values, tokens);
  if (values.count) process.stdout.write(`${countTasks(project, query)}\n`);
  else showPage(listTasks(project, query), output, guidance?.args ?? args, guidance?.tokens ?? tokens, guidance?.invocation);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
