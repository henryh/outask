Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.10.1/Outask-1.10.1-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.10.1/Outask-1.10.1-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.10.1/Outask-1.10.1-windows-x64.tar.gz)

## What's new

- The schemas for `create_task` and `update_task` pass MCP Inspector’s portability check. Both tools support mixed JSON values in custom fields and patch arrays.
- Global npm installations can check for and install updates with `outask self update` on npm 12.

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

- [Basic use](https://github.com/henryh/outask/blob/v1.10.1/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.10.1/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.10.1/app/mcp/README.md)
