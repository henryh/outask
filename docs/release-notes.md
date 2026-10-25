## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.2.2/OutaskAI-1.2.2-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.2.2/OutaskAI-1.2.2-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.2.2/OutaskAI-1.2.2-windows-x64.tar.gz)

## Current version

Outask AI keeps project tasks in local JSON files, with CLI and local MCP access.

## What's new

- Identify version output as `Outask AI v<version>` for both `tasks -v` and `tasks --version`.
- Keep running MCP sessions and active writes intact during compatible updates; clients can restart sessions when convenient to load the new version.
- Clarify update guidance and verify a live MCP session remains usable while installed application files are replaced.

## Install

Requires Node.js 22.23.3 or later on PATH.
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

- [Basic use](https://github.com/henryh/outask/blob/v1.2.2/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.2.2/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.2.2/app/mcp/README.md)
