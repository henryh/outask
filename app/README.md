# Outask AI operator cookbook

Install a release with the [quick start](../README.md#install-the-cli).
For a source checkout, run from the repository root (Node.js 22.23.3 or later):

```bash
npm ci --prefix app --omit=dev
node app/scripts/install-cli.mjs install
tasks --help
```

Keep the checkout; remove its command with `node app/scripts/install-cli.mjs uninstall`.
Use `tasks --help`, [MCP](mcp/README.md) or read-only [HTTP](HTTP.md) as needed.

## Installation and updates

Open a new terminal after installation; restart an editor with an old PATH.

| Platform | Installed application | Command |
| --- | --- | --- |
| Linux | `~/.local/share/task-tracker/releases/OutaskAI` | `~/.local/bin/tasks` |
| macOS | `~/Library/Application Support/OutaskAI` | `~/.local/bin/tasks` |
| Windows | `%USERPROFILE%\AppData\Local\Programs\OutaskAI` | `%USERPROFILE%\AppData\Local\OutaskAI\bin\tasks.cmd` |

On macOS, put Node.js 22.23.3 or later on PATH using the
[official installer](https://nodejs.org/en/download) or another provider.
Homebrew is optional. The installer checks Node startup/version and preserves
loader diagnostics. With confirmation, it repairs Node through installed
Homebrew or NVM, then checks again. Outask bundles neither provider.

Double-click `Install.command` or run `./Install.command`. If macOS blocks this
unsigned launcher, use [Apple's Open Anyway instructions](https://support.apple.com/en-us/102445)
for a release you trust. Keep Gatekeeper enabled.

From the installed OutaskAI directory, update to GitHub Latest stable with `./install.sh update` on Linux, `./Install.command update` on macOS, `./Install.cmd update` in PowerShell or `Install.cmd update` in cmd.exe. Requires network access and tar on PATH. An already-current installation reports no change; a failed update preserves the working installation.

Let existing MCP/HTTP sessions and active writes finish normally. Existing sessions may retain their loaded version; fresh launches use the update and `tasks --version` reports `Outask AI v<version>`.
Managed files are replaced; user files, tasks and configuration remain. Resolve
an unrelated `tasks` collision explicitly. Custom installations must reuse the
same `--bin-dir` and `--release-root` when updating or removing the command.

From the installed application's directory, remove the command with
`./install.sh uninstall` on Linux, `./Install.command uninstall` on macOS,
`./Install.cmd uninstall` in PowerShell or `Install.cmd uninstall` in cmd.exe.
Application files and project data remain;
PATH/profile settings remain. Move any user files before removing the application.

## Selecting a project

```bash
tasks list --limit 10
tasks list --project-path /work/my-project --limit 10
tasks get --project my-project 42 --fields id,title,status
```

No selector means the current directory, without ancestor search. A positional
project path or `--project-path` selects a directory; `--project` selects a
configured name. Choose one. Relative paths resolve from the caller's directory.
See [configuration](#configuration) for names and schema selection.

## Task commands

```bash
tasks list --fields id,title,status --limit 10
tasks get 42 --fields id,title,status,updated_at
tasks get-many --id 42 --id 7 --fields id,title,status
tasks search "release notes"
tasks deps 42 --depth 3
tasks get 42 --store all
```

Replace example IDs with existing IDs. Reads default to Active; request history
explicitly. Follow the printed continuation for the next page. JSON readers use
`--format json` and the returned offset/cursor without changing their query.
Use `--no-cache` to bypass the disposable cache. A truncated blocker graph
cannot prove that no cycle exists.

## Creating tasks

```bash
tasks create --title "Implement export" --priority high
tasks create --input new-task.json
```

`--input` reads a UTF-8 JSON object; `-` reads stdin. Creation input is the task
object. Use a file for extension fields or to avoid shell-specific JSON quoting.
Flags and JSON may supply different fields, never the same field twice.
Creation allocates an ID when omitted. Project rules may require additional
fields or custom statuses. Unknown fields are preserved.

## Partial updates

```bash
tasks update 42 --title "Implement CSV export"
tasks update 42 --input patch.json --if-updated-at 2026-09-19T12:00:00.000Z
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
tasks transition 42 --status in_progress
tasks transition 42 --status done
tasks transition 42 --status cancelled
tasks transition 42 --status pending
tasks get 42 --store all
```

Use configured statuses; working statuses reject Active blockers. Archive
retains the record and ID; moving to Active restores it. Supply required
completion fields through `update`; no completion date is invented. Use
`--store` for an ambiguous destination.

If a write is interrupted or reports `WRITE_INCOMPLETE`, inspect the saved ID
before retrying; creation may already have succeeded. A pending move journal
causes reads to report `RECOVERY_REQUIRED`. Run `tasks validate` to finish it.
Never delete `tasks/.task-tracker.pending` to bypass recovery. For
`RECOVERY_CONFLICT`, preserve the journal and current files and reconcile external
edits with its saved before/after state. After recovery, reread before retrying.
After a crashed writer stops, its OS lock releases; leftover UUID `.tmp` files
may then be removed. See the [shared contract](../docs/contract.md) for guarantees.

## Validation and manual edits

```bash
tasks validate
git diff -- tasks
```

Preserve IDs, unknown fields and existing records. After manual task/schema
edits, validate and review refreshed `tasks/.task-tracker.json` alongside the
intended changes. Advance an edited record's existing `updated_at` to a later
canonical UTC millisecond timestamp so stale callers can detect the change.
Reads may prepare missing service metadata; reads and ordinary validation leave
task records unchanged. Validation can complete a pending coordinated move.
The tracker never stages or commits files. Correct invalid metadata and retry.

## Project locks and upgrades

All cooperating writers must run as the same OS user on one host with local
filesystems. Ordinary compatible upgrades preserve running sessions and writes.
For a release requiring an incompatible coordination-protocol migration, let
active writes finish and arrange for affected clients to close their old sessions
normally before starting writers using the new protocol. Stop old presence-lock
writers before removing a legacy `tasks/.task-tracker.json.lock`; its presence
fails closed with `PROJECT_BUSY`.
An absent legacy file does not establish that older writers have stopped.

Retained SQLite coordination files do not mean a lock is held. Never remove or
replace them while any tracker process may run. Optional cleanup requires all
that user's tracker processes to stop. Keep the coordination directory on a local
filesystem and exclude it from cleanup while writers run. Manual editors do not
participate in the lock protocol.

## Git hooks

```bash
tasks hook --install
tasks hook --remove
```

The optional hook validates working-tree files, including unstaged edits; it
does not certify partially staged data. Review and stage the intended task,
schema and service bytes yourself. Keep the install's absolute validator path
and Node available; remove the hook before moving them.
Existing/edited hooks are preserved. Shared hooks, linked worktrees and nested
projects require manual integration: add the printed validator invocation with
its failure handling to the existing hook, preserving its checks. Remove only
that line to undo manual integration. A hook never stages refreshed metadata.

## Configuration

`--config` selects the global registry; then `TASK_TRACKER_CONFIG`, then
`$XDG_CONFIG_HOME/task-tracker/config.json` or `~/.config/task-tracker/config.json`.
It can map `projects` names to absolute paths, define an absolute `projects_root`
and set `slow_query_ms`. Conflicting name locations require an explicit path.

## Schema

```bash
tasks schema
tasks schema --write
```

Schema selection uses `tasks/task-schema.json`, then existing
`docs/task-schema.json`. If both exist, choose with `--schema-path`; an explicit
path is project-relative, must exist and cannot use symlinks.
`--config` does not select a schema. `schema --write` refuses an existing file;
use `--write --replace` only when you intend to expand the current schema while
preserving custom rules. Validate after schema changes. See the
[shared data contract](../docs/contract.md) for configuration and field rules.
