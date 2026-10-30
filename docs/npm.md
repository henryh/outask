# Install Outask with npm

Requires Node.js 22.23.3 or later and npm on PATH. Supports Linux x64,
macOS Apple silicon and native Windows x64. npm creates both `outask` and
`tasks` command entries in its global prefix. Ensure that prefix's command
directory is on PATH; open a fresh terminal and restart your MCP client.

```sh
npm install -g outask
outask --version
outask create --title "Write release notes"
outask list --format table
```

Run create/list from your project directory. npm installation needs no
application installer, shell-profile modification or administrator privileges
when your Node provider supplies a writable global prefix. Select one active
installation channel: remove archive command links with that archive's installer
before switching to npm; check `command -v outask` (POSIX) or `where.exe outask`
(Windows) to confirm which command is selected.

```sh
npm update -g outask
npm uninstall -g outask
```

npm owns application files and command shims. Its uninstall removes those files;
project records, installed skills, application configuration and cache remain.
Remove a Git hook with `outask hook --remove` before uninstalling if installed;
remove the MCP entry in your client when no longer needed. Do not delete live
coordination files. Let active writes finish; existing MCP sessions may retain
loaded code until the client restarts them normally. Archive installer update
commands do not update npm installations. `outask update` edits a task.

## Connect MCP

Use `outask` with argument `mcp` on Linux/macOS:

```sh
codex mcp add outask -- outask mcp
```

On Windows, use your client's documented npm command-shim support, or configure
`node` with the absolute global package `bin/outask` path and argument `mcp`.
Find the package directory with `npm root -g`. Tool calls still select the
repository using an absolute `project_path`.

See [MCP setup](https://github.com/henryh/outask/blob/main/app/mcp/README.md) and [operator commands](https://github.com/henryh/outask/blob/main/app/README.md).
