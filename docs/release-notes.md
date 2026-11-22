Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.10/Outask-1.10-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.10/Outask-1.10-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.10/Outask-1.10-windows-x64.tar.gz)

## What's new

- Find Outask as `io.github.henryh/outask` in clients that import servers from the official MCP Registry. The entry launches the exact npm release over stdio.
- Install [Plan to Tasks](https://github.com/henryh/outask/blob/v1.10/README.md#use-with-an-agent) from the source checkout. Use it in Codex CLI to save agreed work as Outask tasks, reuse matching records and resume work by ID.

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

- [Basic use](https://github.com/henryh/outask/blob/v1.10/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.10/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.10/app/mcp/README.md)
