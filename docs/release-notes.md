Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.10/Outask-1.10-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.10/Outask-1.10-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.10/Outask-1.10-windows-x64.tar.gz)

## What's new

- Install the [Plan to Tasks skill](https://github.com/henryh/outask/blob/v1.10/docs/outask-skill.md#install-plan-to-tasks-in-codex-cli) from the Outask source checkout. On Linux, use it in Codex CLI to save an agreed plan as Outask tasks, reuse matching records and resume work by ID.

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
