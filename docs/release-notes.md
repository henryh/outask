Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.7/Outask-1.7-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.7/Outask-1.7-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.7/Outask-1.7-windows-x64.tar.gz)

## What's new

- Read legacy tasks without a status as `pending` in `active.json` and `done` in `done.json`, without rewriting records. Existing schemas need explicit per-store fallbacks; see the [connection guide](https://github.com/henryh/outask/blob/v1.7/docs/outask-skill.md#connect-an-existing-project).
- Follow clearer setup guidance and file/record diagnostics when connecting projects with string fields and custom data.
- Reject malformed JSON with trailing commas consistently in task operations.
- Find clearer npm installation and CLI examples in the [npm guide](https://github.com/henryh/outask/blob/v1.7/docs/npm.md).

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

- [Basic use](https://github.com/henryh/outask/blob/v1.7/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.7/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.7/app/mcp/README.md)
