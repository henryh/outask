#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readConfig } from '../src/config.mjs';
import { fail } from '../src/errors.mjs';
import { defaultLimit, maxLimit, responseBytes } from '../src/limits.mjs';
import { textBuffer } from '../src/response.mjs';
import { defaultSearchFields, searchTasks } from '../src/search.mjs';
import { cacheOptions, commonHelp, commonOptions, parseInteger, parseOutput, parseProject, parseSchema, parseSelection, projectHelp } from './arguments.mjs';
import { nextCommand } from './continuation.mjs';
import { isMain } from './entry.mjs';
import { formatOutput, reportError } from './output.mjs';

export const options = {
  ...commonOptions,
  format: { type: 'string' },
  'search-fields': { type: 'string' }, cursor: { type: 'string' },
  limit: { type: 'string', default: String(defaultLimit) },
};
export const usage = 'Usage: node app/scripts/search-tasks.mjs [project-path] <query> [options]';
export const help = `${usage}

${projectHelp}Reads never change task files.
  --search-fields <names>  Comma-separated fields searched with OR semantics
                           (default: ${defaultSearchFields.join(',')})
  --fields <names>     Comma-separated result fields (default: id,title,status)
${commonHelp.replace('  --fields <names>     Comma-separated field names\n', '').replace('text (default), table, json or ids', 'table (default), text, json or ids')}  --limit <n>         Page size from 1 to 50 (default: 10); responses up to 32 KiB
  --cursor <cursor>    Continue the same search from an opaque cursor
`;

function splitNames(value, option) {
  const names = value.split(',').map((name) => name.trim());
  if (names.some((name) => !name)) fail('INVALID_INPUT', `${option} field names cannot be empty`);
  return names;
}

function pageInfo(page, args, tokens, invocation) {
  const buffer = textBuffer();
  buffer.add(`Showing ${page.tasks.length} search match${page.tasks.length === 1 ? '' : 'es'}.\n`);
  for (const advisory of page.advisories ?? []) {
    buffer.add(`Advisory ${advisory.code}: ${advisory.message} (${advisory.elapsed_ms} ms)\n`);
  }
  if (page.hasMore) {
    const command = nextCommand(args, tokens, 'cursor', page.next_cursor, invocation);
    if (command === undefined) return undefined;
    buffer.add(`Next page: ${command}\n`);
  }
  return buffer.finish();
}

function showPage(page, output, args, tokens, invocation) {
  if (output.format === 'json') {
    const text = formatOutput(page, page.fields, output);
    if (text === undefined) fail('OUTPUT_TOO_LARGE', 'rendered search response exceeds 32 KiB; select fewer --fields or --search-fields');
    process.stdout.write(text);
    return;
  }
  const info = pageInfo(page, args, tokens, invocation);
  if (info === undefined) fail('OUTPUT_TOO_LARGE', 'search guidance exceeds 32 KiB; shorten the query or field selections');
  const displayFields = [...page.fields, 'matched_fields', 'snippets'];
  const text = formatOutput(page.tasks, displayFields, output, responseBytes - Buffer.byteLength(info, 'utf8'));
  if (text === undefined) fail('OUTPUT_TOO_LARGE', 'rendered search response exceeds 32 KiB; select fewer --fields or --search-fields');
  process.stdout.write(text);
  process.stderr.write(info);
}

export function main(args, guidance) {
  const { values, positionals, tokens } = parseArgs({ args, options, allowPositionals: true, tokens: true });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const { project, id: query } = parseProject(positionals, usage, true);
  values.format ??= 'table';
  const output = parseOutput(values);
  const selection = parseSelection(values);
  const queryOptions = {
    ...selection,
    searchFields: values['search-fields'] === undefined
      ? defaultSearchFields : splitNames(values['search-fields'], '--search-fields'),
    limit: parseInteger(values.limit, '--limit', 1, maxLimit), cursor: values.cursor,
    schemaPath: parseSchema(values, tokens),
    slowQueryMs: readConfig(guidance?.config).slowQueryMs,
    refreshMode: 'detached',
    ...cacheOptions(values),
  };
  const page = searchTasks(project, query, queryOptions);
  showPage(page, output, guidance?.args ?? args, guidance?.tokens ?? tokens, guidance?.invocation);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
