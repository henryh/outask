export function fail(code, message) {
  const error = new Error(errorText(message));
  error.code = code;
  throw error;
}

export function errorText(message) {
  let bytes = 0;
  let end = 0;
  for (const character of message) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > 2048) return `${message.slice(0, end)}…`;
    end += character.length;
  }
  return message;
}
