## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.5/Outask-1.5-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.5/Outask-1.5-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.5/Outask-1.5-windows-x64.tar.gz)
- [SHA256SUMS](https://github.com/henryh/outask/releases/download/v1.5/SHA256SUMS)

## Current version

Outask keeps project tasks in local JSON files, with CLI and local MCP access.

## What's new

- Use `outask` as the canonical command. `tasks` is a permanent equivalent command, including MCP startup.
- CLI help, MCP service metadata and the source HTTP adapter identify the product as Outask.
- Keep application files, default configuration and read caches in one stable platform Outask directory while preserving task data and unrelated files.
- Consolidate generated shell PATH blocks and replace managed launchers for both commands during installation and updates.
- Download one Outask archive for your platform. Existing command links from an unrecognised layout need removal with that installation's own installer before replacement.
- Before starting this Windows writer generation, finish active writes and close all previous CLI/MCP/HTTP sessions; do not mix generations. Compatible updates within one generation preserve sessions.
- Verify downloaded archives with the release's `SHA256SUMS` file before installing. Publication and retries check all three archives and their checksums; native download acceptance checks each published archive. See the [platform verification commands](https://github.com/henryh/outask/blob/v1.5/docs/releases.md#verify-a-download). Checksums verify file integrity and are not a signature of origin.

## Install

Requires Node.js 22.23.3 or later on PATH.
On macOS, use the [official Node.js installer](https://nodejs.org/en/download) or another provider; Homebrew is optional.
Extract the archive. Open the directory Outask in a terminal.

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
outask create --title "Write release notes"
outask list --format table
```

## Documentation

- [Basic use](https://github.com/henryh/outask/blob/v1.5/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.5/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.5/app/mcp/README.md)
