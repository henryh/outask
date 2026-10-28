## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.5/Outask-1.5-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.5/Outask-1.5-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.5/Outask-1.5-windows-x64.tar.gz)

## Current version

Outask keeps project tasks in local JSON files, with CLI and local MCP access.

## What's new

- Use `outask` as the canonical command. `tasks` and `outaskai` are permanent equivalent commands, including MCP startup.
- CLI help, MCP service metadata and the source HTTP adapter identify the product as Outask.
- Keep application files, default configuration and read caches in one stable platform Outask directory. Migrate recognised old installations and settings while preserving task data and unrelated files.
- Consolidate generated shell PATH blocks and replace managed launchers for all three commands during installation and updates.
- Preserve automatic updates from older versions with compatible `OutaskAI-*` archives alongside the new `Outask-*` downloads. Existing compatible MCP sessions can continue; writer coordination retains its shared legacy namespace.

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
