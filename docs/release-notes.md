## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.4/OutaskAI-1.4-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.4/OutaskAI-1.4-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.4/OutaskAI-1.4-windows-x64.tar.gz)

## Current version

Outask AI keeps project tasks in local JSON files, with CLI and local MCP access.

## What's new

- Update to the latest stable release with `./install.sh update` on Linux, `./Install.command update` on macOS or `Install.cmd update` on Windows.
- Preserve project tasks, configuration and compatible running sessions through updates; report an already-current installation without reinstalling.
- Mark stable publications as GitHub Latest explicitly; prereleases keep the existing stable selection.

## Install

Requires Node.js 22.23.3 or later on PATH.
On macOS, use the [official Node.js installer](https://nodejs.org/en/download) or another provider; Homebrew is optional.
Extract the archive. Open the directory OutaskAI in a terminal.

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
tasks create --title "Write release notes"
tasks list --format table
```

## Documentation

- [Basic use](https://github.com/henryh/outask/blob/v1.4/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.4/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.4/app/mcp/README.md)
