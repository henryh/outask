# Outask AI

Outask is a lightweight task tracker for personal projects and your AI harness.
Keep active, completed and archived tasks alongside project code as readable JSON,
so you and local coding agents share the same task history through CLI or MCP.

Use `outask` from your terminal. `tasks` is a permanent alias for the same installation.

## Install the CLI

Run `npm install -g outask` with Node.js 22.23.3 or later. For platform archives, offline installation, and source checkouts, see [Install Outask](docs/install.md).

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

Start a new session. For other clients and platforms, see [MCP setup](app/mcp/README.md).

To use [Plan to Tasks](skills/outask-repository-task-tracker/), copy its folder into your agent's skills directory and enable it.

## Contributing

See [contributor setup and delivery](docs/contributing.md).

## License

Copyright (c) 2026 Henry <me@henrydev.me>.
Licensed under [GNU AGPL version 3 only](LICENSE).
