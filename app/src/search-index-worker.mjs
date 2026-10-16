import { refreshSearchIndex } from './search-index.mjs';

try {
  const request = JSON.parse(process.argv[2]);
  refreshSearchIndex(request.projectPath, {
    schemaPath: request.schemaPath, lockClaimed: true, lockToken: request.lockToken,
  });
} catch {
  process.exitCode = 1;
}
