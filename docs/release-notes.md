## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.1/OutaskAI-1.1-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.1/OutaskAI-1.1-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.1/OutaskAI-1.1-windows-x64.tar.gz)

## Current version

Outask AI keeps project tasks in local JSON files, with CLI and local MCP access.

## What's new

- List and count tasks in a fresh project before the first write.
- See cache defaults and supported page sizes in MCP tool descriptions.
- Install despite an inaccessible unrelated PATH directory; conflicting commands remain protected.
- Install, update and remove the command through one platform-specific installer.
- Use concise installation, CLI and MCP instructions, with platform-specific archive guides.

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

- [Basic use](https://github.com/henryh/outask/blob/v1.1/README.md#basic-use)
- [Full operator reference](https://github.com/henryh/outask/blob/v1.1/app/README.md)
- [MCP setup](https://github.com/henryh/outask/blob/v1.1/app/mcp/README.md)
