## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.1/OutaskAI-1.1-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.1/OutaskAI-1.1-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.1/OutaskAI-1.1-windows-x64.tar.gz)

## Current version

Outask AI keeps project tasks with your code in readable local JSON files. Use
the CLI directly or connect a local AI agent through MCP on Linux x64, macOS
Apple silicon and Windows x64.

## What's new

- Install successfully when an unrelated PATH directory cannot be searched,
  while continuing to reject conflicting task commands.
- Follow macOS installation and permission guidance directly from the archive.
- Connect the installed MCP server to Codex with a short registration command
  and guidance for clients with a different PATH.

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

- [Basic use](https://github.com/henryh/outask/blob/v1.1/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.1/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.1/app/mcp/README.md)
