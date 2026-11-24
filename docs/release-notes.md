Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.11/Outask-1.11-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.11/Outask-1.11-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.11/Outask-1.11-windows-x64.tar.gz)

## What's new

- Configuration uses the Outask application directory, and project schemas default to `tasks/task-schema.json`. Explicit custom paths remain available; see [installation details](https://github.com/henryh/outask/blob/v1.11/docs/install.md#installation-details).
- Stored tasks require an explicit `status`. Reads and validation identify missing values for correction while preserving task records.

## Install

Requires Node.js 22.23.3 or later on PATH. Extract the archive and open the directory Outask in a terminal.

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

- [Basic use](https://github.com/henryh/outask/blob/v1.11/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.11/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.11/app/mcp/README.md)
