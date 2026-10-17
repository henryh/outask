# Local MCP adapter

Outask AI exposes repository-local task operations to agents through this
optional local stdio adapter. Plugin integration is unfinished and unverified;
configure the adapter directly in a trusted local client.

The optional adapter exposes the shared task operations over local stdio with
`tasks mcp`. It requires Node.js 22.23.3 or later, as declared in
`app/mcp/package.json`. There is no HTTP listener, daemon, separate database or
skill installation. The process has the invoking user's filesystem permissions;
project selection is routing, not an access-control boundary. Configure it only
in a trusted local client.

## Install and launch

Install Outask AI from a published release by following the
[quick start](../../README.md#install-the-cli). Release archives include the MCP
adapter and its dependencies. Find the installed command's absolute path:

```bash
command -v tasks
```

`tasks mcp` starts stdio immediately; stdout contains only MCP messages.
Launch errors go to stderr and exit nonzero. Select a project in each tool call;
the launcher accepts no project flags, because one session can work with
different projects. Help is available even without the dependencies.

### Codex on Linux/macOS

After a successful installation, open a new terminal and check `tasks --version`.
Register the installed stdio server with Codex:

```bash
codex mcp add tasks -- tasks mcp
codex mcp list
```

The first `tasks` is the client-side server name; `tasks mcp` after `--` is the
process Codex starts. Start a new Codex session, or restart the client application,
to load the configuration. Use `/mcp` to inspect the active server. See the
[official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

If Codex runs with a different PATH (for example an app launched before shell
setup, or Node installed through nvm), register the resolved installed launcher
and Node from the working terminal:

```bash
codex mcp add tasks -- "$(command -v node)" "$(command -v tasks)" mcp
```

This uses the installed `tasks` command, which survives removal of the download.
Register again if the selected Node path changes. Keep any installation error
visible and resolve it before registering MCP; copying the unpacked entry into
a project does not complete the per-user installation.

### Other stdio clients

Configure a stdio-capable host with the following process definition (adapt the
outer `mcpServers` container to the host's settings format):

```json
{
  "mcpServers": {
    "tasks": {
      "command": "/absolute/path/to/tasks",
      "args": ["mcp"],
      "env": {
        "TASK_TRACKER_CONFIG": "/absolute/path/to/task-tracker-config.json"
      }
    }
  }
}
```

Replace `/absolute/path/to/tasks` with the result from `command -v tasks`.
Node.js must also be on the client's PATH; an absolute launcher path alone does
not supply Node. Use
an explicit `project_path` in calls when the host's process working directory is
unknown. No shell invocation is needed for tool calls. The registry and `env`
entry are optional; registry format and resolution follow the [CLI
project-selection contract](../README.md#installed-cli).

To disconnect the adapter, remove this server entry from the client and stop its
process. This leaves the CLI installation, project configuration and task data
untouched.

### Windows

Use the [native Windows installer](../README.md#windows-installation), which
includes production MCP dependencies. Windows clients differ in `.cmd` launcher
support, so configure the Node entry directly:

```json
{
  "mcpServers": {
    "tasks": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\OutaskAI\\app\\bin\\tasks",
        "mcp"
      ]
    }
  }
}
```

Replace `YOUR_USER` with your actual profile directory (or the custom installed
path). Node.js 22.23.3 or later must be on the client's PATH; an absolute path to
`node.exe` is also valid. JSON requires doubled backslashes. Select the project
with `project_path` in tool calls, using an absolute Windows path. The same
configuration works from PowerShell/cmd.exe clients without WSL, a shell wrapper
or administrator access. `tasks mcp` remains available interactively through the
installed `tasks.cmd` launcher. Restart a client opened before installation if
it needs the updated user PATH. Native installed-MCP CI exercises this exact
Node-entry process definition.

### Development checkout

To run the adapter from a source checkout instead of a published release:

```bash
npm ci --prefix app --omit=dev
npm ci --prefix app/mcp --omit=dev
node app/scripts/install-cli.mjs install
tasks mcp --help
```

Adapter dependencies live in `app/mcp/node_modules`; the core CLI dependency
lives in `app/node_modules`. Remove only `app/mcp/node_modules` to remove the
checkout's optional adapter dependencies without disabling other CLI commands.

## Tools and selection

Every tool accepts optional `project` (configured name), `project_path`
(directory), `config` (registry file), and `schema_path` (project-relative task
schema). The first two are mutually exclusive;
neither means the server's working directory. Paths bypass the registry.
`config` overrides `TASK_TRACKER_CONFIG`, then the XDG/default configuration;
`schema_path` independently overrides automatic task-schema selection.
Conflicting name locations fail; there is no parent search. These use the same
resolver as the CLI. Argument names use underscores for multiword JSON keys;
`project_path`, `schema_path` and `if_updated_at` correspond to the CLI's hyphenated options.
Discovery supplies typed schemas. Unknown top-level keys are rejected.

Every task-data read tool accepts optional boolean `no_cache`. True overrides
project `search.mode`, uses authoritative JSON only and never opens or refreshes
the disposable SQLite cache. Schema inspection is not a task-data read.

| Tool | Operation-specific inputs | Result |
| --- | --- | --- |
| `list_tasks` | `stores`, `group`, `fields`, `filters: [{field,value}]`, `status`, `ids`, `sort`, `desc`, `limit`, `offset`, `count`, `no_cache` | Shared page, or `{count}` |
| `get_task` | `id`, `stores`, `group`, `fields`, `no_cache` | Selected task fields |
| `get_tasks` | ordered `ids`, `stores`, `group`, `fields`, `limit`, `cursor`, `no_cache` | Bounded page with ordered tasks and `not_found` |
| `search_tasks` | `query`, optional `search_fields`, `fields`, `stores`, `group`, `limit`, `cursor`, `no_cache` | Bounded matches with snippets, advisories and stable continuation |
| `create_task` | `task` object, optional `store` | Complete persisted task |
| `update_task` | `id`, `patch: {set,add,remove,unset}`, optional `store`, `if_updated_at` | Complete persisted task |
| `transition_task` | `id`, `status`, optional `store`, `if_updated_at` | Complete persisted task |
| `delete_task` | `id`, optional Archive `status`, `store`, `if_updated_at` | Complete archived task |
| `inspect_blockers` | `id`, optional `depth`, `limit`, `no_cache` | Exact readiness and bounded graph |
| `validate_project` | No additional inputs | Validation/service-refresh result |
| `inspect_schema` | No additional inputs | Complete effective schema JSON |
| `materialise_schema` | Optional boolean `replace` | Effective schema JSON saved at the selected path |

Schema tools follow the [schema operation contract](../README.md#inspecting-and-materialising-the-task-schema).
Inspection works without task stores. Materialisation defaults to
`tasks/task-schema.json` when configuration is absent; explicit `schema_path`
must already exist, as with other tools. Existing schemas require `replace: true`
or return `FILE_EXISTS`. Replacement preserves custom rules/fields, and existing
task bytes remain unchanged. Both tools return the same direct JSON document
as `tasks schema` and HTTP inspection, with the shared 32 KiB ceiling.

List/get/get_tasks/search_tasks select Active by default. `stores: ["all"]` includes history; stores
and group cannot be combined. Lists default to `id,title,status`, limit 10,
offset 0 and ascending ID. Detail defaults to all fields. Status matching is
exact and case-sensitive; other filters retain shared matching rules.
`filters` is a structured equivalent of CLI `--where`, and `ids`/`stores` are
arrays instead of repeatable flags. `count` ignores pagination like the CLI.
Follow `nextOffset` while `hasMore` is true, retaining the original selectors
and filters. For `get_tasks`, IDs are positive safe integers without duplicates;
task results retain the requested order and absent IDs appear in `not_found`.
Follow `next_cursor` with the same ordered IDs, fields and selectors. Its limit
from 1 through 50 counts both found and missing IDs. Graph defaults are depth 1
and limit 10. Maximum list/batch/graph limit is 50; maximum depth is 20.
Truncation never implies a cycle-free graph.

Search matches `query` as case-insensitive literal text across the selected
`search_fields` and returns each task with `matched_fields` and `snippets`.
The default searched fields and indexed/scan behaviour are shared with the CLI.
Follow `next_cursor` with the same query, fields, search fields and selectors.
Slow scans may include `SLOW_SCAN` advisories. Indexed projects without a
current generation return JSON and request refresh rather than failing. Search pages use the
same 32 KiB structured-result ceiling as other reads.

Successful calls return the shared JSON object in `structuredContent`, with a
small fixed text acknowledgement. Clients must consume `structuredContent`;
large results are not duplicated as text. Shared task/page/graph payloads stay
within 32 KiB when pretty-printed; protocol envelopes and acknowledgements are
additional overhead. Writes check complete resulting-record size before
persisting, rather than saving a task and then rejecting its response.
If SQLite cache acceleration is unavailable, `structuredContent` still contains
the authoritative JSON result and `content` adds one bounded
`CACHE_UNAVAILABLE` or `CACHE_FALLBACK` advisory text item.
Stdio input buffering is capped at 8 MiB, including the MCP envelope: an
oversized message closes the transport and is reported on stderr. Tool arguments
also use the shared 8 MiB ceiling. This differs from file/stdin task input only
by including protocol overhead. Once accepted, core operations use the separate
128 MiB authoritative project-source budget shared with standalone, CLI and HTTP
boundaries; MCP does not impose a smaller project limit.

Core errors return `isError: true` and
`structuredContent: {error: {code, message}}`, with a bounded text explanation.
Malformed protocol requests and schema-invalid arguments use SDK MCP errors;
these do not invoke core operations. Clients should inspect `isError` before
reading a result. Mutations preserve extensions, passive references and IDs,
use shared write locks/recovery and reject stale `if_updated_at` values.
Duplicate additions are silent no-ops. Delete retains data in Archive; restore
with `transition_task` to an Active status. Validation refreshes service state;
it does not rewrite task records or run Git.

Example `tools/call` arguments:

```json
{"name":"list_tasks","arguments":{"project_path":"/projects/example","limit":10}}
```

```json
{"name":"get_tasks","arguments":{"project_path":"/projects/example","ids":[7,12,40],"fields":["id","title","status"]}}
```

```json
{"name":"search_tasks","arguments":{"project_path":"/projects/example","query":"release approval","fields":["id","title","status"]}}
```

```json
{"name":"update_task","arguments":{"project":"example","id":7,"patch":{"add":{"tags":["reviewed"]}},"if_updated_at":"2026-09-21T12:00:00.000Z"}}
```

## SDK selection and compatible client verification

Selected on 2026-09-21: official `@modelcontextprotocol/server` **2.0.0**, with
the development-only `@modelcontextprotocol/client` updated to **2.2.0**
on 2026-10-09 for the [OAuth client fix](https://github.com/advisories/GHSA-6qxp-vccf-f47h), and Zod 4 for
typed tool schemas. The [official SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
identifies v2 as the stable line implementing the 2026-07-28 protocol;
the [official package guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md)
documents separate server/client packages and stdio imports. The lockfile pins
the verified dependency tree. No custom MCP protocol implementation is used.

The compatible client actually exercised here is the official Node SDK
`Client` with `StdioClientTransport`, spawning the installed executable. Its
reproducible session is [tests/client.test.mjs](tests/client.test.mjs). To run:

```bash
npm ci --prefix app --omit=dev
npm ci --prefix app/mcp
node --test app/mcp/tests/*.test.mjs
```

The repository's `make ci` also audits both locked dependency trees and checks
the real installed Linux x64 archive with this client. See the
[developer verification commands](../README.md#verification).

It negotiates the protocol, discovers all twelve tools and exercises list,
detail, ordered batch retrieval, content search, creation, patching, status changes, archive/restore, blocker inspection
and validation through structured calls. Assertions compare CLI results,
blocked starts, cycles, stale edits, no-op additions, complete responses,
project extensions, selection and bounded pagination/graphs. A copy without
optional MCP dependencies verifies CLI/script independence from the adapter
packages. Test projects and installed test symlinks are removed automatically.
This is an actual SDK client session; compatibility
with particular GUI host configuration formats is not claimed by this check.
