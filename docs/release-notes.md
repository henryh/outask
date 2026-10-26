## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.3/OutaskAI-1.3-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.3/OutaskAI-1.3-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.3/OutaskAI-1.3-windows-x64.tar.gz)

## Current version

Outask AI keeps project tasks in local JSON files, with CLI and local MCP access.

## What's new

- Identify the installed CLI with `tasks --version` as `Outask AI v<version>`.
- Preserve running MCP/HTTP sessions during compatible upgrades; fresh launches use the updated installation.
- Check that macOS Node.js can start and meets the minimum supported version before installation.
- Identify missing Node.js libraries, retain startup diagnostics, offer confirmed Homebrew repairs after approval and provide NVM guidance.
- Discover macOS Node.js through PATH without adding fixed Homebrew locations. Homebrew is optional.

## Install

Requires Node.js 22.23.3 or later on PATH.
On macOS, use the [official Node.js installer](https://nodejs.org/en/download) or another provider; Homebrew is optional.
Extract the archive. Open the directory OutaskAI in a terminal.

Linux:
```sh
./install.sh
```

macOS:
```sh
./Install.command
```

Windows:
```text
./Install.cmd  # PowerShell
Install.cmd   & rem cmd.exe
```

## Run

Open a new terminal. From a project directory:
```sh
tasks create --title "Write release notes"
tasks list --format table
```

## Documentation

- [Basic use](https://github.com/henryh/outask/blob/v1.3/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.3/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.3/app/mcp/README.md)
