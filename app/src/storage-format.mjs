export function formatValue(value, indent = '') {
  return JSON.stringify(value, null, 2).replaceAll('\n', `\n${indent}`);
}

export function finishStore(source) {
  const end = source.lastIndexOf(0x5d);
  let contentEnd = end;
  while ([0x20, 0x09, 0x0a, 0x0d].includes(source[contentEnd - 1])) contentEnd--;
  const newline = source.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const gap = source.subarray(contentEnd, end);
  return Buffer.concat([
    source.subarray(0, contentEnd), gap.includes(0x0a) ? gap : Buffer.from(newline),
    source.subarray(end), source.at(-1) === 0x0a ? Buffer.alloc(0) : Buffer.from(newline),
  ]);
}
