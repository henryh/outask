## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.2.1/OutaskAI-1.2.1-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.2.1/OutaskAI-1.2.1-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.2.1/OutaskAI-1.2.1-windows-x64.tar.gz)

## Current version

Outask AI keeps project tasks in local JSON files, with CLI and local MCP access.

## What's new

- Keep new and changed task arrays and objects readable with multiline, two-space JSON formatting.
- Preserve untouched task fields and neighbouring records, including their original formatting; no-op updates leave files and timestamps unchanged.
- Update MCP dependencies to patched releases.
- Connect installed MCP clients through `tasks mcp` on PATH, with clearer setup and restart guidance.

## Install

Requires Node.js 22.23.3 or later on PATH.
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

- [Basic use](https://github.com/henryh/outask/blob/v1.2.1/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.2.1/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.2.1/app/mcp/README.md)
