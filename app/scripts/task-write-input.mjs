import { fail } from '../src/errors.mjs';
import { decodeText, parseJson, readBudget, readJson } from '../src/input.mjs';
import { inputBytes } from '../src/limits.mjs';
import { parseInteger } from './arguments.mjs';

export const taskWriteOptions = {
  json: { type: 'string', multiple: true }, input: { type: 'string', multiple: true },
  title: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' }, blockers: { type: 'string' },
  store: { type: 'string' }, format: { type: 'string', default: 'json' }, help: { type: 'boolean', short: 'h' },
  'schema-path': { type: 'string' },
};
export const taskWriteHelp = `  --title <text>      Replace the title
  --status <status>   Set an exact configured status
  --priority <text>   Replace priority
  --blockers <ids>    Replace blockers with comma-separated positive IDs; '' clears
  --json <object>     JSON input string, exclusive with --input; neither is repeatable
  --input <file|->    Read JSON from a file or stdin (-); no interactive prompts
  --store <name>      Destination store (one); resolve ambiguous destinations
  --schema-path <file> Project-relative schema file; overrides automatic selection
  --format json      Complete resulting task as JSON (default and only format)
  --help, -h          Show this help
Flags may mix with JSON only for disjoint fields. A field mentioned in any patch
operation cannot also be supplied by a flag. Repeated scalar options are errors.
`;

export function checkOptions(tokens) {
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) fail('INVALID_INPUT', `--${token.name} may be supplied only once`);
    seen.add(token.name);
  }
}

export async function readTaskWriteInput(values, updating) {
  const count = (values.json?.length ?? 0) + (values.input?.length ?? 0);
  if (count > 1) fail('INVALID_INPUT', 'supply exactly one --json or --input source; repeated or combined sources are not allowed');
  let input;
  if (values.json !== undefined) {
    const json = values.json[0];
    if (Buffer.byteLength(json, 'utf8') > inputBytes) fail('INPUT_TOO_LARGE', 'task input exceeds the 8 MiB read budget');
    input = parseJson(json, '--json');
  } else if (values.input !== undefined) {
    const source = values.input[0];
    if (source === '-') {
      const chunks = [];
      let length = 0;
      for await (const chunk of process.stdin) {
        length += chunk.length;
        if (length > inputBytes) fail('INPUT_TOO_LARGE', 'task input exceeds the 8 MiB read budget');
        chunks.push(chunk);
      }
      input = parseJson(decodeText(Buffer.concat(chunks, length), 'stdin'), 'stdin');
    } else {
      if (!source) fail('INVALID_INPUT', '--input requires a file path or -');
      input = readJson(source, readBudget());
    }
  } else input = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', 'JSON input must be an object');
  const fields = {};
  for (const name of ['title', 'status', 'priority', 'blockers']) {
    if (values[name] === undefined) continue;
    const collision = updating
      ? ['set', 'add', 'remove'].some((operation) => input[operation] && Object.hasOwn(input[operation], name))
        || (Array.isArray(input.unset) && input.unset.includes(name))
      : Object.hasOwn(input, name);
    if (collision) fail('INVALID_INPUT', `--${name} conflicts with JSON field ${name}`);
    fields[name] = name === 'blockers'
      ? (values[name] === '' ? [] : values[name].split(',').map((id) => parseInteger(id.trim(), '--blockers', 1)))
      : values[name];
  }
  if (!count && !Object.keys(fields).length) fail('INVALID_INPUT', 'supply standard field flags, --json or --input');
  if (!Object.keys(fields).length) return input;
  if (!updating) return { ...input, ...fields };
  // Do not repair a malformed patch while adding convenient flags.
  if (input.set !== undefined && (!input.set || typeof input.set !== 'object' || Array.isArray(input.set))) {
    fail('INVALID_INPUT', 'set must be an object');
  }
  return { ...input, set: { ...input.set, ...fields } };
}
