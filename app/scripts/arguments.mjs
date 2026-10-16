import { fail } from '../src/errors.mjs';

export const commonOptions = {
  store: { type: 'string', multiple: true }, group: { type: 'string' },
  fields: { type: 'string' }, format: { type: 'string', default: 'text' },
  'max-width': { type: 'string', default: '60' }, 'schema-path': { type: 'string' },
  'no-cache': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export const commonHelp = `  --store <name>       Explicit store (repeatable); all includes history
  --group <group>      Active (default), Done or Archive; exclusive with --store
  --format <format>    text (default), table, json or ids
  --max-width <n>      Table cell width, at least 10 (default: 60)
  --schema-path <file> Project-relative schema file; overrides automatic selection
  --no-cache          Read authoritative JSON without opening or refreshing the SQLite cache
  --help, -h          Show this help
`;

export function parseSchema(values, tokens = []) {
  if (tokens.filter((token) => token.kind === 'option' && token.name === 'schema-path').length > 1) {
    fail('INVALID_INPUT', '--schema-path may be supplied only once');
  }
  if (values['schema-path'] === '') fail('INVALID_INPUT', '--schema-path must not be empty');
  return values['schema-path'];
}

export const projectHelp = `Omit project-path to use the current working directory, or supply one directory explicitly.
Project operations prepare missing service metadata; reads require task stores.
Mutations create standard stores when needed; no other directories are searched.
Use --schema-path for a project-relative schema; automatic selection uses tasks/task-schema.json, then legacy docs/task-schema.json.
`;

export function parseProject(positionals, usage, withId = false) {
  const required = withId ? 1 : 0;
  if (positionals.length < required || positionals.length > required + 1) fail('INVALID_INPUT', usage);
  return {
    project: positionals.length === required ? process.cwd() : positionals[0],
    id: withId ? positionals.at(-1) : undefined,
  };
}

export function parseInteger(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) {
    fail('INVALID_INPUT', `${name} expects a safe integer from ${minimum} to ${maximum}`);
  }
  return Number(value);
}

function splitNames(value) {
  const names = value.split(',').map((name) => name.trim());
  if (names.some((name) => !name)) fail('INVALID_INPUT', 'field and store names cannot be empty');
  return names;
}

export function parseSelection(values) {
  const stores = (values.store ?? []).flatMap(splitNames);
  const fields = values.fields === undefined ? undefined : splitNames(values.fields);
  // An IDs format is itself an explicit projection, regardless of --fields.
  return { stores, group: values.group, fields: values.format === 'ids' ? ['id'] : fields };
}

export function parseOutput(values) {
  if (!['text', 'table', 'json', 'ids'].includes(values.format)) {
    fail('INVALID_INPUT', 'format must be text, table, json or ids');
  }
  return { format: values.format, maxWidth: parseInteger(values['max-width'], '--max-width', 10) };
}

export function cacheOptions(values) {
  return {
    noCache: values['no-cache'] ?? false,
    onAdvisory(advisory) {
      process.stderr.write(`Advisory ${advisory.code}: ${advisory.message}\n`);
    },
  };
}
