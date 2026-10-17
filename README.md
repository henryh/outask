# Outask AI

Outask AI keeps project tasks with your code as readable, repository-local
JSON. Use the `tasks` command yourself or connect a local AI agent through MCP.

## Install the CLI

Outask AI requires Node.js 22.23.3 or later.

1. Open [Releases](https://github.com/henryh/outask/releases) and download the
   archive for your platform from the release description.
2. Extract the archive in a directory you will keep and open a terminal there.
3. Open the extracted `OutaskAI` directory. On Linux/macOS, install it:

   ```bash
   ./install.sh
   ```

Extraction alone does not install the command. A successful installer prints
`Installed OutaskAI at ...` and its command path. On macOS the application is
installed at `~/Library/Application Support/OutaskAI` and the command at
`~/.local/bin/tasks`. Open a new terminal after installation, then run
`tasks --version`.

If the shell reports `Permission denied` when starting `./install.sh`, run
`sh ./install.sh` from the same directory. If installation itself fails, retain
the exact command and error; an agent may need permission to write the user
installation directories. Resolve that failure before continuing setup. For
Finder/Gatekeeper guidance, see the
[macOS installation instructions](app/README.md#distributable-release-archives).
An automated downloader must follow the release asset's HTTP redirects; retain
the HTTP error if the agent's network access prevents the download.

On native Windows x64, run `./install.cmd` in PowerShell or `install.cmd` in
cmd.exe. The Windows archive is `OutaskAI-<version>-windows-x64.tar.gz`; Windows
includes [tar for extraction](https://learn.microsoft.com/en-us/windows/tar/).
Node.js must be installed on PATH; WSL and administrator access are unnecessary.

The Linux/macOS installer creates `~/.local/bin/tasks`. Windows installs the
application at `%USERPROFILE%\AppData\Local\Programs\OutaskAI` and its launcher
at `%USERPROFILE%\AppData\Local\OutaskAI\bin\tasks.cmd`. It adds that command
directory to the current user's persistent Windows PATH, preserves existing
entries, and avoids duplicates on repeat installs. Open a new PowerShell or
cmd.exe terminal afterward; an already-open terminal keeps its old PATH. If PATH
setup fails, the installer prints the absolute launcher path for immediate use.
For updates, run the new archive's installer. To uninstall on Windows, run
`./install.cmd uninstall` in PowerShell or `install.cmd uninstall` in cmd.exe
from the installed application directory. Only the managed launcher is removed;
application files, PATH entries, project tasks, configuration and unrelated files
remain. See [Windows installation](app/README.md#windows-installation) for details.

## Basic use

Run these commands in a project directory. No setup command or manual JSON edit
is required:

```bash
tasks create --title "Write release notes"
tasks list --format table
tasks search "release notes"
tasks transition 1 --status done
```

The first command creates task `1` in a project with no existing tasks. Replace
`1` with the ID shown by `tasks create` when using an existing project.

For more commands, run `tasks --help` or see the
[operator reference](app/README.md).

## Use with an agent (optional)

The release includes the local stdio MCP adapter. Configure an MCP-capable
client to launch the installed command as `tasks mcp`; MCP requires Node.js
22.23.3 or later. On Linux/macOS, open a new terminal and register it with Codex:

```bash
codex mcp add tasks -- tasks mcp
codex mcp list
```

Start a new Codex session to load the server. For client PATH differences and
other clients, see [MCP setup](app/mcp/README.md#codex-on-linuxmacos).

For planning, task selection and session continuation, point the agent to the
maintained [Outask AI agent skill guide](docs/outask-ai-skill.md) and use one
prompt such as:

> Use the Outask AI agent skill guide for this project. Prefer the connected
> `tasks` MCP server, or use the installed CLI if MCP is unavailable. Respect
> the project's instructions and existing tracker, and plan and track this
> request: _describe the work_.

Outask AI manages task data only. Git commits, branches and publishing remain
under your project or agent workflow.

## Contributing

See [contributor setup and PR delivery](docs/contributing.md) for local checks,
explicit push-guard installation and the owner-merged workflow.

## License

Copyright (c) 2026 Henry <me@henrydev.me>.

Outask AI is licensed under the [GNU Affero General Public License version 3 only](LICENSE).
