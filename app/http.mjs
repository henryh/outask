import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { inspectBlockers } from './src/blockers.mjs';
import { readConfig } from './src/config.mjs';
import { searchTasks } from './src/search.mjs';
import { inspectSchema } from './src/schema.mjs';
import { errorText, fail } from './src/errors.mjs';
import { parseJson } from './src/input.mjs';
import { selectProject } from './src/projects.mjs';
import { selectSchema } from './src/stores.mjs';
import { countTasks, getTask, getTasks, listTasks } from './src/tasks.mjs';
import { isMain } from './scripts/entry.mjs';
import { reportError } from './scripts/output.mjs';
import { parseInteger, parseProject, parseSchema, parseSelection, projectHelp } from './scripts/arguments.mjs';

export const usage = 'node app/http.mjs [project-path] [--port <port>] [--allow-origin <origin>] [--schema-path <file>]';
export const options = { port: { type: 'string', default: '4318' }, 'allow-origin': { type: 'string', multiple: true }, 'schema-path': { type: 'string' }, help: { type: 'boolean', short: 'h' } };
export const help = `Usage: ${usage}\nServe read-only tasks on 127.0.0.1 (default port 4318; 0 selects a free port).\nRequires TASKS_HTTP_TOKEN (32–512 URL-safe characters).\nRepeat --allow-origin for exact browser origins; see the HTTPS proxy guide.\n--schema-path selects a project-relative schema for this server process.\nGET /tasks/search?query=<text> searches content; GET /tasks/batch?ids=2,1 retrieves ordered IDs.\nBoth support fields, store/group, limit and cursor; search also supports search-fields.\n${projectHelp}HTTP routes and access restrictions: app/HTTP.md\n`;

function tokenDigest(token) {
  return createHash('sha256').update(token).digest();
}

function allowedOrigins(origins) {
  return new Set(origins.map((origin) => {
    let url;
    try { url = new URL(origin); } catch { fail('INVALID_INPUT', '--allow-origin requires an exact HTTP(S) origin'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) {
      fail('INVALID_INPUT', '--allow-origin requires an exact HTTP(S) origin without path or credentials');
    }
    return origin;
  }));
}

function checkFile(path, directory = false) {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())
    || (!directory && stat.nlink > 1)) fail('ACCESS_DENIED', 'HTTP requires ordinary directories and unlinked regular project files');
  return true;
}

// Local owners remain trusted: this is a preflight, not a sandbox against races.
function checkBoundary(root, schemaPath) {
  if (realpathSync(root) !== root) fail('ACCESS_DENIED', 'selected project path changed');
  checkFile(root, true);
  checkFile(schemaPath);
  if (checkFile(join(root, 'tasks'), true)) {
    for (const name of readdirSync(join(root, 'tasks'))) checkFile(join(root, 'tasks', name));
  }
}

function queryOptions(params, allowed) {
  const result = {};
  for (const [name, value] of params) {
    if (!allowed.includes(name) || (Object.hasOwn(result, name) && name !== 'store')) {
      fail('INVALID_INPUT', `unknown or repeated query parameter ${name}`);
    }
    if (name === 'store') (result.store ??= []).push(value);
    else if (name === 'ids') result[name] = value.split(',');
    else if (['limit', 'offset', 'depth'].includes(name)) result[name] = parseInteger(value, name);
    else if (['desc', 'count', 'no-cache'].includes(name)) {
      if (!['true', 'false'].includes(value)) fail('INVALID_INPUT', `${name} must be true or false`);
      result[name] = value === 'true';
    } else if (name === 'filters') result[name] = parseJson(value, 'filters');
    else result[name] = value;
  }
  if (allowed.includes('fields')) {
    Object.assign(result, parseSelection(result));
    delete result.store;
  }
  if (result.ids) result.ids = result.ids.map((id) => parseInteger(id, 'id', 1));
  if (result['search-fields'] !== undefined) {
    result.searchFields = parseSelection({ fields: result['search-fields'] }).fields;
    delete result['search-fields'];
  }
  if (result.desc !== undefined) { result.descending = result.desc; delete result.desc; }
  if (result['no-cache'] !== undefined) { result.noCache = result['no-cache']; delete result['no-cache']; }
  if (result.status !== undefined) {
    if (result.filters !== undefined && !Array.isArray(result.filters)) fail('INVALID_INPUT', 'filters must be an array');
    result.filters = [...(result.filters ?? []), { field: 'status', value: result.status }];
    delete result.status;
  }
  return result;
}

const reading = ['store', 'group', 'fields', 'no-cache'];
function search(root, id, { query, ...options }, config) {
  return searchTasks(root, query, { ...options, slowQueryMs: readConfig(config).slowQueryMs });
}

function batch(root, id, { ids, ...options }) {
  return getTasks(root, ids, options);
}

const routes = [
  { method: 'GET', path: /^\/tasks\/search$/, query: [...reading, 'query', 'search-fields', 'limit', 'cursor'], run: search, cacheRead: true },
  { method: 'GET', path: /^\/tasks\/batch$/, query: [...reading, 'ids', 'limit', 'cursor'], run: batch, cacheRead: true },
  { method: 'GET', path: /^\/schema$/, run: (root, id, query) => inspectSchema(root, query) },
  { method: 'GET', path: /^\/tasks$/, query: [...reading, 'limit', 'offset', 'filters', 'status', 'ids', 'sort', 'desc', 'count'],
    run: (root, id, query) => query.count ? { count: countTasks(root, query) } : listTasks(root, query), cacheRead: true },
  { method: 'GET', path: /^\/tasks\/(\d+)$/, query: reading, run: (root, id, query) => getTask(root, id, query), cacheRead: true },
  { method: 'GET', path: /^\/tasks\/(\d+)\/blockers$/, query: ['limit', 'depth', 'no-cache'],
    run: (root, id, query) => inspectBlockers(root, id, query), cacheRead: true },
];

function errorStatus(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (['ACCESS_DENIED'].includes(code)) return 403;
  if (['TASK_NOT_FOUND', 'PROJECT_NOT_FOUND', 'NOT_FOUND'].includes(code)) return 404;
  if (code === 'METHOD_NOT_ALLOWED') return 405;
  if (code === 'INPUT_TOO_LARGE') return 413;
  if (['TRANSITION_CONFLICT', 'PROJECT_CHANGED', 'PROJECT_BUSY', 'RECOVERY_REQUIRED', 'RECOVERY_CONFLICT', 'ACTIVE_BLOCKERS'].includes(code)) return 409;
  if (['READ_ERROR', 'WRITE_ERROR', 'INTERNAL_ERROR'].includes(code)) return 500;
  return 400;
}

export function createHttpServer(projectPath, { token = process.env.TASKS_HTTP_TOKEN, origins = [], schemaPath, config } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(token)) {
    fail('INVALID_INPUT', 'TASKS_HTTP_TOKEN must contain 32–512 URL-safe characters (letters, digits, _ or -)');
  }
  const expectedToken = tokenDigest(token);
  const allowed = allowedOrigins(origins);
  const root = selectProject({ path: projectPath });
  const schema = selectSchema(root, schemaPath);
  if (schema.explicit && !checkFile(schema.path)) fail('READ_ERROR', `${schema.path}: selected schema does not exist`);
  checkBoundary(root, schema.path);
  return createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 30000, headersTimeout: 10000 }, function handleRequest(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Server', 'outask');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const origin = request.headers.origin;
      response.setHeader('Vary', 'Origin');
      if (allowed.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
      // Preflight carries no task data and browsers cannot send its Bearer token.
      if (request.method !== 'OPTIONS') {
        const authorization = request.headers.authorization;
        const supplied = typeof authorization === 'string' && /^Bearer [A-Za-z0-9_-]{32,512}$/i.test(authorization)
          ? authorization.slice(7) : '';
        if (!timingSafeEqual(expectedToken, tokenDigest(supplied))) {
          response.setHeader('WWW-Authenticate', 'Bearer realm="tasks"');
          fail('UNAUTHORIZED', 'a valid Bearer read token is required');
        }
      }
      if (origin !== undefined && !allowed.has(origin)) fail('ACCESS_DENIED', 'origin is not allowed');
      if (!request.url.startsWith('/') || request.url.startsWith('//')) fail('INVALID_INPUT', 'use an origin-form request target');
      const url = new URL(request.url, 'http://127.0.0.1');
      const candidates = routes.filter((route) => route.path.test(url.pathname));
      if (!candidates.length) fail('NOT_FOUND', 'unknown HTTP route');
      if (request.method === 'OPTIONS') {
        const headers = (request.headers['access-control-request-headers'] ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
        if (origin === undefined || request.headers['access-control-request-method'] !== 'GET'
          || headers.some((name) => name !== 'authorization')) fail('ACCESS_DENIED', 'unsupported CORS preflight');
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization' });
        response.end();
        return;
      }
      const route = candidates.find((route) => route.method === request.method);
      if (!route) {
        response.setHeader('Allow', candidates.map((candidate) => candidate.method).join(', '));
        fail('METHOD_NOT_ALLOWED', 'method is not supported for this route');
      }
      const query = queryOptions(url.searchParams, route.query ?? []);
      const match = route.path.exec(url.pathname);
      const id = match[1] === undefined ? undefined : parseInteger(match[1], 'id', 1);
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) > 0) {
        fail('INVALID_INPUT', 'read requests must not include a body');
      }
      checkBoundary(root, schema.path);
      const advisories = [];
      const result = route.run(root, id, {
        ...query, schemaPath: schema,
        ...(route.cacheRead ? { onAdvisory: (advisory) => advisories.push(advisory) } : {}),
      }, config);
      if (advisories.length) {
        response.setHeader('Warning', advisories.map((advisory) => `199 outask "${advisory.code}: ${advisory.message}"`));
      }
      response.writeHead(200);
      response.end(JSON.stringify(result));
    } catch (error) {
      const code = error.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'INTERNAL_ERROR';
      response.writeHead(errorStatus(code), { Connection: 'close' });
      response.end(JSON.stringify({ error: { code, message: errorText(error.message) } }));
    }
  });
}

export async function main(args, guidance) {
  process.title = 'outask';
  const { values, positionals, tokens } = parseArgs({ args, options, allowPositionals: true, tokens: true });
  if (values.help) { process.stdout.write(help); return; }
  const { project } = parseProject(positionals, usage);
  const port = parseInteger(values.port, '--port', 0, 65535);
  const server = createHttpServer(project, { origins: values['allow-origin'], schemaPath: parseSchema(values, tokens), config: guidance?.config });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  process.stdout.write(`Task HTTP API: http://127.0.0.1:${server.address().port}\n`);
}

if (isMain(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { reportError(error); }
}
