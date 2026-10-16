import { relative } from 'node:path';
import { textBuffer } from '../src/response.mjs';

function quoteArgument(buffer, value) {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return buffer.add(value);
  if (!buffer.add("'")) return false;
  const parts = value.split("'");
  for (let index = 0; index < parts.length; index++) {
    if (index && !buffer.add("'\\''")) return false;
    if (!buffer.add(parts[index])) return false;
  }
  return buffer.add("'");
}

export function nextCommand(args, tokens, option, value, invocation) {
  const omitted = new Set();
  for (const token of tokens) {
    if (token.kind !== 'option' || token.name !== option) continue;
    omitted.add(token.index);
    if (!token.inlineValue) omitted.add(token.index + 1);
  }
  const script = relative(process.cwd(), process.argv[1]);
  const words = [...(invocation ?? ['node', script.startsWith('-') ? `./${script}` : script]),
    `--${option}`, String(value), ...args.filter((_, index) => !omitted.has(index))];
  const buffer = textBuffer();
  for (let index = 0; index < words.length; index++) {
    if (index && !buffer.add(' ')) return undefined;
    if (!quoteArgument(buffer, words[index])) return undefined;
  }
  return buffer.finish();
}
