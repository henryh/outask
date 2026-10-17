# Outask AI

Keep project tasks with your code as readable JSON. Use `tasks` yourself or
connect a local agent through MCP.

## Install the CLI

Requires Node.js 22.23.3 or later. Download your platform's archive from
[Releases](https://github.com/henryh/outask/releases), extract it and open
`OutaskAI` in a terminal.

Install on Linux x64:

```bash
./install.sh
```

On macOS Apple silicon, double-click `Install.command` in Finder or run
`./Install.command` in a terminal.
On Windows x64, run `./Install.cmd` in PowerShell or `Install.cmd` in cmd.exe.
Open a new terminal after installation. No administrator access or WSL is needed.
For macOS Finder/Gatekeeper, updates and removal, see the
[installation guide](app/README.md#installation-and-updates).

## Basic use

Run in your project directory:

```bash
tasks create --title "Write release notes"
tasks list --format table
tasks search "release notes"
tasks transition 1 --status done
```

Use the ID returned by `create` in place of `1`. The first write prepares task
storage; no setup command is needed. Discover commands with `tasks --help`,
or use the [operator cookbook](app/README.md).

## Use with an agent

On Linux/macOS, register the installed adapter with Codex:

```bash
codex mcp add tasks -- tasks mcp
codex mcp list
```

Start a new Codex session. For Windows, client PATH differences and other hosts,
see [MCP setup](app/mcp/README.md). Point the agent to the
[Outask AI agent skill guide](docs/outask-ai-skill.md), for example:

> Use the Outask AI agent skill guide for this project. Prefer the connected
> `tasks` MCP server and respect the project's instructions. Plan and track
> this request: _describe the work_.

Outask AI manages task data. Your project workflow controls Git and publishing.

## Contributing

See [contributor setup and delivery](docs/contributing.md).

## License

Copyright (c) 2026 Henry <me@henrydev.me>.
Licensed under [GNU AGPL version 3 only](LICENSE).
