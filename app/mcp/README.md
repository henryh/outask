# Local MCP adapter

Install with the [CLI quick start](../../README.md#install-the-cli).
Requires Node.js 22.23.3 or later and a trusted local stdio client. Release
archives and the [npm package](../../docs/npm.md) include the adapter and its dependencies.

## Codex on Linux/macOS

After installation, open a new terminal and register the server:

```bash
codex mcp add outask -- outask mcp
codex mcp list
```

Start a new Codex session; `/mcp` shows active servers. The first `outask` is the
server name; `outask mcp` is the process it launches. See
[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Use `outask` from PATH for the installed adapter. If startup fails, check that
both `outask` and `node` are available in the client's environment, then restart
the client after correcting PATH. Verify the connection in a new session.

Only when a confirmed client limitation prevents PATH-based startup, register
absolute paths from a working terminal and record the concrete reason:

```bash
codex mcp add outask -- "$(command -v node)" "$(command -v outask)" mcp
```

Register again if the selected Node path changes. The installed launcher
survives removal of the extracted download.

## Windows

Install with `./Install.cmd` in PowerShell or `Install.cmd` in cmd.exe.
Configure the Node entry directly, since clients differ in `.cmd` support:

```json
{
  "mcpServers": {
    "outask": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\Outask\\app\\bin\\outask",
        "mcp"
      ]
    }
  }
}
```

Replace `YOUR_USER` or use your custom installation path. Node must be on the
client's PATH; an absolute `node.exe` path also works. JSON doubles backslashes.
Restart a client opened before installation if it needs the new PATH.

For an npm installation, run `npm root -g` and use `<returned directory>\outask\bin\outask` as the Node entry instead. Keep `mcp` as its argument and escape backslashes in JSON.

## Other stdio clients on Linux/macOS

Adapt the outer settings container to your client:

```json
{
  "mcpServers": {
    "outask": {
      "command": "outask",
      "args": ["mcp"]
    }
  }
}
```

Both `tasks` and `node` must be available on the client's PATH; follow the PATH
checks above if startup fails. For Windows, use the Node entry described above.
Remove the entry and stop its process to disconnect the adapter.

## Compatible updates

Run `npm update -g outask` for an npm installation, or the new archive's installer for an archive installation, while existing sessions remain connected. Let
active writes finish; do not kill MCP processes or force an immediate reconnect.
Existing sessions may use their old loaded version until the launching client
restarts them in its normal lifecycle. Verify `outask --version` and a fresh MCP
connection with a task read to check the updated installation independently.
See [project locks and upgrades](../README.md#project-locks-and-upgrades)
for coordination-file cleanup and incompatible protocol migrations.

## Tools and selection

Select a project in each tool call. `outask mcp` takes no project flags. Supply
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
listener or client configuration written by Outask.

## Source checkout

From the repository root:

```bash
npm ci --prefix app --omit=dev
npm ci --prefix app/mcp --omit=dev
node app/bin/outask mcp
```

Point the client at the absolute Node executable, with this checkout's
`app/bin/tasks` and `mcp` as arguments. Keep both dependency directories.
