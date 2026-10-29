# Outask

Outask is a lightweight task tracker for personal projects and your AI harness.
Keep active, completed and archived tasks alongside project code as readable JSON,
so you and local coding agents share the same task history through CLI or MCP.

Use `outask` from your terminal. `tasks` is a permanent alias for the same installation.

## Install the CLI

Requires Node.js 22.23.3 or later. Download your platform's archive from
[Releases](https://github.com/henryh/outask/releases), [verify its checksum](app/README.md#verify-a-download), extract it and open
`Outask` in a terminal.

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
outask create --title "Write release notes"
outask list --format table
outask search "release notes"
outask transition 1 --status done
outask list --group Done
```

Use the ID returned by `create` in place of `1`. The first write prepares task
storage; no setup command is needed. Discover commands with `outask --help`,
or use the [operator cookbook](app/README.md).

## Use with an agent

On Linux/macOS, register the installed adapter with Codex:

```bash
codex mcp add outask -- outask mcp
codex mcp list
```

Start a new Codex session. For Windows, client PATH differences and other hosts,
see [MCP setup](app/mcp/README.md). Point the agent to the
[Outask agent skill guide](docs/outask-skill.md), for example:

> Use the Outask agent skill guide for this project. Prefer the connected
> `outask` MCP server and respect the project's instructions. Plan and track
> this request: _describe the work_.

Outask manages task data. Your project workflow controls Git and publishing.

## Contributing

See [contributor setup and delivery](docs/contributing.md).

## License

Copyright (c) 2026 Henry <me@henrydev.me>.
Licensed under [GNU AGPL version 3 only](LICENSE).
