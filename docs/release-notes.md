Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.8/Outask-1.8-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.8/Outask-1.8-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.8/Outask-1.8-windows-x64.tar.gz)

## What's new

- Update the running archive or global npm installation with `outask self update` on Linux, macOS and Windows, retaining its installation paths and distribution channel.
- Check for a newer stable version without installing with `outask self update --check`. See [installation and updates](https://github.com/henryh/outask/blob/v1.8/app/README.md#installation-and-updates) for check results and other installation contexts.
- Start the macOS installer without a Terminal tab conversion error.

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

- [Basic use](https://github.com/henryh/outask/blob/v1.8/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.8/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.8/app/mcp/README.md)
