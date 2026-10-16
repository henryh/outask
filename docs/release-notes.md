## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.0/OutaskAI-1.0-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.0/OutaskAI-1.0-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.0/OutaskAI-1.0-windows-x64.tar.gz)

## Current version

Outask AI keeps project tasks with your code in readable local JSON files. Use
the CLI directly or connect a local AI agent through MCP on Linux x64, macOS
Apple silicon and Windows x64.

## What's new

- First public release under GNU AGPL version 3 only.
- Create, list, search, inspect, update and transition tasks through the CLI and
  local MCP server, with project-defined fields, local blockers and validation.
- Install per user, update or uninstall while preserving project tasks and
  configuration; native Windows installation works without WSL.

## Install

Requires Node.js 22.23.3 or later on PATH.

Download the archive for your platform, extract it into a directory you will keep,
and open that directory's OutaskAI folder in a terminal.

Linux/macOS:

```sh
./install.sh
```

Windows:

```text
./install.cmd  # PowerShell
install.cmd   & rem cmd.exe
```

## Run

From a project directory:

```sh
tasks create --title "Write release notes"
tasks list --format table
```

## Documentation

- [Basic use](https://github.com/henryh/outask/blob/v1.0/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.0/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.0/app/mcp/README.md)
