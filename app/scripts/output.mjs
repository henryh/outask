import { errorText, fail } from '../src/errors.mjs';
import { ownValue } from '../src/fields.mjs';
import { responseBytes } from '../src/limits.mjs';
import { jsonText, textBuffer } from '../src/response.mjs';

function valueText(value) {
  if (value === undefined) return '(unset)';
  return typeof value === 'object' ? jsonText(value, 0) : String(value);
}

function tableCell(value, maxWidth) {
  const text = [...valueText(value).replace(/\s+/g, ' ')];
  return text.length > maxWidth ? `${text.slice(0, maxWidth - 1).join('')}…` : text.join('');
}

function formatTable(records, fields, maxWidth, buffer) {
  if ((fields.length - 1) * 2 * (records.length + 1) > responseBytes) return undefined;
  const rows = [fields, ...records.map((record) => fields.map((field) => ownValue(record, field)))]
    .map((row) => row.map((value) => tableCell(value, maxWidth)));
  const widths = fields.map((_, column) => rows.reduce((width, row) => Math.max(width, [...row[column]].length), 0));
  for (const row of rows) {
    for (let column = 0; column < fields.length; column++) {
      if (!buffer.add(row[column])) return undefined;
      if (column < fields.length - 1 && !buffer.spaces(widths[column] - [...row[column]].length + 2)) return undefined;
    }
    if (!buffer.add('\n')) return undefined;
  }
  return buffer.finish();
}

function formatText(records, fields, buffer) {
  for (let index = 0; index < records.length; index++) {
    if (index && !buffer.add('\n')) return undefined;
    for (const field of fields) {
      if (!buffer.add(field) || !buffer.add(': ') || !buffer.add(valueText(ownValue(records[index], field)))
        || !buffer.add('\n')) return undefined;
    }
  }
  return buffer.finish();
}

export function formatOutput(data, fields, { format, maxWidth }, ceiling = responseBytes) {
  if (format === 'json') {
    const json = jsonText(data, 2, ceiling - 1);
    return json === undefined ? undefined : `${json}\n`;
  }
  const records = Array.isArray(data) ? data : [data];
  const buffer = textBuffer(ceiling);
  if (format === 'ids') {
    buffer.add(`${records.map((record) => record.id).join(' ')}\n`);
  } else if (!records.length) buffer.add('no tasks on this page\n');
  else if (format === 'table') return formatTable(records, fields, maxWidth, buffer);
  else return formatText(records, fields, buffer);
  return buffer.finish();
}

export function printOutput(data, fields, output) {
  const text = formatOutput(data, fields, output);
  if (text === undefined) fail('OUTPUT_TOO_LARGE', 'rendered response exceeds 32 KiB; select fewer --fields or a smaller --max-width');
  process.stdout.write(text);
}

export function reportError(error) {
  const code = error.code?.startsWith('ERR_PARSE_ARGS') ? 'INVALID_INPUT' : (error.code ?? 'INVALID_INPUT');
  process.stderr.write(`${code}: ${errorText(error.message)}\n`);
  process.exitCode = 1;
}
