Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.9/Outask-1.9-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.9/Outask-1.9-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.9/Outask-1.9-windows-x64.tar.gz)

## What's new

- Archive and source-checkout uninstall now remove installed application files, default global configuration and caches while keeping project/skill data, source checkouts, custom configuration files and unrelated files.
- Select projects from their working directory or by an explicit path. Global settings now use only `slow_query_ms`; project-name selection has been removed.
- Use `OUTASK_CONFIG` for a custom configuration file and `OUTASK_HTTP_TOKEN` for the source HTTP server. See [installation and updates](https://github.com/henryh/outask/blob/v1.9/app/README.md#installation-and-updates) for cleanup and upgrade details.

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

- [Basic use](https://github.com/henryh/outask/blob/v1.9/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.9/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.9/app/mcp/README.md)
