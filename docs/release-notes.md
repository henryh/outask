Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.6/Outask-1.6-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.6/Outask-1.6-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.6/Outask-1.6-windows-x64.tar.gz)

## What's new

- Install, update and remove Outask through npm, with both `outask` and `tasks` commands and the same local MCP adapter. See the [installation and update guide](https://github.com/henryh/outask/blob/v1.6/app/README.md#installation-and-updates).

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

- [Basic use](https://github.com/henryh/outask/blob/v1.6/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.6/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.6/app/mcp/README.md)
