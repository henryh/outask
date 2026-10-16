#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fail } from '../src/errors.mjs';
import { defaultLimit, maxLimit, responseBytes } from '../src/limits.mjs';
import { textBuffer } from '../src/response.mjs';
import { getTasks } from '../src/tasks.mjs';
import {
  cacheOptions, commonHelp, commonOptions, parseInteger, parseOutput, parseProject, parseSchema, parseSelection, projectHelp,
} from './arguments.mjs';
import { nextCommand } from './continuation.mjs';
import { isMain } from './entry.mjs';
import { formatOutput, reportError } from './output.mjs';

export const options = {
  ...commonOptions,
  format: { type: 'string' },
  id: { type: 'string', multiple: true }, cursor: { type: 'string' },
  limit: { type: 'string', default: String(defaultLimit) },
};
export const usage = 'Usage: node app/scripts/get-tasks.mjs [project-path] --id <id> [--id <id> ...] [options]';
export const help = `${usage}

${projectHelp}Reads never change task files.
  --id <id>           Requested task ID; repeat in the required result order
  --fields <names>    Comma-separated result fields (default: id,title,status)
${commonHelp.replace('  --fields <names>     Comma-separated field names\n', '')}  --limit <n>         Requested IDs per page from 1 to 50 (default: 10)
  --cursor <cursor>   Continue the same ID request from an opaque cursor
`;

function pageInfo(page, args, tokens, invocation) {
  const buffer = textBuffer();
  buffer.add(`Retrieved ${page.tasks.length} task${page.tasks.length === 1 ? '' : 's'}.\n`);
  if (page.not_found.length) buffer.add(`Missing IDs: ${page.not_found.join(', ')}\n`);
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
    if (text === undefined) fail('OUTPUT_TOO_LARGE', 'rendered batch response exceeds 32 KiB; select fewer --fields');
    process.stdout.write(text);
    return;
  }
  const info = pageInfo(page, args, tokens, invocation);
  if (info === undefined) fail('OUTPUT_TOO_LARGE', 'batch guidance exceeds 32 KiB; request fewer IDs');
  const text = formatOutput(page.tasks, page.fields, output, responseBytes - Buffer.byteLength(info, 'utf8'));
  if (text === undefined) fail('OUTPUT_TOO_LARGE', 'rendered batch response exceeds 32 KiB; select fewer --fields');
  process.stdout.write(text);
  process.stderr.write(info);
}

export function main(args, guidance) {
  const { values, positionals, tokens } = parseArgs({ args, options, allowPositionals: true, tokens: true });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const { project } = parseProject(positionals, usage);
  if (!values.id?.length) fail('INVALID_INPUT', '--id must be supplied at least once');
  values.format ??= 'table';
  const output = parseOutput(values);
  const selection = parseSelection(values);
  const ids = values.id.map((value) => parseInteger(value, '--id', 1));
  const page = getTasks(project, ids, {
    ...selection,
    limit: parseInteger(values.limit, '--limit', 1, maxLimit), cursor: values.cursor,
    schemaPath: parseSchema(values, tokens), refreshMode: 'detached',
    ...cacheOptions(values),
  });
  showPage(page, output, guidance?.args ?? args, guidance?.tokens ?? tokens, guidance?.invocation);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
