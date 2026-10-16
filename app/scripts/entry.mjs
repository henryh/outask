import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(url) {
  return process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(url);
}
