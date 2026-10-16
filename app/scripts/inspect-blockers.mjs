#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { defaultDepth, inspectBlockers, maxDepth } from '../src/blockers.mjs';
import { fail } from '../src/errors.mjs';
import { defaultLimit, maxLimit } from '../src/limits.mjs';
import { textBuffer } from '../src/response.mjs';
import { cacheOptions, parseInteger, parseProject, parseSchema, projectHelp } from './arguments.mjs';
import { isMain } from './entry.mjs';
import { formatOutput, reportError } from './output.mjs';

export const options = {
  depth: { type: 'string', default: String(defaultDepth) },
  limit: { type: 'string', default: String(defaultLimit) },
  format: { type: 'string', default: 'text' }, help: { type: 'boolean', short: 'h' },
  'schema-path': { type: 'string' },
  'no-cache': { type: 'boolean' },
};
export const usage = 'Usage: node app/scripts/inspect-blockers.mjs [project-path] <id> [options]';
export const help = `${usage}

${projectHelp}One positional argument is the ID; two are project-path then ID.
Inspect one Active task. Reads only Active stores and never changes task files.
Direct active blocker IDs and eligibility remain exact when the graph is truncated.
  --depth <n>         Maximum graph hops, 1 to ${maxDepth} (default: ${defaultDepth})
  --limit <n>         Maximum graph edges, 1 to ${maxLimit} (default: ${defaultLimit})
  --format <format>   text (default) or json
  --schema-path <file> Project-relative schema file; overrides automatic selection
  --no-cache          Read authoritative JSON without opening or refreshing the SQLite cache
  --help, -h          Show this help

Cycles are result diagnostics. An incomplete check reports cycleStatus: unknown.
Use list-tasks.mjs and get-task.mjs to choose work and read task details.
`;

function humanText(result) {
  const { id, eligible, activeBlockers, graph } = result;
  const buffer = textBuffer();
  buffer.add(`task: ${id}\neligible: ${eligible ? 'yes' : 'no'}\n`);
  buffer.add(`active blockers: ${activeBlockers.length ? activeBlockers.join(', ') : 'none'}\n`);
  const cycle = graph.cycleStatus === 'found' ? graph.cycle.join(' -> ')
    : graph.cycleStatus === 'unknown' ? 'unknown (graph is truncated)' : 'none';
  buffer.add(`cycle: ${cycle}\ngraph: ${graph.edges.length} edges (depth ${graph.depth}, limit ${graph.limit})\n`);
  for (const { from, to } of graph.edges) buffer.add(`  ${from} -> ${to}\n`);
  const reasons = Object.keys(graph.truncated).filter((key) => graph.truncated[key]);
  buffer.add(`truncated: ${reasons.length ? reasons.join(', ') : 'no'}\n`);
  return buffer.finish();
}

export function main(args) {
  const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, options, tokens: true });
  if (values.help) {
    process.stdout.write(help);
    return;
  }
  const selected = parseProject(positionals, usage, true);
  if (!['text', 'json'].includes(values.format)) fail('INVALID_INPUT', 'format must be text or json');
  const id = parseInteger(selected.id, 'id', 1);
  const result = inspectBlockers(selected.project, id, {
    depth: parseInteger(values.depth, '--depth', 1, maxDepth),
    limit: parseInteger(values.limit, '--limit', 1, maxLimit),
    schemaPath: parseSchema(values, tokens),
    refreshMode: 'detached',
    ...cacheOptions(values),
  });
  const output = values.format === 'json' ? formatOutput(result, [], { format: 'json' }) : humanText(result);
  if (output === undefined) fail('OUTPUT_TOO_LARGE', 'rendered blocker result exceeds 32 KiB; use --format json');
  process.stdout.write(output);
}

if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}
