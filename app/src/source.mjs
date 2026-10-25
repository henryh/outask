import parser from 'jsonc-parser';
import { formatValue } from './storage-format.mjs';

const { parseTree } = parser;

export function recordSpans(source) {
  const root = parseTree(source);
  return (root?.children ?? []).map((record) => [record.offset, record.offset + record.length]);
}

export function changeFields(source, fields, removed = [], recordIndent = '') {
  const root = parseTree(source);
  const entries = (root?.children ?? []).map((property) => {
    const [key, value] = property.children;
    return { key: key.value, start: property.offset, valueStart: value.offset, end: value.offset + value.length };
  });
  const kept = entries.filter((item) => !removed.includes(item.key));
  const last = new Map(kept.map((item) => [item.key, item]));
  const parts = kept.map((item) => {
    const originalIndex = entries.indexOf(item);
    const prefixStart = originalIndex === 0 ? 1 : source.indexOf(',', entries[originalIndex - 1].end) + 1;
    const prefix = source.slice(prefixStart, item.start);
    const indent = prefix.match(/\n([ \t]*)$/)?.[1] ?? `${recordIndent}  `;
    const content = Object.hasOwn(fields, item.key) && last.get(item.key) === item
      ? source.slice(item.start, item.valueStart) + formatValue(fields[item.key], indent)
      : source.slice(item.start, item.end);
    const suffix = originalIndex < entries.length - 1 ? source.slice(item.end, source.indexOf(',', item.end)) : '';
    return prefix + content + suffix;
  });
  const trailing = source.slice(entries.at(-1)?.end ?? 1, source.lastIndexOf('}'));
  for (const key of Object.keys(fields).filter((name) => !last.has(name))) {
    const indent = `${trailing.match(/\n([ \t]*)$/)?.[1] ?? recordIndent}  `;
    parts.push(`\n${indent}${JSON.stringify(key)}: ${formatValue(fields[key], indent)}`);
  }
  return `{${parts.join(',')}${trailing}}`;
}

export function removeRecord(source, spans, index) {
  const [start, end] = spans[index];
  if (spans.length === 1) return source.slice(0, start) + source.slice(end);
  if (index < spans.length - 1) return source.slice(0, start) + source.slice(spans[index + 1][0]);
  return source.slice(0, spans[index - 1][1]) + source.slice(end);
}

export function appendRecord(source, record, count) {
  const end = source.lastIndexOf(']');
  return `${source.slice(0, end).trimEnd()}${count ? ',' : ''}\n  ${record}\n${source.slice(end)}`;
}
