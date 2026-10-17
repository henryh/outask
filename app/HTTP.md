# Read-only HTTP API

Run from a prepared source checkout with Node.js 22.23.3 or later. Install the
core dependency once with `npm ci --prefix app --omit=dev`. From the repository
root, generate a token and start the adapter:

```bash
export TASKS_HTTP_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")"
node app/http.mjs /absolute/path/to/project --port 4318
```

The server binds only `127.0.0.1` and serves one project selected at startup.
No project path means the current directory. `--schema-path` selects an existing
project-relative schema; requests cannot change projects, registries or schemas.
Use `node app/http.mjs --help` for startup options. Stop with Ctrl-C.
This source adapter is not included in release archives.

`TASKS_HTTP_TOKEN` must contain 32–512 ASCII letters, digits, `_` or `-`.
Generate it randomly and keep it outside task files and Git. Possession grants
read access to every retained task and field in the selected project.
For rotation, stop the process, replace its environment token and restart;
changing the environment alone does not update a running server. Distribute
the new token through a trusted channel and check that the old token gets 401.

## Requests and results

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $TASKS_HTTP_TOKEN" \
  'http://127.0.0.1:4318/tasks?limit=10&fields=id,title,status'
curl --fail-with-body -sS -H "Authorization: Bearer $TASKS_HTTP_TOKEN" \
  'http://127.0.0.1:4318/tasks/1?store=all'
```

Use an actual task ID. Every GET requires `Authorization: Bearer <token>`.
Missing, malformed or incorrect credentials get 401. Successful reads return
200 with the shared JSON result. Requests have no body; names and statuses are
case-sensitive. Unknown/repeated query keys fail, except repeatable `store`.

| GET route | Query | Result |
| --- | --- | --- |
| `/tasks` | List options below | Bounded page or `{ "count": n }` |
| `/tasks/search` | `query`, `search-fields`, selection, `limit`, `cursor` | Matches and snippets |
| `/tasks/batch` | `ids`, selection, `limit`, `cursor` | Ordered tasks and `not_found` |
| `/tasks/:id` | selection | Task, all fields by default |
| `/tasks/:id/blockers` | `depth`, `limit` | Active blockers and bounded graph |
| `/schema` | None | Effective schema JSON |

Selection means `fields=id,title,status`, repeatable `store` (including
`store=all`), or `group=Active|Done|Archive`. Group and store are exclusive.
Task reads default to Active. List/search/batch fields default to
`id,title,status`; detail defaults to all fields. IDs are positive safe integers.

List additionally accepts `limit` (1–50, default 10), `offset` (default 0),
`sort` (default `id`), `desc=true|false`, `count=true|false`, `ids=1,2`,
exact `status`, and `filters` as a URL-encoded JSON array of `{field,value}`.
Follow `nextOffset` while `hasMore` is true.

Search requires a non-empty literal `query`. It matches without case sensitivity
across `title,scope,acceptance,dependencies,sources,notes` by default;
`search-fields=title,scope` selects other fields. Results add `matched_fields`
and bounded `snippets`. Batch requires unique ordered `ids`, such as `2,99,1`;
missing IDs appear in `not_found`.
Search and batch `limit` defaults to 10 (1–50); batch counts missing IDs too.
URL-encode `next_cursor` as `cursor` with unchanged query/IDs, fields and
selectors. Changed inputs produce `INVALID_CURSOR`. Pages are not snapshots
across concurrent edits.

All `/tasks` routes accept `no-cache=true|false`. True reads authoritative JSON
without opening or refreshing the disposable SQLite cache. `/schema` does not
accept it. Cache acceleration failures preserve JSON results and add a bounded
HTTP `Warning` containing `CACHE_UNAVAILABLE` or `CACHE_FALLBACK`.
See the [shared contract](../docs/contract.md) for search/cache semantics.

Blocker depth defaults to 1 (maximum 20), limit to 10 (maximum 50). A truncated
graph cannot establish that no cycle exists. Shared responses have a 32 KiB
ceiling; reduce fields if one result is too large. Headers are capped at 16 KiB,
with a 10-second header timeout and 30-second request timeout.

Current task-file edits appear on the next read. Reads may prepare missing
service metadata and preserve task records. Pending moves require recovery
through CLI/MCP validation; see [recovery](README.md#statuses-and-recovery).
A read-only filesystem is not a supported assumption. Authentication, route and
CORS rejection happen before shared reads.

Errors return `{ "error": { "code": "INVALID_INPUT", "message": "..." } }`.
Malformed HTTP framing/header overflow may be rejected by Node before JSON.

| Status | Meaning |
| --- | --- |
| 400 | Input/configuration/store/output-budget or other domain error |
| 401 | `UNAUTHORIZED` |
| 403 | `ACCESS_DENIED` for origin, preflight or filesystem boundary |
| 404 | Route, task or project not found |
| 405 | `METHOD_NOT_ALLOWED`; `Allow: GET` |
| 409 | Changed/busy project, recovery required/conflict or other shared conflict |
| 413 | `INPUT_TOO_LARGE` |
| 500 | Read, write or internal failure |

HTTP supports reads only. Use CLI/MCP for task writes, schema materialisation
and validation. Responses disable caching and MIME sniffing; errors close the
connection.

## HTTPS reverse proxy and browser clients

For remote access, configure an HTTPS reverse proxy on the same host to forward
to `http://127.0.0.1:4318`. Keep tokens out of public plaintext connections,
URLs, frontend source and logs. Forward `Authorization`, `Origin` and the
path/query; disable response caching. Host/forwarded headers do not establish
trust or select projects. TLS and service deployment are the operator's work.

Browser origins must be explicitly allowed at startup:

```bash
node app/http.mjs /absolute/path/to/project --port 4318 \
  --allow-origin https://private-ui.example
```

Repeat `--allow-origin` for each exact canonical HTTP(S) origin, including any
non-default port. Paths, trailing slashes, credentials, queries, fragments and
wildcards are rejected. By default requests containing `Origin` are rejected.
CORS adds a browser restriction; every GET still needs its Bearer token.
Non-browser clients without Origin also require the token.

Allowed-origin OPTIONS preflights for an existing GET route may omit the token;
they return 204 without task data or storage access. Only the Authorization
request header is allowed. Responses include `Access-Control-Allow-Origin` and
`Vary: Origin`; cookie credentials are disabled. Unsupported origins, methods
or requested headers receive 403.

## Filesystem boundary

The adapter checks the canonical startup project root and requires ordinary
directories and unlinked regular schema/task/service files. Symbolic and hard
links are rejected, including links within the project. Missing files may be
prepared by core reads. Store/journal paths stay within project task files;
filename/URL strings in extension fields remain passive.

The local owner and filesystem are trusted. These checks are not an OS sandbox
against a local writer racing file replacements. Serve only projects whose
writers you trust; project selection and token possession are the access model.
