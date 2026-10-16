# Read-only HTTP API

Outask AI's HTTP adapter is a source-level, read-only interface for external
local clients. Release integration is unfinished and unverified.

The independent HTTP adapter uses the Node.js range declared in
`app/package.json`, built-in HTTP and the same read operations and JSON files
as the CLI. It
needs no dependencies, database, MCP process, frontend or container. One process
serves **one project selected at startup**, protected by a shared Bearer read
token. Possession of that token grants access to all retained tasks and fields
in the selected project. There are no HTTP task mutations or validation route.

## Startup and token rotation

Generate a random token in the server environment, outside task files and Git:

```bash
export TASKS_HTTP_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")"
tasks http --port 4318
# Configured name and optional registry, as with other CLI commands:
tasks http --project example --config /absolute/path/to/config.json
# Select a non-default project schema at startup:
tasks http --project example --schema-path config/tasks.json
# Standalone adapter (positional path or current directory):
node app/http.mjs /absolute/path/to/project --port 4318
```

Run one startup command at a time. `TASKS_HTTP_TOKEN` is mandatory: 32–512 ASCII
letters, digits, `_` or `-`, without whitespace. Use a randomly generated value;
length validation cannot establish randomness. Tokens are not CLI arguments,
printed at startup or included in authentication errors. The server compares
fixed-size token digests with Node's constant-time comparison.

CLI positional paths, `--project-path`, `--project`, `--config`, current-directory
selection, registry environment variables and ambiguous-name errors match other
commands. `--schema-path` independently selects a project-relative schema for
the lifetime of the process; it is not the `--config` project registry. Selectors
cannot be combined. `--port` defaults to 4318; 0 requests an
available port. Startup prints the actual loopback URL. Stop with Ctrl-C. Help
and invalid startup syntax do not prepare storage. Requests cannot select a
project, registry or schema path; use another process/port for another selection.

To rotate access, stop the process, replace `TASKS_HTTP_TOKEN` in its server
environment (or protected service environment configuration), then restart it
with the same project/port. Distribute the replacement to authorised clients
through your secret channel. Verify the old token receives 401 and the new one
200. Changing the environment without restarting does not replace a running
server's token. There is no token-management/admin HTTP API or per-user identity.

## Requests and results

Every actual read requires `Authorization: Bearer <token>`. Missing, malformed
or wrong tokens receive 401 with `WWW-Authenticate: Bearer realm="tasks"`.
Authentication and route/access checks precede shared task reads. Successful
reads return 200 and the core JSON result directly. Reads have no body. Unknown
or repeated query keys are errors, except repeatable `store`. Parameters and
statuses are case-sensitive.

| Method and route | Query | Result |
| --- | --- | --- |
| GET `/tasks` | List options below | Bounded page, or `{ "count": n }` |
| GET `/tasks/search` | `query`, `search-fields`, `fields`, `store`, `group`, `limit`, `cursor` | Shared search page with matches and snippets |
| GET `/tasks/batch` | `ids`, `fields`, `store`, `group`, `limit`, `cursor` | Ordered task page with `not_found` |
| GET `/tasks/:id` | `store`, `group`, `fields` | Task, all fields by default |
| GET `/tasks/:id/blockers` | `depth`, `limit` | Exact Active blockers and bounded graph |
| GET `/schema` | None | Complete effective schema JSON, matching `tasks schema` |

All `/tasks` routes accept `no-cache=true|false`. True has precedence over the
project's `search.mode`, reads authoritative JSON and never opens or refreshes
the SQLite cache. `/schema` is not a task-data read and does not accept it.

Schema inspection uses the startup-selected schema and the same token/access
checks as task reads. It works before the first task store exists and prepares
only normal missing service metadata. The result includes defaults and custom
configuration under the [schema contract](README.md#inspecting-and-materialising-the-task-schema),
with the shared 32 KiB response ceiling. There is no HTTP schema materialisation
or replacement route: use CLI/MCP for writes.

IDs are positive safe integers. POST, PATCH and DELETE are not supported.
`/validate` and `/tasks/:id/transition` do not exist. There is no upload,
input-file argument, static file server, project enumeration or Git route.

List queries support:

- `store=active&store=done` or `store=all` for explicit history access;
  `group=Active|Done|Archive` is exclusive with store. Default: Active.
- `fields=id,title,status` (list default); `fields=all` for full projection.
- `limit=10` (1–50), `offset=0`, `sort=id`, `desc=true|false`,
  `count=true|false`, `ids=1,2` and exact `status=pending`.
- `filters` as a URL-encoded JSON array of `{ "field": "title", "value": "word" }`.
  Field/value semantics match CLI filtering; non-status text uses substring matching.

List pages include `tasks`, `total`, `offset`, `limit`, `stores`, `fields`,
`hasMore` and `nextOffset`; follow `nextOffset` until `hasMore` is false.

Search requires a non-empty `query` and performs a case-insensitive literal
substring match. `search-fields=title,scope` selects fields with OR semantics;
the default is `title,scope,acceptance,dependencies,sources,notes`. Nested scalar
values are searched. Results add `matched_fields` and bounded `snippets`.
Batch requires `ids=2,99,1`, using the same comma-separated encoding as list IDs;
the CLI's equivalent is repeated `--id`. IDs cannot repeat, results preserve
their requested order, and missing IDs appear in `not_found`.

Both routes default to Active and `fields=id,title,status`. They share the
list's `fields`, repeatable `store` and exclusive `group` semantics. `limit`
defaults to 10 (1–50); for batch it counts requested IDs, including missing IDs.
Pages contain `tasks`, `stores`, `fields`, `hasMore` and `next_cursor`; search
also returns `search_fields`. URL-encode `next_cursor` as `cursor` and keep the
same query/ordered IDs, fields, search fields and store/group selection to
continue. Changed inputs or malformed cursors receive `INVALID_CURSOR` (400).
Pages are not snapshots across concurrent edits. The shared 32 KiB budget can
shorten a page; an oversized first result receives `OUTPUT_TOO_LARGE` (400).

Search and batch use the project's shared `search.mode`: `scan` reads JSON, and
`auto` or `indexed` use a current derived cache or scan while the core requests
a refresh. Explicit `no-cache=true` always forces JSON.
There is no HTTP index-build route or separate HTTP indexing/storage logic.
Search preserves core `SLOW_SCAN` advisories, including elapsed time and guidance.
The global `slow_query_ms` configuration uses the startup CLI `--config`, or
the standard registry environment/default path, and cannot be selected by a request.

Blocker depth defaults to 1 (maximum 20); limit defaults to 10 (maximum 50).
Core responses stay within 32 KiB and disclose pagination/graph truncation.
Oversized details require a smaller field projection. Core file-read budgets
still apply. Headers are capped at 16 KiB, with a 10-second header timeout and
30-second request timeout.

If SQLite cache acceleration cannot be used, the task-data response still
succeeds from JSON and includes a bounded HTTP `Warning` header with
`CACHE_UNAVAILABLE` (or `CACHE_FALLBACK` when indexed mode lacked a current
generation). Cache diagnostics never alter the JSON task payload.

After startup, a client with the token can list tasks and inspect a result:

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $TASKS_HTTP_TOKEN" \
  'http://127.0.0.1:4318/tasks?limit=10&fields=id,title,status'
curl --fail-with-body -sS -H "Authorization: Bearer $TASKS_HTTP_TOKEN" \
  'http://127.0.0.1:4318/tasks/1?store=all'
curl --fail-with-body -sS -H "Authorization: Bearer $TASKS_HTTP_TOKEN" \
  'http://127.0.0.1:4318/tasks/search?query=release%20notes&search-fields=title,scope'
curl --fail-with-body -sS -H "Authorization: Bearer $TASKS_HTTP_TOKEN" \
  'http://127.0.0.1:4318/tasks/batch?ids=2,99,1&store=all'
```

Use the actual returned ID. For remote access, replace the URL with your HTTPS
proxy URL. Each request rereads current files; CLI changes and valid manual JSON
edits appear on the next request without restarting. No separate task database
exists; the shared search cache is disposable derived data. Read-only describes
the HTTP operations: shared core reads can prepare
missing service metadata and recover pending coordinated writes, so the project
is not promised to work on a read-only mount. Rejected authentication, routes,
methods and CORS requests never invoke those reads. CLI/MCP retain their existing
write/validation operations and work with this server stopped.

Errors use `{ "error": { "code": "INVALID_INPUT", "message": "..." } }` with
bounded messages. Core codes remain unchanged. Node can reject malformed HTTP
framing and header overflow before the JSON handler runs.

| Status | Codes |
| --- | --- |
| 400 | Input, JSON, configuration, store, service and output-budget errors; other domain errors |
| 401 | `UNAUTHORIZED` |
| 403 | `ACCESS_DENIED` (origin, preflight or filesystem boundary) |
| 404 | `NOT_FOUND`, `TASK_NOT_FOUND`, `PROJECT_NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED`, with `Allow: GET` |
| 409 | `PROJECT_CHANGED`, `PROJECT_BUSY`, `RECOVERY_REQUIRED`, `RECOVERY_CONFLICT` and other shared conflicts |
| 413 | `INPUT_TOO_LARGE` |
| 500 | `READ_ERROR`, `WRITE_ERROR`, `INTERNAL_ERROR` |

Errors close their connection. Responses disable caching and MIME sniffing.

## HTTPS reverse proxy and browser clients

The backend binds only IPv4 loopback `127.0.0.1`; there is no external bind
option. For remote use, configure an HTTPS reverse proxy on the same host to
forward requests to `http://127.0.0.1:4318`. HTTPS is required at the external
boundary: never send the token through a public plaintext HTTP connection.
Forward the `Authorization` and `Origin` headers and preserve the path/query.
The proxy may preserve its public `Host` header. The adapter does not restrict
Host or browser `Sec-Fetch-Site`, and does not use forwarded headers for trust
or routing. Disable proxy response caching; avoid recording Authorization in
logs. Proxy deployment, TLS certificates and service installation are operator
responsibilities, outside this repository's delivery.

Browser requests require explicitly allowed exact origins, including their
scheme and non-default port. There are no wildcard/subdomain matches. By default
all requests containing Origin are rejected; non-browser clients without Origin
still require the token. Configure each trusted private UI origin at startup:

```bash
tasks http --port 4318 \
  --allow-origin https://private-ui.example
```

`--allow-origin` is repeatable and also supported by `node app/http.mjs`. Supply
a canonical HTTP(S) origin without a trailing slash, path, credentials, query or
fragment. CORS is an extra browser restriction, not authentication. Every GET
still needs its Bearer token, including requests from allowed origins.

Allowed-origin `OPTIONS` preflights for an existing read route and requested
method GET can omit authentication; they return 204 without task data or storage
access. Only the Authorization request header is allowed. Allowed-origin
responses include `Access-Control-Allow-Origin` and `Vary: Origin`; no cookie
credentials are enabled. Unsupported origins/methods/headers receive 403.

For manual fetch or a private UI, supply a token obtained at runtime through a
trusted channel; do not embed it in public frontend code or URLs:

```javascript
const response = await fetch('https://tasks.example/tasks?limit=10', {
  headers: { Authorization: `Bearer ${readToken}` },
});
if (!response.ok) throw new Error(`Task read failed: ${response.status}`);
const page = await response.json();
```

## Filesystem boundary

The startup selector uses the shared resolver and canonicalises the project
path. Before serving each read the adapter checks that this root is still
canonical, `tasks` and `docs` are ordinary directories, the schema and all
immediate `tasks` entries are regular files, and none is a symbolic or hard link.
This includes service metadata, journal and lock files. Missing files/directories
are allowed for core preparation. Links within the project are also rejected.
Core validation additionally restricts store names and journal destinations to
project task files. Task extension values remain passive; strings containing
filenames/URLs are never opened. HTTP cannot supply a schema, registry or
input-file path.

The local owner and project filesystem remain trusted. These checks are not an
OS sandbox: a local process replacing files between preflight and core I/O can
race them. Do not serve projects controlled by an untrusted local writer. The
adapter retains the CLI's filesystem trust model and shared storage behaviour.

## Verification

```bash
node --test --test-reporter=dot app/tests/http.test.mjs
```

Tests use temporary projects and actual loopback requests, including public
process startup, restart-based token rotation, shared-read parity, external-edit
freshness, rejected writes, output bounds, filesystem checks and proxy/CORS
requests. They clean up listeners, child processes and temporary files and use
the documented native Node runtime without MCP dependencies or a UI.
