Outask is a lightweight task tracker for personal projects and your AI harness.

## Downloads

- [Linux x64](https://github.com/henryh/outask/releases/download/v1.8/Outask-1.8-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/henryh/outask/releases/download/v1.8/Outask-1.8-macos-arm64.tar.gz)
- [Windows x64](https://github.com/henryh/outask/releases/download/v1.8/Outask-1.8-windows-x64.tar.gz)

## What's new

- Finish archive installation with a clear `outask` command and a quoted command for immediate use. Keep installation messages visible in automatically closing windows without pausing persistent terminals.
- Use simpler CLI examples from the project directory, with explicit paths when selecting another project.

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
