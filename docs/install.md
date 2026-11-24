# Install Outask

Use Node.js 22.23.3 or later on PATH. Choose the npm package, a platform archive, or a source checkout.

## npm

Install the [Outask npm package](https://www.npmjs.com/package/outask) using the [npm instructions](npm.md#install).

## Platform archive

Get the archive for your platform from [GitHub Releases](https://github.com/henryh/outask/releases), or use a local copy. [Verify the checksum](releases.md#verify-a-download) with the matching `SHA256SUMS` when available. Extract the archive and run the installer from the extracted `Outask` directory.

| Platform | Installer |
| --- | --- |
| Linux x64 | `./install.sh` |
| macOS Apple silicon | Open `Install.command` in Finder or run `./Install.command` |
| Windows x64 | `./Install.cmd` in PowerShell or `Install.cmd` in cmd.exe |

A local archive includes the application dependencies. It installs offline when the required Node.js runtime is already on PATH. The bundled `Outask/README.md` contains installation and MCP instructions for that release.

## Source checkout

```sh
git clone https://github.com/henryh/outask.git
cd outask
npm ci --prefix app --omit=dev
node app/scripts/install-cli.mjs install
```

Keep the checkout. To remove this installation, run `node app/scripts/install-cli.mjs uninstall` from its root.

## Verify and connect

Open a new terminal and run `outask --version`. See [MCP setup](../app/mcp/README.md) for agent connections and [installation and updates](../app/README.md#installation-and-updates) for PATH, macOS verification, updates and removal.

## Installation details

### Files and configuration

Archive installations use `~/.local/share/outask` on Linux, `~/Library/Application Support/Outask` on macOS, and `%LOCALAPPDATA%\Programs\Outask` on Windows. These roots contain application files, default `config.json` and disposable `cache/`. npm owns its global package directory and command entries, and uses the same default Outask configuration, cache and coordination paths.

Installers create POSIX command links in `~/.local/bin` or add the Windows root's `commands/` directory to user PATH. They consolidate generated shell PATH blocks, including `ZDOTDIR`, while preserving other shell code. Explicit `--bin-dir`, `--release-root`, `--config`, `OUTASK_CONFIG` and XDG paths remain supported choices.

### Updates and removal

Use the [installation and update procedures](../app/README.md#installation-and-updates) for commands, checks and removal. Updates retain the distribution channel, custom paths and newer installed versions. Archive updates stage and back up managed program files beside the application root; the root, registry, cache and coordination inodes stay in place. Successful updates remove staging and backups. The installed `release.json` records the command directory as `bin`; commands can also resolve through PATH.

Installation cleanup recognises managed source payloads by release metadata and package ownership inside known application parents. It preserves unrecognised sibling files. Before changing layouts, remove an installed hook with its original command and refresh explicit client/hook references. Modified hooks require manual integration.

Archive and source-checkout uninstall remove managed commands, confirmed installed payloads, default application/XDG global configuration and application caches. Explicit configuration at arbitrary paths, project/skill data, source checkouts and unrelated files remain. Cleanup never traverses user-managed directory symlinks into external settings or cache data. Existing PATH/profile settings and fixed writer-coordination files remain. npm uninstall preserves configuration, cache, skills and project records; see the [npm guide](npm.md#update-or-remove).
