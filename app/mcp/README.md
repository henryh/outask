# Local MCP adapter

Install with the [CLI quick start](../../README.md#install-the-cli).
Requires Node.js 22.23.3 or later and a trusted local stdio client. Release
archives include the adapter and its dependencies.

## Codex on Linux/macOS

After installation, open a new terminal and register the server:

```bash
codex mcp add tasks -- tasks mcp
codex mcp list
```

Start a new Codex session; `/mcp` shows active servers. The first `tasks` is the
server name; `tasks mcp` is the process it launches. See
[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

If the client has a different PATH, register absolute paths from a working
terminal instead:

```bash
codex mcp add tasks -- "$(command -v node)" "$(command -v tasks)" mcp
```

Register again if the selected Node path changes. The installed launcher
survives removal of the extracted download.

## Windows

Install with `./Install.cmd` in PowerShell or `Install.cmd` in cmd.exe.
Configure the Node entry directly, since clients differ in `.cmd` support:

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

Replace `YOUR_USER` or use your custom installation path. Node must be on the
client's PATH; an absolute `node.exe` path also works. JSON doubles backslashes.
Restart a client opened before installation if it needs the new PATH.

## Other stdio clients

Adapt the outer settings container to your client:

```json
{
  "mcpServers": {
    "tasks": {
      "command": "/absolute/path/to/tasks",
      "args": ["mcp"]
    }
  }
}
```

Use `command -v tasks` for the installed path. Node must also be available to the
client. Remove the entry and stop its process to disconnect the adapter.

## Tools and selection

Select a project in each tool call. `tasks mcp` takes no project flags. Supply
an absolute `project_path` when the client's working directory is unknown, or
use `project` for a configured name. They are mutually exclusive; neither means
the server's current directory. `config` selects the global registry and
`schema_path` independently selects a project-relative schema. See
[project selection](../README.md#selecting-a-project) and
[configuration](../../docs/contract.md#implemented-read-configuration).

For example, the `list_tasks` tool receives:

```json
{"project_path":"/projects/example","fields":["id","title","status"],"limit":10}
```

Use discovered tool schemas for typed inputs. Reads default to Active; request
history explicitly. Follow list offsets and search/batch cursors with unchanged
selectors. Read tools accept `no_cache` to bypass the disposable cache.

Consume successful results from `structuredContent`. Check `isError` before
using a result; shared failures contain `structuredContent.error.code` and
`message`. SDK argument/protocol errors are reported by the MCP SDK. Cache
advisories may accompany successful JSON results in `content`.
Mutations return complete records, preserve extensions and use shared locking,
validation and stale-edit checks. See the [operator cookbook](../README.md)
for patching and recovery, and the [shared contract](../../docs/contract.md)
for data semantics and bounds.

The process runs with your filesystem permissions. Project selection routes
operations; it does not restrict access. Configure only trusted clients.
Stdout carries MCP messages; launch diagnostics go to stderr. There is no HTTP
listener or client configuration written by Outask AI.

## Source checkout

From the repository root:

```bash
npm ci --prefix app --omit=dev
npm ci --prefix app/mcp --omit=dev
node app/bin/tasks mcp
```

Point the client at the absolute Node executable, with this checkout's
`app/bin/tasks` and `mcp` as arguments. Keep both dependency directories.
