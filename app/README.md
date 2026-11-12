# Outask operator cookbook

Install a release with the [quick start](../README.md#install-the-cli). For a source checkout, run from the repository root (Node.js 22.23.3 or later):

```bash
npm ci --prefix app --omit=dev
node app/scripts/install-cli.mjs install
outask --help
```

Keep the checkout; remove its command with `node app/scripts/install-cli.mjs uninstall`. Use `outask --help`, [MCP](mcp/README.md) or read-only [HTTP](HTTP.md) as needed.

## Installation and updates

Run `outask self update` to update an installed archive or global npm installation on Linux, macOS or Windows. Run `outask self update --check` to check release availability. Both commands work from any directory; `tasks self update` is equivalent. Archive updates use GitHub Latest stable; npm updates use the configured registry and the running installation's prefix. See the [npm quick start](../docs/npm.md) and [footprint rules](../docs/contract.md#product-identity-and-installation-footprint). Open a new terminal after installation and restart an editor to refresh its PATH.

`--check` exits with 0 when current or newer than stable, 10 when an update is available, 2 for an unsupported installation context, and 1 on failure. Checks preserve application and project files; npm may write cache/logs. Follow the printed update guidance for source checkouts, local npm/npx and unrecognised installations. Installed versions newer than stable are retained.

| Platform | Installed application | Command |
| --- | --- | --- |
| Linux | `~/.local/share/outask` | `~/.local/bin/outask` |
| macOS | `~/Library/Application Support/Outask` | `~/.local/bin/outask` |
| Windows | `%LOCALAPPDATA%\Programs\Outask` | `%LOCALAPPDATA%\Programs\Outask\commands\outask.cmd` |

On macOS, put Node.js 22.23.3 or later on PATH using the
[official installer](https://nodejs.org/en/download) or another provider.
The installer checks Node startup/version and preserves
loader diagnostics. With confirmation, it repairs Node through installed
Homebrew or NVM, then checks again.

Double-click `Install.command` or run `./Install.command`. If macOS blocks this
unsigned launcher, use [Apple's Open Anyway instructions](https://support.apple.com/en-us/102445)
for a release you trust. Keep Gatekeeper enabled.

Before switching installation layouts, finish writes, close running sessions, remove command links with that installation's installer and refresh explicit client/hook references. Archive updates require network access and tar on PATH; a failed archive update preserves the working installation. Global npm updates use npm's failure handling and require write permission to the selected prefix.

Let existing MCP/HTTP sessions and active writes finish normally. Existing sessions may retain their loaded version; fresh launches use the update and `outask --version` reports `Outask v<version>`.
Managed files are replaced; user files, tasks and configuration remain. Resolve
an unrelated `tasks` collision explicitly. The self updater retains custom paths. Keep the installation's command directory on PATH. Reuse its `--bin-dir` and `--release-root` when invoking installer update/uninstall actions directly.

From the installed application's directory, remove the command with
`./install.sh uninstall` on Linux, `./Install.command uninstall` on macOS,
`./Install.cmd uninstall` in PowerShell or `Install.cmd uninstall` in cmd.exe.
Application files and project data remain;
PATH/profile settings remain. Move any user files before removing the application.

## Verify a download

Before extracting, download `SHA256SUMS` from the same release and follow the [platform verification commands](../docs/releases.md#verify-a-download).

## Selecting a project

```bash
outask list --limit 10
outask list --project-path /work/my-project --limit 10
outask get --project my-project 42 --fields id,title,status
```

The default project is the current directory. A positional project path or `--project-path` selects a directory; `--project` selects a
configured name. Choose one. Relative paths resolve from the caller's directory.
See [configuration](#configuration) for names and schema selection.

## Task commands

```bash
outask list --fields id,title,status --limit 10
outask get 42 --fields id,title,status,updated_at
outask get-many --id 42 --id 7 --fields id,title,status
outask search "release notes"
outask deps 42 --depth 3
outask get 42 --store all
```

Replace example IDs with existing IDs. Reads default to Active; request history
explicitly. Follow the printed continuation for the next page. JSON readers use
`--format json` and reuse their query with the returned offset/cursor.
Use `--no-cache` to bypass the disposable cache. A truncated blocker graph
cannot prove that no cycle exists.

## Creating tasks

```bash
outask create --title "Implement export" --priority high
outask create --input new-task.json
```

`--input` reads a UTF-8 JSON object; `-` reads stdin. Creation input is the task
object. Use a file for extension fields or to avoid shell-specific JSON quoting.
Flags and JSON may supply different fields, never the same field twice.
Creation allocates an ID when omitted. Project rules may require additional
fields or custom statuses. Unknown fields are preserved.

## Partial updates

```bash
outask update 42 --title "Implement CSV export"
outask update 42 --input patch.json --if-updated-at 2026-09-19T12:00:00.000Z
```

Replace the timestamp with the task's last-read `updated_at`. A patch file is an
object such as `{"set":{"scope":"CSV output"},"add":{"tags":["export"]}}`.
`set` replaces whole values; `add` appends unique array elements; `remove`
removes equal elements; `unset` removes optional fields. IDs and `updated_at`
are tracker-owned.
Use `--if-updated-at` when replacing content from an earlier read; on
`TRANSITION_CONFLICT`, reread and reconcile before retrying.

## Statuses and recovery

```bash
outask transition 42 --status in_progress
outask transition 42 --status done
outask transition 42 --status cancelled
outask transition 42 --status pending
outask get 42 --store all
```

Use configured statuses; working statuses reject Active blockers. Archive
retains the record and ID; moving to Active restores it. Supply required
completion fields through `update`. Use
`--store` for an ambiguous destination.

If a write is interrupted or reports `WRITE_INCOMPLETE`, inspect the saved ID
before retrying; creation may already have succeeded. A pending move journal
causes reads to report `RECOVERY_REQUIRED`. Run `outask validate` to finish it.
Never delete `tasks/.task-tracker.pending` to bypass recovery. For
`RECOVERY_CONFLICT`, preserve the journal and current files and reconcile external
edits with its saved before/after state. After recovery, reread before retrying.
After a crashed writer stops, its OS lock releases; leftover UUID `.tmp` files
may then be removed. See the [shared contract](../docs/contract.md) for guarantees.

## Validation and manual edits

```bash
outask validate
git diff -- tasks
```

Preserve IDs, unknown fields and existing records. After manual task/schema
edits, validate and review refreshed `tasks/.task-tracker.json` alongside the
intended changes. Advance an edited record's existing `updated_at` to a later
canonical UTC millisecond timestamp so stale callers can detect the change.
Reads may prepare missing service metadata; reads and ordinary validation leave
task records unchanged. Validation can complete a pending coordinated move.
Correct invalid metadata and retry.

## Project locks and upgrades
All cooperating writers use the same OS user, host and local filesystem.
Before changing coordination locations or protocol generations, finish active writes and close CLI/MCP/HTTP sessions. Start upgraded writers together on one generation. Compatible updates within a generation preserve running sessions.
A `tasks/.task-tracker.json.lock` causes `PROJECT_BUSY`; confirm that its writers have stopped before removing it.

Keep SQLite coordination files in place while tracker processes run. Optional cleanup requires all that user's tracker processes to stop. Keep the coordination directory on a local filesystem. Coordinate manual edits with running writers.

## Git hooks
```bash
outask hook --install
outask hook --remove
```

The optional hook validates working-tree files, including unstaged edits. Review and stage the intended task, schema and service bytes yourself. Automatic installation uses an absolute validator path; keep that install and Node available and remove its hook before moving them.

Existing/edited hooks are preserved. For an existing repository-root `pre-commit`, keep its other checks and add:
```sh
outask validate || exit $?
```

Git invokes `pre-commit` from the working-tree root, so this uses the current project. Keep `outask` on PATH. Shared hooks, linked worktrees and nested projects need manual integration appropriate to their target; use the printed invocation when an explicit target or schema is needed. Remove only the added validation line to undo integration.

## Configuration
`--config` selects the global registry; then `TASK_TRACKER_CONFIG`, then
the platform Outask root's `config.json`. Explicit `XDG_CONFIG_HOME` selects
`$XDG_CONFIG_HOME/outask/config.json`; explicit `XDG_CACHE_HOME` selects
`$XDG_CACHE_HOME/outask/cache`. Otherwise disposable indexes live in `cache/`
inside the Outask root. Registry migration links source filenames to the canonical registry. Conflicting registries require reconciliation.
It can map `projects` names to absolute paths, define an absolute `projects_root`
and set `slow_query_ms`. Conflicting name locations require an explicit path.

## Schema
```bash
outask schema
outask schema --write
```

Schema selection uses `tasks/task-schema.json`, then existing
`docs/task-schema.json`. If both exist, choose with `--schema-path`; an explicit
path is project-relative, must exist and cannot use symlinks.
Use `--schema-path` to select a schema and `--config` to select the registry. `schema --write` refuses an existing file;
use `--write --replace` only when you intend to expand the current schema while
preserving custom rules. Validate after schema changes. See the
[shared data contract](../docs/contract.md) for configuration and field rules.
