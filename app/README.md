# Outask AI operator reference

Outask AI keeps tasks with project code as readable JSON and exposes the shared
operations through the `tasks` CLI, optional local stdio MCP and supported
standalone scripts. The public product name does not rename the technical
interfaces: command names, archive names, configuration keys and data files keep
their existing `tasks` and `task-tracker` identifiers.

The list/get/get-many/search, creation, partial updates, lifecycle, local blocker inspection
and validation operations and directly runnable Node.js scripts are implemented.
The scripts and CLI task commands use Node.js and the production dependency
declared in `app/package.json`; the release installer checks the runtime before
installation. Node.js 22.23.3 or later is required. For a source checkout, install that dependency once with
`npm ci --prefix app --omit=dev` before running scripts or the CLI.
Every command operates on one project: omit its path to use the current
working directory, or supply a path to select another directory. Relative paths
resolve from the caller's working directory.

For user installation, see the [root README](../README.md#install-the-cli).
Published release archives include the optional local stdio MCP adapter and its
production dependencies; source-checkout setup remains a development route.
The independent HTTP adapter is implemented for read-only task access; HTTP
writes, HTTP validation and plugin release integration are not supported. Their
references are [HTTP](HTTP.md) and [MCP](mcp/README.md).

## Windows installation

The Windows x64 archive uses the same shared task storage and validation as the
Linux/macOS CLI. Use native Windows with Node.js 22.23.3 or later installed on
PATH. Windows PR CI exercises Node.js 22.23.3 and Node.js 24.
No WSL or administrator account is needed.
Windows includes [tar](https://learn.microsoft.com/en-us/windows/tar/) to extract
`OutaskAI-<version>-windows-x64.tar.gz`. Open the extracted `OutaskAI` directory.

In PowerShell:

```powershell
./install.cmd
```

In cmd.exe:

```bat
install.cmd
```

The stable application directory is
`%USERPROFILE%\AppData\Local\Programs\OutaskAI`; its command is
`%USERPROFILE%\AppData\Local\OutaskAI\bin\tasks.cmd`. The installer writes
only the current user's persistent Windows PATH, preserving raw existing
entries and their registry value type. It adds the command directory once,
including when it was already present with different case or an expandable
user variable. Reopen PowerShell or cmd.exe after installing to run `tasks` by
name. A terminal launched by an already-running terminal or editor can inherit
its old PATH; restart that parent application too. PATH-update failures leave a
usable installation and print the immediate launcher commands for both shells.

From a project directory, use the same commands in either shell:

```text
tasks create --title "Write release notes"
tasks list --format table
tasks search "release notes"
tasks update 1 --title "Reviewed release notes"
tasks transition 1 --status done
tasks validate
```

For arbitrary JSON or custom fields, use `--input "task input.json"` to avoid
shell-specific inline JSON quoting. Files must contain UTF-8 JSON. The managed Windows launcher uses ASCII batch
text and decodes its Unicode application path inside Node, so it also works
from conventional cmd.exe code pages without changing console settings. Project paths,
titles and JSON extension fields can contain Unicode; quote paths with spaces.
The caller's current directory selects project data, independently of the
application location. MCP uses the packaged Node entry directly; see
[Windows MCP configuration](mcp/README.md#windows).

Update by extracting a new archive and running its `install.cmd` using the same
instructions. It replaces managed application files in the stable directory,
removes obsolete program files and preserves unrelated files beside `app/`,
project tasks and configuration. An unrelated installation or existing
`tasks.cmd` command is refused. Close running CLI/MCP processes before an update
so Windows can replace their files. A failed replacement restores the old
application where possible and reports any retained backup.

To uninstall, open the installed application directory and run
`./install.cmd uninstall` in PowerShell or `install.cmd uninstall` in cmd.exe.
Only the managed command launcher is removed; application files, user PATH,
project tasks, configuration and unrelated user files remain. `--bin-dir`
selects the command directory and `--release-root` the parent of `OutaskAI` for
both install and uninstall. Use the same overrides when updating/removing a
custom installation.

The source installer also creates a Windows `tasks.cmd` launcher and configures
user PATH with `node app/scripts/install-cli.mjs install`; uninstall uses
`node app/scripts/install-cli.mjs uninstall`. Keep the checkout and production
dependencies present. This route does not copy the application.

## Inspecting and materialising the task schema

```bash
tasks schema
tasks schema --write
# Explicit replacement expands the current schema while retaining custom fields:
tasks schema --write --replace
```

Inspection returns the effective configuration as readable JSON: stores,
Active/Done/Archive groups, creation format and applicable default/working
statuses. Without configuration it includes all three standard stores, even
when history files do not yet exist. Inspection needs no task files and creates
only normal missing service metadata. This command always emits JSON, because
its result is an editable configuration document; task projections and table/ID
formats do not apply.

`--write` saves that same JSON at the selected schema path. With no schema,
this is `tasks/task-schema.json`. Existing legacy `docs/task-schema.json` and
explicit `--schema-path` selections use the normal shared selection rules;
explicit paths must already exist. `--write` refuses an existing schema with
`FILE_EXISTS` unless `--replace` is supplied. `--replace` requires `--write`.
It expands the current configuration rather than resetting it to stock defaults.
Custom fields and rules survive replacement. No task records or task stores
are created or changed. Existing retained stores must pass shared validation
before writing; invalid records, unsafe paths and oversized output leave schema
and task bytes unchanged. An empty project can get a skeleton before its first
task, but shared validation still needs at least one task store.

For custom statuses, groups are inferred using the existing standard-filename
rules; otherwise configure missing activity groups first. An undeclared implicit
`pending` creation default remains omitted rather than inventing a new status.
The default working set includes only declared `in_progress`/`review` statuses;
if either maps outside Active, its implicit setting stays omitted. Explicit
settings remain unchanged. Schema responses have the shared 32 KiB limit.

Core callers use `inspectSchema(projectPath, {schemaPath})` or
`materialiseSchema(projectPath, {schemaPath, replace})` from `src/schema.mjs`.
[MCP](mcp/README.md) exposes `inspect_schema` and `materialise_schema`;
[HTTP](HTTP.md) exposes only `GET /schema`. After materialisation or manual
schema edits, run `tasks validate` to refresh service fingerprints. Ordinary
task writes also detect the changed schema and validate before writing.

## Installed CLI

The `tasks` CLI implements `list`, `search`, `get`, `get-many`, `deps`, `validate`, `schema`, `create`, `update`,
`transition` and `hook`, using the same handlers, validation and output as the standalone
scripts. Run `tasks` for a brief command guide, `tasks --help` for full guidance,
and `tasks list --help` for command options. Full help gives a product overview,
commands, quick tips and the repository link. Help does not prepare a project.
Print the installed distribution version with either `tasks --version` or `tasks -v`;
these options do not require a task project.
The commands below describe the development checkout installer. For local
release testing from the repository root, use `make install-local-release` on
POSIX or `node scripts/install-local-release.mjs` on Windows (Make is unnecessary).
Both routes honour the optional `BIN_DIR` and `RELEASE_ROOT` environment overrides.

```bash
npm ci --prefix app --omit=dev
node app/scripts/install-cli.mjs install
command -v tasks
tasks --help
tasks --version
tasks list --status in_progress --format table
tasks search "release notes"
tasks get 9 --fields id,title,scope,acceptance
tasks get-many --id 9 --id 12 --fields id,title,status
tasks deps 9 --depth 3 --format json
tasks validate --format json
```

On POSIX, the development installer creates
`~/.local/bin/tasks` as a symlink to this checkout's
`app/bin/tasks`. Add `~/.local/bin` to `PATH` if needed. The installer refuses
an unrelated target (including a dangling link) or an unrelated executable
`tasks` already on `PATH`; it never replaces one. Resolve that collision
explicitly before installing. `--bin-dir <directory>` chooses a different
installation directory for both install and uninstall. Repeating install for
this checkout is safe and reports the existing link. Managed stable and legacy
release links can be switched to this checkout. When replacing a release
installed with a custom `--release-root`, pass its parent directory here.

The entry resolves its actual installation through symlinks, including chained
links. Node is found on `PATH`. The caller's working directory selects project
data, independently of the installation location. Keep the checkout present.
To update, update this checkout using your normal Git workflow and rerun the
install command; the symlink already points at the changed code. When moving to
a different checkout, uninstall from the original checkout first. Uninstall:

```bash
node app/scripts/install-cli.mjs uninstall
```

Uninstall removes only the managed command link and leaves its containing
directory and application copies. Installation, updates and removal never migrate, copy or delete
project task stores, service metadata, global config or skills. Dependencies
stay inside this checkout; no global package installation is needed.

## Distributable release archives

Build application archives with `make release`, or select a target:

```bash
make release TARGETS=linux-x64
```

Targets are `linux-x64`, `macos-arm64` and `windows-x64`; `make release` builds all three. Artifacts
are written to `dist/OutaskAI-<distribution-version>-<target>.tar.gz`. Each
extracts into `OutaskAI/` and contains the CLI, its runtime modules, the installer
and concise usage instructions. Open that directory to run `./install.sh` on
Linux/macOS, or follow [Windows installation](#windows-installation) to run
`./install.cmd` in PowerShell or `install.cmd` in cmd.exe. The CLI
uses Node.js installed on the user's computer. Build and upload target overrides
and release download links must use the supported targets.

Windows archive composition is covered by cross-build checks. Native Windows
x64 CI verifies installation and the packaged CLI/MCP workflow.

Releases are published by the [owner-approved release PR workflow](../docs/releases.md).
A release candidate includes `app/package.json`, its matching lockfile and the
exact `docs/release-notes.md`. It may include task implementation and closure
when the owner requests combined delivery. Its title is
`Outask AI v<distribution-version>`; the owner's merge approves version, scope
and notes. PR CI checks the actual archives before readiness through the same
workflow used after merge. Merged-main CI and native checks of all three archives must pass before
automated tagging/publication. Ordinary PRs do not publish. Operators must not
manually tag or upload releases. Retry failed publishing jobs to reuse verified
archives; published release contents are never replaced.

The workflow calls `scripts/release-upload.mjs` with `RELEASE_NOTES_FILE` pointing
to the approved file. This internal publication helper stages missing assets in
a draft, verifies existing assets by size/SHA256 and preserves the approved
notes. It publishes only when all three archives are present. `TARGETS` can
limit build work or draft uploads, but publication and the notes always require
all three supported targets.
Publication sets the GitHub Release title separately. A zero-patch package
version uses compact major.minor distribution identifiers everywhere outside
package metadata: package `0.12.0` uses tag `v0.12`, title and CLI output `0.12`,
and `0.12` in archive names, download URLs and archive documentation. A non-zero
patch such as `0.12.1` remains complete. `app/package.json` and its lockfile are
the sole exception and retain three-component SemVer. Historical releases are
unchanged. The approved description file starts with `## Downloads` and
must not repeat the release title as a body heading. Publication validates the
required structure, including Node.js 22.23.3 or later and separate Linux/macOS,
Windows PowerShell and cmd.exe installation blocks, before any GitHub change and uses the file without generating
replacement text.

On Linux/macOS, extract the archive in a directory you will keep, open its
`OutaskAI` directory and run:

```bash
./install.sh
```

On macOS, you can also double-click `Install.command` in Finder. It runs the same
installer and pauses for any key so you can read the result. After success it
attempts to close only its own idle, single-tab Terminal window after the original
Terminal session shell ends. Other windows and tabs are preserved. The launcher does not close a
manually invoked window or a failed installation. If automation is denied or no
safe window is confirmed, use Cmd+W to close it when ready. Terminal preferences are unchanged.
Native Finder window closure needs macOS verification. Node.js must be
installed and available on PATH; the Finder launcher also checks the usual
Homebrew and Node.js installer command directories.

The current `Install.command` launcher is unsigned and not notarised. If macOS
reports that Apple cannot verify it, follow
[Apple's instructions](https://support.apple.com/en-us/102445): after attempting
to open this release's launcher, open System Settings > Privacy & Security,
choose Open Anyway for `Install.command`, then confirm Open. Alternatively,
open the extracted `OutaskAI` directory in a terminal and run `sh ./install.sh`.
Both routes use the same installer; do not disable Gatekeeper globally.

Extraction alone does not install the command. A successful installer prints
`Installed OutaskAI at ...` and the managed command path. Keep the exact command
and stderr if installation fails. An agent may need permission to write the
user installation directories; resolve that failure before continuing with
[Codex/MCP setup](mcp/README.md#codex-on-linuxmacos).

On Linux/macOS, the installer checks dependencies and creates `~/.local/bin/tasks`. Its default
application directory is `~/Library/Application Support/OutaskAI` on macOS and
`~/.local/share/task-tracker/releases/OutaskAI` on Linux. No administrator access
is needed. Both release and development installers persist the command directory
in zsh `.zprofile` and, on Linux, `.zshrc` (under `$ZDOTDIR` when set), or bash
`.bashrc` and the first existing login profile (`.bash_profile`, `.bash_login`,
`.profile`). For a
new bash login profile, macOS uses `.bash_profile` and Linux uses `.profile`.
Existing profile content and permissions are preserved; repeated installs do not
repeat the setting. Open a new terminal afterward. The installer also prints an
absolute command for immediate use.
Unsupported shells or profile write errors receive manual setup guidance; an
already installed command remains usable. Uninstall leaves the profile setting.

To update, extract the new archive and run its installer. It validates a fresh
staged application before replacing managed `app/`, `bin/` and installer/support
files in the stable `OutaskAI` directory. Obsolete program files are removed;
unrelated top-level files, project tasks and configuration are preserved. A failed
replacement restores the previous application. Previous versioned installations
are retained, and their managed command link migrates to the stable application.
Repeating installation, including from the installed directory, is safe.
Use `--bin-dir <directory>` for the command directory or
`--release-root <parent-directory>` for the parent of `OutaskAI`, consistently in
the archive and development installers.

To remove the command, open the installed release directory printed by the
installer and run:

```bash
./install.sh uninstall
```

Supply the same `--bin-dir` if you used a custom command directory.

You may remove the application directory after moving any user files or projects
kept there. Project tasks and configuration elsewhere remain in their locations.

### Optional pre-commit validation

Opt in separately after preparing task stores. Requires Git and the same POSIX
and Node environment as the CLI installer. Ordinary task commands and CLI
installation leave hooks alone.

```bash
tasks hook --install
tasks hook --project-path /work/my-project --remove
# Without the installed CLI:
node app/scripts/hook.mjs /work/my-project --install
```

`hook` uses the same CLI project selectors and current-directory default as
other commands. Choose exactly one of `--install` and `--remove`. Automatic
installation requires the selected project to be the Git working-tree root.
It uses Git's resolved `core.hooksPath` (relative or absolute) or the default
hooks directory, without changing Git configuration. Each commit invokes the
existing shared validator for that selected project, using this checkout's
absolute script path and `node` on PATH. Keep both available; uninstall before
moving the checkout or project. Generated hooks and manual integration guidance
intentionally use this explicit invocation: Git runs hooks noninteractively, so
they cannot rely on interactive shell aliases or the installed `tasks` command
being on that environment's PATH. The absolute script path also avoids depending
on the hook's working directory; `node` must still be on its PATH.

**This validates working-tree files, not the Git index.** Invalid unstaged task
edits can block a commit whose staged data is valid. Conversely, invalid staged
data can be committed if working-tree data is valid. Partial staging is therefore
not certified by this hook. Run `tasks validate`, review the task/schema changes
and refreshed `tasks/.task-tracker.json`, and explicitly stage the intended bytes
before committing. Successful hook validation may refresh service metadata in
the working tree; it never stages it. No command here commits, changes ignore
rules or installs into skills. Missing or bypassed hooks do not weaken the
validator, ID freshness checks or normal write validation.

An existing hook (including a non-executable file, symlink or edited tracker
hook) is never overwritten or removed. Shared/external hook directories,
including symlinks leading outside the selected root and linked-worktree shared
hooks, require manual integration. Repositories with existing linked worktrees
also require manual integration, even from the main checkout. If a worktree is
created after installation and invokes the installed shared hook, the hook blocks
the commit with a diagnostic rather than validating another checkout.
For refused installations, the command fails with `HOOK_CONFLICT` and prints a shell-quoted validator invocation ending in `|| exit $?`. Add that line
to your existing hook or hook manager while preserving existing checks and
failure handling; shared-location instructions select the invoking Git root, not
a fixed checkout; manually remove only that line to undo the integration.
Nested projects also receive manual instructions. This avoids installing a
project-specific check into a hook that may serve other projects.

Repeat installation recognises the exact generated content and restores its
executable mode; repeat removal succeeds when absent. Removal deletes only the
unmodified hook for this checkout/project, leaving its directory. If Git hook
configuration changes, removal addresses the currently configured location;
restore the former setting to remove the former hook, or remove it manually.

### Selecting a project

Every CLI command selects exactly one project. With no selector, it uses the
current working directory, without searching ancestors. Explicit paths bypass
project-name mappings. Search still reads global configuration for the
machine-level `slow_query_ms`; other operations do not need it when a path or
the current directory selects the project. All relative paths resolve from the
caller's working directory.

```bash
tasks list --format json
tasks list --project-path /work/my-project --format json
tasks get /work/my-project 42 --fields id,title,status
tasks list --project my-project --status pending --sort priority
```

`--project-path <directory>` and the optional positional project path mean the
same thing. As with standalone scripts, `get` and `deps` require an ID: one
positional is an ID, two are path then ID. `--project <name>` always means a
configured name; it never guesses whether a bare name is a local directory.
Names can contain hyphens. Paths such as `./my-project` belong in
`--project-path` or the positional path. Selectors are mutually exclusive;
repeated selectors fail rather than selecting one silently. This is the CLI's
only project-selection extension: standalone scripts retain path-only selection
and use the global configuration only for search timing.

For global program configuration, `--config <file>` takes precedence over
`TASK_TRACKER_CONFIG`, then `$XDG_CONFIG_HOME/task-tracker/config.json`, falling
back to `~/.config/task-tracker/config.json` if `XDG_CONFIG_HOME` is unset or
empty. The file is read when a command needs search timing or named-project
resolution; it is not created during installation or first use. If it is absent,
search uses the built-in 150 ms threshold and named projects are unavailable.
An explicit config replaces, rather than merges with, lower-precedence config.
Relative explicit config paths resolve from the caller's directory. No config
is created by installing or reading tasks.

These are all currently supported global parameters:

| Parameter | Accepted value | Purpose and default |
| --- | --- | --- |
| `slow_query_ms` | Non-negative safe integer | Machine-wide slow-scan threshold in milliseconds; default `150`. |
| `projects_root` | Absolute directory path | Optional directory whose immediate children can be selected by name. |
| `projects` | Object mapping simple names to absolute directory paths | Optional explicit named-project locations. |

Example containing every parameter:

```json
{
  "slow_query_ms": 150,
  "projects_root": "/work/projects",
  "projects": {
    "external-library": "/other/library"
  }
}
```

Task-schema selection is independent of project-name selection. By default an
operation uses `tasks/task-schema.json`, falling back to an existing legacy
`docs/task-schema.json`. If both exist, select one explicitly; the tracker never
guesses or migrates either file. `--schema-path <project-relative-file>`
overrides automatic selection for every CLI and standalone task operation.
The file must remain inside the selected project and must exist. Schema files
and their project-relative path components cannot be symbolic links. A selected
schema inside `tasks/` is reserved from task-store discovery. `--config`
selects the global program configuration, including project-name mappings and
the machine-level `slow_query_ms`; it never selects a project schema.

`projects_root` and every mapped location must be absolute directory paths.
Either setting may be omitted. Names resolve only immediate children of
`projects_root` and explicit `projects` mappings. If both identify different
real directories, `AMBIGUOUS_PROJECT` asks for an explicit path. Two symlinks
to the same real directory are the same selection. Names do not traverse nested
directories or choose among Git worktrees; select the exact worktree path or
configure a distinct name for it. A missing project/name fails without scanning
neighbours, aggregating projects, initialising stores or selecting/starting work.

### Results and errors

CLI defaults, fields, exact filters, priority ordering, pagination, counts and
history selection match the script examples below. `tasks list` shows a compact
`id,title,status` table. Use `tasks list --full` for all fields as untruncated text;
`--full --format text|table|json` explicitly selects a format (table cells still
respect `--max-width`). `--full` cannot be combined with `--fields` or `--format ids`.
`search` returns projected task fields with `matched_fields` and bounded snippets.
It supports text/table/json/ids output and an opaque cursor instead of an offset.
`get-many` returns requested tasks in ID-input order, reports absent IDs separately
and uses an opaque cursor instead of an offset.
`deps` uses bounded `--depth`
and `--limit`; there is no unbounded `--transitive` option. `list` and `get`
support text/table/json/ids; `deps` and `validate` support text/json because their
results are graph diagnostics and a validation summary, rather than task rows.
List human output prints a ready-to-copy `tasks list` continuation to stderr,
retaining the original project selector and query arguments, with shell quoting
and a replaced offset. An implicit current-directory selection stays implicit:
`tasks list` prints `Next page: tasks list --offset 10` when another default page
is available. Run continuations in the same shell environment and directory.
Help and Usage errors use public `tasks <command>` names.
JSON carries page metadata in stdout. Reads
preserve task bytes. Validation may refresh service metadata; its existing
interrupted-write recovery rules still apply.

Every task-data read command accepts `--no-cache`. It overrides `search.mode`
and reads authoritative JSON without opening or refreshing the disposable
SQLite cache. The equivalent core option is `noCache`, MCP uses `no_cache`, and
HTTP uses `no-cache=true`.

Exit **0** means success (including help and `deps` reporting blockers or cycles).
Exit **1** means failure: stdout is empty and stderr begins with `CODE: message`.
This retains the standalone script exit convention so JSON stdout stays usable.
Use the error code, rather than parsing message wording:

| Code | Meaning / action |
| --- | --- |
| `PROJECT_NOT_FOUND` | Missing directory or unknown configured name; select an existing project. |
| `AMBIGUOUS_PROJECT` | Name resolves to different directories; use an explicit path. |
| `TASK_NOT_FOUND` | ID absent from selected stores; request history explicitly if needed. |
| `INVALID_INPUT` | Bad command, option, ID or conflicting selection; consult command help. |
| `INVALID_CURSOR` | Search or batch cursor is malformed or belongs to different inputs/selectors; start a new request. |
| `INVALID_CONFIG` | Malformed registry/schema settings; correct the named setting. |
| `READ_ERROR` / `INVALID_JSON` | Unreadable/missing store or malformed JSON; inspect the named file. |
| `INVALID_STORE` | Invalid records, duplicate IDs or validation cycle; correct the reported data. |
| `INPUT_TOO_LARGE` / `OUTPUT_TOO_LARGE` | Shared input/output budget exceeded; reduce selected data/fields. |
| `INVALID_SERVICE` / `RECOVERY_REQUIRED` / `RECOVERY_CONFLICT` | Service/recovery state needs attention; follow the recovery procedure below. |
| `PROJECT_CHANGED` / `WRITE_ERROR` / `WRITE_INCOMPLETE` | Validation could not safely finish its metadata/recovery work; inspect the diagnostic and retry after resolving it. |
| `ACTIVE_BLOCKERS` | A working-state write has Active blockers; finish/archive blockers or explicitly remove relationships first. |
| `TRANSITION_CONFLICT` | The last-read timestamp is stale; reread the complete task, reconcile and retry. |
| `PROJECT_BUSY` | Another writer holds the project lock; retry after it finishes. |
| `HOOK_CONFLICT` / `HOOK_UNAVAILABLE` | Hook needs manual integration or Git could not resolve the repository/hooks; follow the diagnostic. |
| `COMMAND_EXISTS` | Installer found an unrelated command; resolve its collision explicitly. |

`deps` returns `eligible: false` for active blockers and reports cycles through
`graph.cycleStatus`, with truncation explicitly disclosed. These are successful
inspection results, not start attempts. Validation rejects cycles with
`INVALID_STORE`. Mutations share the standalone operations and their errors, including blocked
starts and write conflicts. They return full JSON records, including no-ops;
`--format json` is their only output format. Unlike compact reads, mutation
responses cannot project or truncate the persisted result.

## Batch task retrieval

Use `get-many` when several task IDs are already known:

```bash
tasks get-many --id 12 --id 4 --id 99 --fields id,title,status --format json
tasks get-many --id 12 --id 4 --store all --limit 10
```

Repeat `--id` in the required result order. IDs must be positive safe integers
and duplicates fail. Active is selected by default; `--group` and repeatable
`--store` use the same mutually exclusive selection as list/get. JSON pages
contain `tasks`, `not_found`, `hasMore`, `next_cursor`, `stores` and `fields`.
The limit from 1 through 50 counts requested IDs, including missing IDs. Human
formats report missing IDs and print a ready-to-copy continuation to stderr.

The cursor is valid only with the same ordered IDs, fields, group and stores.
Pages reread current source state and do not form a snapshot. The shared 32 KiB
response budget may shorten a page; select fewer fields if one projected task
cannot fit. `search.mode` also selects the batch backend: `scan` reads JSON,
`auto` and `indexed` use a current index or return scan results while requesting
a refresh. Indexed retrieval uses the SQLite ID lookup
and the same freshness checks as content search, so JSON remains authoritative.

Core callers use
`getTasks(projectPath, ids, {fields, stores, group, limit, cursor, schemaPath, noCache, onAdvisory})`
from `src/tasks.mjs`. The standalone entry is `scripts/get-tasks.mjs`; MCP uses
`get_tasks`. HTTP exposes [`GET /tasks/batch`](HTTP.md#requests-and-results)
with comma-separated `ids` for the startup-selected project.

## Content search

Use scan search when you remember task wording but not its ID:

```bash
tasks search "release notes"
tasks search "release notes" --search-fields title,scope --fields id,title --format json
tasks search "release notes" --limit 10
```

Search is a case-insensitive literal substring match, not a regular expression.
The selected fields use OR semantics and default to `title`, `scope`,
`acceptance`, `dependencies`, `sources` and `notes`; absent fields are ignored.
Arrays and nested objects contribute their scalar values, but object key names do
not match. Results default to `id,title,status` and add `matched_fields` plus one
bounded snippet for each matched top-level field.

`--group` and repeatable `--store` use the same mutually exclusive selection as
`list`. `--limit` accepts 1 through 50. When another page exists, JSON returns
`next_cursor`; human output prints a ready-to-copy continuation. A cursor is
valid only with the same query, search fields, result fields, group and stores.
Pages do not form a snapshot across concurrent edits. Scan searches reread the
selected JSON files; indexed searches verify source fingerprints and read the
derived cache. Search uses the shared 128 MiB project-input and 32 KiB response limits;
select fewer result or search fields if one result cannot fit.

Project configuration may set `search.mode` to `scan`, `auto` or `indexed`; the
default is `scan`. The installed program's global configuration owns
`slow_query_ms`, shared by every project on the machine, with a calibrated
default of 150 ms. `auto` uses a current SQLite FTS5 trigram index. When the
index is missing or stale, it returns correct scan results immediately and
schedules one background refresh for the project. `indexed` prefers a current
index and otherwise returns the authoritative scan with a non-fatal
`CACHE_FALLBACK` advisory while requesting a refresh.

The project-scoped index is disposable derived data under
`$XDG_CACHE_HOME/task-tracker/search` (default `~/.cache/task-tracker/search`),
outside the project and Git. JSON stores remain authoritative. Store and schema
fingerprints make the index stale after changes; refresh uses a recoverable
lock and atomically publishes a completed generation, so a failed build does
not replace the prior database. Deleting the cache is safe. A scan over the
threshold adds a bounded `SLOW_SCAN` advisory with its elapsed time and refresh
guidance; human output prints the same advisory to stderr. Advisory bytes count
toward the 32 KiB response limit.

The same current SQLite generation also serves task detail, list/count (with
filters and sorting), and local blocker reads through core, CLI, MCP and HTTP.
Those reads verify the complete source generation first. If the cache is
missing, stale, corrupt or incompatible, they return authoritative JSON results
immediately and schedule one background refresh; commands detach the work so it
does not delay command completion. A write or manual JSON edit therefore appears
on the next read even before refresh completes. `search.mode` still controls
content-search and batch retrieval only; the replica acceleration is transparent.

SQLite acceleration is optional and uses only the supported Node.js runtime's
built-in `node:sqlite`; no external SQLite package is needed. If cache support
cannot be initialised, reads return authoritative JSON and print a bounded
`CACHE_UNAVAILABLE` advisory instead of failing. Core callers can receive the
same advisory with `onAdvisory`. New task-data read operations must keep a tested
JSON-only `noCache` path and may never require a current cache for correctness.

The 150 ms default was calibrated with two 12-run samples over 8,192 tasks in
64 stores (4.91 MB of JSON) on an 8-logical-core Intel i7-8565U. Idle maxima
were 71–80 ms; with four concurrent CPU workers they were 123–126 ms. The
default adds about 20% headroom over the loaded maximum. Machines with materially
different storage or CPU performance can set one global `slow_query_ms` value
without editing individual projects.

Core callers use
`searchTasks(projectPath, query, {searchFields, fields, stores, group, limit, cursor, schemaPath, slowQueryMs, noCache, onAdvisory})`
from `src/search.mjs`. HTTP exposes
[`GET /tasks/search`](HTTP.md#requests-and-results) with `query` and optional
`search-fields`, preserving shared pages, advisories and cache diagnostics.

## CLI task maintenance

All mutations use the same project selectors and current-directory default as
reads. They locate retained tasks by ID across configured stores; `get` still
needs `--store all` or an explicit history group for a historical record.
Mutation `--store` selects one destination, while read `--store` selects source
stores and is repeatable. Mutations never stage, commit, change instructions or
edit installed skills. Run them only within your role's task-edit authority.

```bash
tasks create --title 'Implement export' --priority high --input - <<'JSON'
{"acceptance":["Export is verified"],"scope":"Provide CSV output"}
JSON
tasks get 42 --format json
tasks update 42 --title 'Implement CSV export' --input - <<'JSON'
{"set":{"scope":"Replace the complete scope text"},"add":{"tags":["export"]}}
JSON
tasks transition 42 --status in_progress
tasks update 42 --json '{"set":{"completed_at":"2026-09-20T12:00:00Z"}}'
tasks transition 42 --status done
tasks get 42 --group Done --format json
tasks transition 42 --status cancelled
tasks update 42 --status pending
tasks validate
git diff -- tasks
```

Use the ID returned by `create` in place of 42. Supply project-required fields
before moving to a destination that requires them; completion does not invent
`completed_at` or evidence. Human operators can inspect the returned JSON and Git
diff. Agents should first inspect bounded lists and specific details, send only
authorised changes, then inspect the complete result. Git staging and committing
remain separate operator actions.

Use `transition <id> --status <configured-status>` for status-only changes or
`update <id> --status <configured-status>` to include field changes in the same
operation. Both paths enforce the same local blocker and final-record checks.
The examples use the default statuses; substitute the project's configured
statuses when different. Moving to an Archive status retains the ID and record;
moving back to an Active status restores it. No command permanently deletes.

`create` and `update` accept `--title`, `--status`, `--priority` and `--blockers`.
The first three are literal strings; blockers are comma-separated positive safe
integer IDs (`--blockers '7,12'`). `--blockers ''` replaces the array with an empty
one. JSON accepts the same numeric IDs. Other structures and extension fields
use one `--json '<object>'` or `--input <file|->`; `-` reads stdin. Relative input
files resolve from the caller's directory. Sources are exclusive and cannot be
repeated. No source is required when standard field flags are supplied.

Creation JSON is the task object; update JSON is the patch envelope described in
[partial updates](#partial-updates). Standard update flags become `set` fields.
Flags may accompany JSON only for disjoint fields: `--title` plus JSON `scope`
is valid, but a title in both is an error, even if the values match. On updates,
a field in any `set`, `add`, `remove` or `unset` operation conflicts with a flag
for that field. Repeated scalar mutation options are errors to prevent silently
choosing which supplied value to persist. Existing read commands retain their
last-value-wins parsing for repeated scalar command options; project selectors
and `--config` reject repetition across all CLI commands. There is no implicit
merge or precedence rule that can discard supplied mutation content.

Text, objects and arrays supplied through `set` replace the whole value.
`add` appends structurally distinct array elements, `remove` deletes selected
array elements (all equal occurrences), and `unset` removes optional fields.
Operations address literal top-level names. Required fields, `id` and tracker-owned
`updated_at` cannot be removed; ID/timestamp patches fail. Duplicate-only additions
and absent removals silently return the full unchanged task and timestamp.

Use `--if-updated-at <last-read-timestamp>` on updates and lifecycle commands when
replacing content derived from a read. A stale timestamp fails, even for a no-op;
reread/reconcile before retrying. Cooperating writers share locking, unique ID
allocation and latest-record patches. External edits trigger shared validation
when the stored fingerprints differ. Active blockers prevent working-state
writes through creation, generic status updates and dedicated transitions.
See [creation](#creating-tasks) and [lifecycle](#changing-statuses-archiving-and-restoring)
for resource limits, recovery and arbitrary manual-writer race limitations.

## Commands

```bash
tasks list --format table
tasks list --offset 10 --format json
tasks list --status pending --sort priority --format table
tasks list --where status=pending --count
tasks list --group Done --fields id,title,status --format json
tasks list --store all --limit 10 --format ids
tasks search "release notes" --fields id,title --format json
tasks get 1 --store all --fields id,title,scope,acceptance --format json
tasks get-many --id 1 --id 4 --fields id,title,status --format json
tasks deps 2
tasks deps 2 --depth 3 --limit 20 --format json
tasks list --help
tasks search --help
tasks get --help
tasks get-many --help
tasks deps --help
tasks create --help
tasks update --help
tasks transition --help
```

These installed commands use the caller's current directory by default. Get,
blocker inspection and lifecycle commands require an ID. Select another project
only when needed with `--project-path` or `--project`; directory names are never
guessed from IDs. Source-checkout standalone scripts retain their documented
positional path form for development and compatibility use.

Project operations prepare missing `tasks/.task-tracker.json`, creating `tasks/`
if needed. Missing selected task files are `READ_ERROR`; reads create no task
stores. Commands do not search parent, child or neighbouring directories. They do not follow fields such as `reference` or
`parent` to select a project.

Lists default to the `Active` group, at most 10 records, fields `id,title,status`,
table output and ascending numeric ID. `--full` selects all fields and defaults
to text output without cell truncation; explicit `--format text`, `table` or
`json` is honoured. It conflicts with `--fields` and `--format ids`. For example,
`tasks list --full` displays complete records, subject to the
same page and output limits. Filtering and sorting happen before pagination.
`--limit` accepts 1 through 50; zero and larger values fail. `--count` returns
the total match count independently of pagination. For `text`, `table` and `ids`,
page information and a ready-to-copy next-page command go to stderr, keeping
stdout usable in pipes. JSON carries pagination in its page object.
Standalone script continuation commands use `node` from `PATH` and a script path relative to the
current working directory, so they remain short and can be run from that same
directory. Query arguments and shell quoting are preserved.
Follow the supplied continuation: the response size limit can make a page
shorter than the requested number of records.

Every response is limited to 32 KiB of UTF-8 output, including JSON list
metadata or the combined human output and page guidance. Lists stop between
complete records. If a single projected task or
detail result cannot fit, the command fails and suggests selecting fewer fields.
Blocker inspection keeps its direct active IDs exact and shortens only graph
details; an exact blocker result that cannot fit fails instead.
The limit also applies to `--fields all` and every output format. Each operation
can read at most 128 MiB (134,217,728 bytes) of authoritative project JSON
across configuration and the applicable selected or retained stores; oversized
projects fail before the source is parsed. Validation, index construction and
writes decode store arrays one record at a time. Caller input and service
metadata have a separate 8 MiB limit. These fixed limits have no command-line
override. See the [read limits contract](../docs/contract.md#read-limits-and-pagination).

The 128 MiB source guard admits the tested 2,000,000-record minimal project
(113.8 MB JSON) and 250,000-record representative project (126.7 MB JSON).
This is a byte limit, not a record-count guarantee. SQLite cache files are
derived data outside the project and do not count towards JSON source bytes.
Provide spare disk space for the current cache and a complete replacement
generation during refresh. The previous published generation is retained for
readers already using it; older generated databases are pruned after publication.
A cache miss or stale generation reads current JSON immediately and requests
a refresh unless `--no-cache` was selected; it never serves stale SQLite
results as current. JSON scans and writes remain linear in project size and can take
several seconds at these fixtures. If refresh fails, authoritative JSON stays
available and the prior complete generation remains intact for recovery.

### Measured capacity guidance

These results used Node.js 24.21.0/Linux x64 on an Intel i7-8565U, with an
8 GiB RAM/no-swap process scope. MB figures below are decimal. The routine
current-cache ceiling is 2 s (target 0.3 s); one-off complex indexed search
has a 5 s ceiling. Cached reads use separate fresh processes and report
the median and p90 of three runs. Cold builds, validation and writes are
single observations.
Actual times depend on hardware, record shape and filesystem cache state.

| Operation | 2,000,000 minimal records, one store | 250,000 representative records, four stores |
| --- | --- | --- |
| Current-cache detail / list / count | 9 / 900 / 396 ms median; 9 / 1,007 / 416 ms p90 | 8 / 192 / 66 ms median; 9 / 198 / 76 ms p90 |
| Current-cache filter / title sort / priority sort | 1,003 / 1,004 / 966 ms median; 1,008 / 1,041 / 977 ms p90 | 180 / 202 / 199 ms median; 206 / 203 / 206 ms p90 |
| Current-cache blockers / batch / simple / complex search | 7 / 579 / 361 / 236 ms median; 8 / 614 / 432 / 296 ms p90 | 7 / 8 / 48 / 50 ms median; 8 / 8 / 52 / 55 ms p90 |
| Full validation / cold cache build | 10.0 / 87.7 s | 3.1 / 37.2 s |
| JSON creation / update / lifecycle move | 8.3 / 12.9 / 13.1 s | 3.1 / 4.1 / 4.0 s |

At the 2,000,000-record fixture, peak RSS was 1.06 GB for validation,
0.85 GB for creation and 0.73 GB for cache construction; routine current-cache reads
stayed at or below 69 MB. The new cache was 1.04 GB; two complete generations
need about 2.1 GB of cache-directory space during a stale refresh.
The 250,000-record cache was 583.2 MB; its highest observed
validation/write RSS was 427 MB. A stale four-store refresh completed in
about 33 s, with about 1.17 GB retained for current and previous generations.
Plan for at least 2 GiB free memory and
4 GiB free temporary/cache disk for this tested envelope.

`--no-cache` and cache-miss/stale fallback use current JSON and can exceed
interactive latency targets. At 2,000,000 minimal records, three fresh-run
medians/p90 were 4.36/4.97 s for detail, 5.35/5.88 s for list and
5.35/5.37 s for an all-match content search, with peak RSS at or below
749 MB. At 250,000 representative records, the corresponding medians were
2.00, 2.12 and 2.11 s, with peak RSS at or below 304 MB. The 128 MiB
source guard and 32 KiB response cap bound these fallbacks; enable or await
a current cache for routine low-latency reads.
Deep JSON list pages can require two source passes so a high offset does not
retain the entire match set; offsets past the end return an empty page.
Title and priority sorts use indexed cache keys. Other sort fields are
sorted inside SQLite before returning a bounded page. A selected field mixing
numeric and non-numeric values uses authoritative JSON in both cache modes.
Broad custom sorts and filters may exceed the 2 s routine target even with
a current cache: a 2,000,000-record `updated_at` sort took 7.16 s and
595 MB peak RSS in one measured run. The same source and response limits apply.
The 150 ms `SLOW_SCAN` advisory threshold concerns search scans only.

`--status` and `--where status=...` compare exact, case-sensitive strings.
Other `--where` string/object values use case-insensitive substring matching;
numbers and booleans compare exactly, and arrays match any member. Repeated
`--where` filters combine with AND. Repeated `--id` values combine with OR.

`--sort priority` orders high, medium, low; missing or unrecognised priorities
sort with medium without adding or changing fields. Other sorts compare
numbers numerically and strings in locale-independent UTF-16 order. Missing/null values sort
last in ascending order. `--desc` reverses the primary order. Ties always use
ascending ID, independently of file/record order. Custom priority scales and
their configuration remain future work.
The relative order of mixed numeric and non-numeric values in one custom sort
field is unspecified; those queries use authoritative JSON consistently with
or without a current cache.

`--fields all` returns all record fields; otherwise missing fields are omitted
from JSON and shown as `(unset)` in human output. Unknown field names are
reported when records are available to check them. `priority`, `blockers`
and `updated_at` remain selectable when absent from minimum records. Extension fields, including
a field named `store`, remain ordinary task data.

Get returns one complete task by default; `--fields` narrows it. It defaults to
`Active` and fails when the ID is missing from the selected group/stores.
History must be explicit: use `--group Done`, `--group Archive`, `--store done`,
or `--store all`. A JSON get result is the projected task object. A JSON list
result is a page object containing `tasks`, `total`, `hasMore` and `nextOffset`,
plus page metadata. Read records from `.tasks`; the earlier bare-array output
is no longer supported. The last page has `hasMore: false` and `nextOffset: null`.
List/get scripts support `text`, `table`, `json` and `ids` output. Tables default to
60-character cells (`--max-width`); `ids` always projects IDs.

See the [read configuration contract](../docs/contract.md#implemented-read-configuration)
for store discovery, custom groups, the reserved service filename and validation
boundaries. Selected files are reread on each operation. No read operation
writes task files, configuration or service state, or runs Git commands.

## Partial updates

```bash
tasks update 1 --json '{"set":{"title":"Revised title"},"add":{"tags":["ready"]}}'
tasks update 1 --input patch.json --if-updated-at 2026-09-19T12:00:00.000Z
tasks update 1 --json '{"set":{"status":"done"},"remove":{"blockers":[2]},"unset":["optional"]}'
```

Supply standard field flags and/or one `--json` object or `--input <file|->`
(stdin), following the [mixed-input rules](#cli-task-maintenance). Output is the
complete persisted task in JSON. The reusable API is
`updateTask(projectPath, id, patch, {store, ifUpdatedAt})` from `src/update.mjs`.
`set` replaces complete scalar/object/array values; objects do not merge.
`add` appends unique array elements; `remove` removes all matching elements;
`unset` lists optional field names to remove. Each field occurs once across the
patch. Object equality ignores key order; array order and scalar types matter.
Duplicates and missing removal targets are silent no-ops. Absent arrays can be
created by `add`; existing non-arrays reject array operations. `id` and
`updated_at` cannot be patched. Unrequested data and untouched source bytes stay
intact; actual changes advance `updated_at`, while no-ops preserve it.

Status patches share lifecycle destinations, blockers, validation and recovery.
Without a status patch, the current store is retained unless `--store` selects
another compatible destination. Combined patches validate the final record and
graph before writing. `--if-updated-at` checks the exact stored timestamp even
for no-ops; stale values raise `TRANSITION_CONFLICT`, requiring reread/retry.
Writers share the project lock, preventing lost concurrent array additions;
use the precondition when replacing content prepared from an earlier read.
See the [partial update contract](../docs/contract.md#partial-updates).

## Local blockers

`tasks deps <id>` inspects one task in `Active` and
supports `text` (default) or `json`. It reads the complete Active ID set through
the same configured store/group mapping as list/get, including multiple and
mixed-status stores. It never selects separate Done/Archive stores, opens
service state, resolves absent IDs or follows project/external references.
An ID outside Active produces `TASK_NOT_FOUND`; inspect its history with an
explicit get command instead. A failed Active read is an error.

The result's `activeBlockers` is the sorted, unique intersection of the task's
stored blocker IDs and Active IDs. `eligible` is true exactly when that array
is empty; it describes local blocker readiness only, regardless of the task's
current status. It neither selects nor starts work. Omitted `blockers` means
no blockers. Examined blocker fields must be arrays of positive safe integer
local IDs; malformed fields fail with `INVALID_STORE`. Repeated IDs are reported
once without changing their stored representation. Other fields are passive.

Optional traversal uses `--depth` (1–20 hops, default 1) and `--limit` (1–50
returned edges, default 10). The root has depth zero. Graph edges use `{from,to}`
IDs and breadth-first order with ascending blocker IDs; a task is expanded once
at its shortest distance from the root. Only reachable Active links participate.
The result includes `graph.depth`, `graph.limit`, `graph.edges`, `graph.cycle`,
`graph.cycleStatus` and `graph.truncated`:

- `cycleStatus: "found"` supplies the first cycle found in the returned edges
  as a closed ID path, such as `[1,2,1]` or `[1,1]` for a self-link.
- `cycleStatus: "none"` means the complete reachable graph was checked and
  contains no cycle. This is not a project-wide validation verdict.
- `cycleStatus: "unknown"` means no cycle was found in an incomplete graph.
  Increase the reported depth/edge limits where possible before drawing a
  conclusion. A found cycle can coexist with truncation of other links.
- `truncated.depth`, `truncated.limit` and `truncated.response` identify cuts
  caused by the hop bound, edge bound or 32 KiB response budget. A byte limit
  removes complete edges from the end and recomputes the cycle diagnostic.

Graph limits never change `activeBlockers` or `eligible`. A blocker or cycle is
a successful inspection result, not an operation error. Human output shows
`cycle: 1 -> 2 -> 1`, or states that the cycle check is incomplete.

To choose work, use a bounded list, inspect a candidate's blockers, and get that
task's details. To observe release, inspect a dependent, move its
blocker out of Active with the transition or delete script, then inspect the dependent again.
The next call uses current Active membership; the dependent record and all its
stored blocker IDs stay unchanged. Missing or malformed separate history files
do not affect this check. Reintroducing an Active node can expose a cycle.

## Creating tasks

```bash
tasks create --json '{"title":"Пробная задача"}'
printf '{"title":"Add search","scope":"Search task titles"}\n' | tasks create --input - --format json
tasks create --input new-task.json
tasks get 100 --format json
```

Without a project argument, creation uses the current working directory and
does not prompt. Supply a project path to select another directory. Replace
the example project path and retrieve the ID returned by creation.

Supply standard field flags and/or one JSON source: `--json` takes a quoted
JSON object string; `--input` reads a UTF-8 JSON object from a file or stdin
(`-`). The [mixed-input rules](#cli-task-maintenance) apply to scripts too.
Empty invocations, combined or repeated JSON sources are errors, and malformed
JSON fails without writes.
Inline input uses the same 8 MiB input budget as file/stdin input. Shared readers
reject malformed UTF-8 in input, task, configuration or service files before
persistence; existing bytes are not silently replaced. Creation returns
the complete task as JSON, which is the default and only output format. The
reusable operation is `createTask(projectPath, input, { store, schemaPath })` from
`app/src/create.mjs`; `store` is optional. It returns the same complete task and
does not print, exit or run Git. A successful return means both the task and its
service metadata were saved.

Omitted `id` is allocated above the known project-wide counter. `title` is
required; omitted `status` defaults to `pending`. Standard creation adds
`priority: "medium"` and `blockers: []` when omitted. Supplied fields override
defaults and are validated. Creation sets tracker-owned `updated_at` to the
current UTC millisecond timestamp. Supplied `updated_at` is rejected with
`INVALID_INPUT`; omit it from creation input. Minimal creation therefore returns
`id`, `title`, `status` and `updated_at`, without priority or blockers. Existing records
remain unchanged, including records that contain only `id`, `title`, `status`.
Unknown input fields are retained as JSON data and external links stay passive.

These optional settings live at the top level of the selected task schema
(`tasks/task-schema.json` by default):

- `format`: `"standard"` (default) or `"minimal"`. Minimal creation adds neither
  priority nor blockers, but accepts them when supplied.
- `default_status`: a declared status; absent means `"pending"`. A custom project
  without pending must supply a status or configure this default.
- `working_statuses`: an array of declared Active statuses; absent means
  `in_progress` and `review` are working statuses. An explicit array replaces
  that default, including an empty array.
- `fields`: project-owned field rules for typed, required or conditionally
  required extension fields.

For example, a minimum-format project with custom working semantics can use:

```json
{
  "stores": { "active.json": { "statuses": ["todo", "doing"] } },
  "groups": { "Active": ["todo", "doing"] },
  "format": "minimal",
  "default_status": "todo",
  "working_statuses": ["doing"]
}
```

Existing global/per-store `required_fields`, `fields` and
`plan.required_for_statuses` apply to new tasks. The status selects its
configured store; when several stores allow it, choose one with `--store queue`
or `--store queue.json`. Unknown or unconfigured destinations are errors that
list the configured status or store choices. Creation lazily creates its missing
standard destination file; configured custom filenames must already exist. New
records always meet ordinary creation rules, even in a store whose retained
records have `validate: false`.

Under the shared write lock, creation rereads the current source state, rejects
working statuses with Active blockers, rejects self-links, and checks the
resulting Active graph for cycles. Only non-exempt retained Active records
participate in cycle validation. All current Active IDs, including ones in
exempt stores, block a new working task. Done, Archive and absent blocker IDs
stay in the record and do not prevent starting.

Explicit IDs must be unused across every retained file, including exempt and
unconfigured stores. IDs at or below the counter trigger a full shared scan to
check uniqueness; unused lower IDs are permitted without lowering the counter.
An explicit higher ID advances the counter. If the counter reaches the largest
safe integer, automatic creation fails; an unused explicit safe-integer ID can
still be supplied.

Missing service state, a missing/mismatched certified counter, changed source
hashes or a changed file set triggers full shared validation before allocation.
Invalid existing data or an invalid new task leaves task and service bytes
unchanged. Matching state allows automatic or explicit higher-ID allocation to
skip parsing separate history. Each create still hashes all configuration/store
bytes before and just before writing, and parses the destination and stores
that contain Active statuses. Mixed Active/history files are necessarily parsed
together. This saves historical JSON parsing and record validation, not file
I/O. Each project-source pass has a 128 MiB aggregate budget; service state and
caller input each have a separate 8 MiB budget. A resulting project or service
file beyond its applicable budget is rejected before persistence.

The complete returned task must fit the 32 KiB response budget. This check runs
before persistence; shorten oversized input and retry. Appending preserves the
existing task-array source, including unrelated formatting and numeric literals,
and uses two-space formatting for the new record. Other store files are not
rewritten. The counter and affected fingerprint are refreshed without a full
historical parse after a normal create.

Creation waits up to five seconds for the shared OS-managed project lock, then
reports `PROJECT_BUSY`. Validation uses the same lock but fails immediately
when busy. A task file is atomically replaced before service state is replaced.
If only the task replacement succeeds, `WRITE_INCOMPLETE` reports the saved ID;
inspect it with get and run validation before creating again. The task is
retained, and its changed fingerprint makes the next writer recalculate safely.
Do not blindly repeat a creation whose result was interrupted or lost: it may
already have saved a task. Inspect the destination first.

After a crashed owner has stopped, its lock is released automatically. Remove any leftover
`*.json.<uuid>.tmp` files, inspect the task, then validate or retry with a new
request. Recovery never removes an existing task. The task-first order prevents
reusing a retained ID even if service refresh was interrupted. This coordinates
local tracker writers; arbitrary editors can still race the final check/rename,
and no filesystem power-loss durability is promised. Lifecycle moves use the
recoverable journal described below; interrupted creation retains its existing
task-first recovery behaviour.

## Changing statuses, archiving and restoring

```bash
tasks transition 42 --status done
tasks transition 43 --status cancelled
tasks transition 42 --status pending
tasks transition 43 --status pending
tasks get 42 --store all --format json
```

Use IDs returned by creation. All commands accept an omitted project path for
current-directory selection. They require the ID and return the complete task as JSON (`--format json` is optional and
the only format). Transition additionally requires `--status`; any configured
status is permitted, including direct pending-to-done and restoration from
history. There is no mandatory review stage. `--store` chooses a destination
when several stores allow the requested status, matching creation semantics.
Unknown `--status` values produce `INVALID_INPUT` with the supplied value and
the project's configured statuses. Status names are case-sensitive. These
choices come from configured stores; absent optional history stores do not add
default statuses. An ambiguous status lists destination stores for `--store`;
an incompatible explicit store lists valid destinations instead. Creation and
deletion share these destination rules. Delete separately identifies missing
Archive configuration or lists Archive status choices when `--status` is needed.

The source record is found by ID. Active stores and the destination are read
first, then other configured stores until the ID is found. Records in
unconfigured stores cannot be transitioned; configure their source store first.

Delete retains the record in Archive. If the configuration declares one Archive
status, it is selected automatically. Otherwise supply `--status cancelled`
(or another configured Archive status). Delete cannot target Active or Done.
There is no permanent deletion. Missing standard destination files are created
when needed, including by combined field/status updates. Custom filenames must
already exist and have declared store/status/group mappings.

IDs, blocker arrays, unknown fields and existing extension values are retained.
Status and tracker-owned `updated_at` change; no completion timestamp is
invented or removed. Required destination fields must already be present. A missing required
field fails before writes; prepare it through the project's manual-edit workflow.
Movement preserves source text apart from status and `updated_at`, including
numeric literals and escaped strings. Unrelated records remain byte-identical;
only separators around the moved record, its destination append and necessary
service metadata change. The returned JSON uses JavaScript number semantics,
as other reads do; preserved source literals are not rounded by movement.

An actual status or store change sets `updated_at` to a canonical ISO UTC
millisecond timestamp, for example `2026-09-19T12:00:00.000Z`. The date strictly
increases over the previous valid value even if the clock repeats or moves
backwards. The first actual change to a legacy record adds the date. A true
no-op (same status and store) preserves the record, date and service bytes, but
still checks supplied preconditions, fields and blockers. Same-status movement
to another store is an actual change. Extended ISO years are supported, matching
`Date.toISOString()`. A record at the maximum representable date can be read or
left unchanged, but cannot advance (`TIMESTAMP_EXHAUSTED`).

To reject an edit based on an older read, supply the exact stored date:

```bash
tasks get 42 --store all --fields id,status,updated_at --format json
tasks transition 42 --status done --if-updated-at 2026-09-19T12:00:00.000Z
```

Replace the example date with the returned value. `--if-updated-at` is optional
and checked under the shared lock after recovery. A different or missing stored
date yields `TRANSITION_CONFLICT` without overwriting the task, including for a
no-op. Invalid expected dates yield `INVALID_INPUT`. Without the condition, the
operation uses current state. Legacy records with no date can receive their
first timestamp through an unconditional actual change. `--from` and API `from`
are no longer accepted; there is no source-status precondition or alias.

Manual JSON editing remains supported. When editing a timestamped record,
advance its `updated_at` to a canonical value strictly later than its prior
value, then validate the project. Otherwise a caller holding the old date
cannot detect that edit. Dates are exact optimistic preconditions, not a
content hash or tamper-proof revision. No records are bulk-stamped by reads or
validation. Present dates must be valid even in `validate: false` stores.

Entering a configured working status rechecks current Active blockers under the
shared lock and reports their IDs. All Active IDs, including those in exempt
stores, block starting. Reactivation checks cycles in the resulting Active graph
using the shared validation rules. Self-links are rejected in every destination,
matching creation. Completing or archiving a blocker immediately
releases its dependants through Active membership; it never rewrites their stored
blocker arrays. The retained counter never decreases or frees a moved ID.

The reusable operations are `transitionTask(projectPath, id, status, {
ifUpdatedAt, store, schemaPath })` and `deleteTask(projectPath, id, { ifUpdatedAt, status,
store, schemaPath })` from `src/transition.mjs`. All options are optional; delete's `status`
is needed when Archive has multiple choices. They return the complete task,
do not print or run Git, and share the five-second writer lock with creation.
Invalid source/destination data, stale requests, blockers, cycles and
output/source limits fail before publishing a move. The 32 KiB returned-record
and 128 MiB project / 8 MiB service budgets match creation.

With a matching service certificate, transitions parse Active stores and the
destination first. If those do not contain the ID, they search other configured
stores in configuration order, stopping when found. Consequently restoring
history may parse earlier historical stores; there is no persistent ID index.
Untouched stores are still hashed. Missing/stale certificates trigger full
shared validation, and an ID absent from configured stores triggers a full scan
to distinguish an unknown ID from an unsupported unconfigured source.

### Interrupted moves and recovery

A lifecycle move first stages each complete replacement beside the stores, then
atomically saves `tasks/.task-tracker.pending`, a bounded metadata journal with
the before/after fingerprints and staged filenames. It then renames the staged
destination, source (when different), and service state into place before
removing the journal. Individual replacements use atomic rename. An interruption
can leave physical intermediate files; the journal owns the recoverable logical move.
All public reads/inspections refuse a project with a pending journal using
`RECOVERY_REQUIRED`. Do not delete the journal to bypass that guard.

Run `tasks validate` from the project directory to finish a
pending move. Creation and subsequent lifecycle commands also recover under the
same lock before operating. After a crashed process has stopped, its lock is
released automatically; leftover UUID `.tmp` files may be removed.
Recovery checks the current file set and
fingerprints against the journal's before/after states, completes remaining
replacements and leaves exactly one retained record with matching service state.
It is idempotent even after interruption following the service replacement.
Recovery accepts the destination-first intermediate state where both record
copies are temporarily present, validates staged content and verifies that the
resulting project fits the ordinary 128 MiB project-source budget.

A filesystem failure after publication reports `WRITE_INCOMPLETE`; stdout stays
empty. Recover and inspect the ID before deciding on another request. Retrying
a request with its original `--if-updated-at` after recovery reports a timestamp
conflict if the move already completed. An unconditional repeat to the same
status/store is a no-op; always inspect the recovered task before retrying. If files or service state were edited outside the
pending move, `RECOVERY_CONFLICT` preserves the journal and current bytes;
reconcile the external edits with the saved before/after state before retrying.
Malformed journals fail rather than supplying arbitrary write paths.

These guarantees coordinate local tracker writers and recover process
interruptions. They do not promise atomic snapshots for reads spanning concurrent
completed moves, transactions with arbitrary editors, or power-loss durability.

## Validation and manual edits

```bash
tasks validate
tasks validate --format json
```

Validation scans every configured and discovered `tasks/*.json` store, including
history and validation-exempt stores. All retained records need an object with
a unique positive safe integer `id`. Present `updated_at` values must be
canonical UTC millisecond timestamps in all stores. Exempt stores skip other
record rules. Normal stores require non-empty `title`/`status`, configured statuses and groups,
optional standard priorities, and structurally valid local blocker arrays.
Only configured, non-exempt Active records participate in cycle checks.
Self-links and cycles between those records fail; inactive/absent blocker IDs
need no historical target. Unknown retained stores receive ordinary field/ID
checks but are not assumed to contain Active work. External links are passive.

The minimum retained record remains three fields, including in Done. New
creation includes `updated_at`; reads and validation never add it to legacy
records. Missing priority and blockers do not require edits. Optional PM
extension fields remain project data. Configure `required_fields` at the top
level or within a store for the original presence check: a value must exist and
be neither null, a blank string nor an empty array. Zero, false and objects are
allowed. Use `fields` for typed or conditional rules without changing that
compatibility contract. A field rule can set `required`, `required_for_statuses`,
`type`, `non_empty`, `items`, `non_empty_items` and `min_items`. Supported
`type` values are `string`, `array`, `number`, `integer`, `boolean`, `object`,
`date` and `timestamp`; array `items` accepts the same values except `array`.
Store `fields` add to top-level `fields`. A required array may be `[]` unless
`non_empty` or `min_items` says otherwise, so `blockers: []` remains valid.
`date` accepts a parseable date string; `timestamp` requires canonical UTC
millisecond form. Existing `plan.required_for_statuses` requires a non-empty
`techdesign` string and a non-empty `stages` array of non-empty strings for the
selected statuses.
For example:

```json
{
  "stores": {
    "active.json": { "statuses": ["pending", "in_progress"], "required_fields": ["acceptance"] },
    "done.json": { "statuses": ["done"] }
  },
  "fields": {
    "scope": { "type": "string", "required": true, "non_empty": true },
    "acceptance": { "type": "array", "required": true, "min_items": 1, "items": "string", "non_empty_items": true },
    "blockers": { "type": "array", "required": true, "items": "integer" },
    "completed_at": { "type": "date", "required_for_statuses": ["done"] }
  }
}
```

Project operations first create missing service metadata as an uncertified `{}`.
Successful validation refreshes `tasks/.task-tracker.json` with
`counter` (the highest observed or previously allocated ID, never lowered),
`validated.counter` (the counter covered by that validation), and
`validated.files` (SHA-256 fingerprints keyed by project-relative paths).
The configuration fingerprint is included, with null for an absent config.
Unknown service fields, including other `validated` fields, are preserved.
No task bytes, ignore rules, hooks or Git index are changed. A malformed service
file or invalid counter must be corrected before refresh; it is not reset.
A missing/mismatched `validated.counter` invalidates the fast allocation path;
revalidation preserves the highest valid counter from either location and the
retained IDs. Older certificates are refreshed automatically. Treat these
certificates as tracker-owned metadata, not authenticated evidence against
deliberate edits to both counters and fingerprints.

Try validation, manually add a higher-ID task, then validate again: the counter
rises and fingerprints change. Add or remove a retained file and revalidate to
refresh the file set. Introduce a duplicate ID or active cycle: validation exits
1 with a record/field diagnostic and preserves task files and any prior service
bytes. If metadata was absent, the newly prepared file remains uncertified. Correct the edit and retry. A subsequent unchanged validation exits
0 and reports `service state unchanged`; the original certificate is never
proof that later edits are valid.

`validateProject(projectPath, { schemaPath })` from `src/validation.mjs` returns
`{valid, tasks, stores, counter, refreshed}` without printing or exiting.
Validation always performs full checks; it does not skip them on matching
fingerprints. Detection costs linear file I/O and hashing, plus parsing and
record/graph checks, using a 128 MiB project-source budget per scan. A second pass hashes
configuration and store bytes again before publication, without reparsing
historical records. Service reading has its own 8 MiB budget. Store records are
decoded incrementally; memory also includes ID and Active-blocker maps. Creation uses the allocation
fast path described above; explicit validation always checks all records.

The shared OS-managed project lock prevents cooperating validators from
refreshing simultaneously; service replacement uses a temporary file and
atomic rename. A busy lock reports `PROJECT_BUSY`; a crashed owner releases
the lock automatically, including after `SIGKILL`.
A detected edit between scans reports `PROJECT_CHANGED`. Uncoordinated editors
can still race the final check/rename: certificates describe the recorded
fingerprints, and future writers must verify freshness and coordinate writes.
This does not promise a transaction with arbitrary editors or crash durability.
Validation errors reuse existing codes; `INVALID_SERVICE` identifies malformed
service structure and `WRITE_ERROR` reports service persistence failures.

### Project lock coordination and upgrades

Core, standalone scripts, CLI, MCP and HTTP service preparation use the same
synchronous lock in `src/project-lock.mjs`. On supported Linux and macOS hosts,
Node.js's built-in SQLite holds an exclusive transaction for the operation.
Closing the connection on completion or exception releases it; process death
releases the underlying OS lock. This adds no native package or installer step
and preserves the declared Node.js requirement.

POSIX coordination uses `/var/tmp/task-tracker-locks-<uid>/<key>.sqlite`. Windows
uses `<OS user profile>\AppData\Local\OutaskAI\locks\<key>.sqlite`, deriving the
profile from the OS user account rather than USERPROFILE or LOCALAPPDATA. The
key is the SHA-256 of the project's canonical real path (case-normalised on
Windows). Symlink/relative aliases
share a lock; different projects remain independent. On POSIX the directory is
private (0700), with database files created as 0600. Windows relies on the
current user profile's inherited filesystem ACLs rather than Unix permission bits. SQLite may create a 0600 rollback
journal alongside them; neither stores task data. The path deliberately ignores HOME,
XDG and TMPDIR (and Windows USERPROFILE/LOCALAPPDATA/TEMP overrides) so adapter
environments cannot split the lock namespace.
Projects containing this coordination directory are rejected for writes.
Coordination is for processes running as the same OS user on one host, using
local filesystems; cross-user, network-filesystem and cross-host writers are
not supported. Manual editors remain outside this protocol.

Retained coordination files do not mean a lock is held. Never remove, replace
or clean these files while any tracker process may be running: another process
may already hold their inode open. Cleanup is optional and only safe after all
tracker processes for that user have stopped. Keep the coordination directory
on a local filesystem and exclude it from cleanup while writers run.

Upgrade all writers together, including long-running MCP/HTTP processes.
Do not run older presence-lock writers alongside this version. An existing
`tasks/.task-tracker.json.lock` fails closed with `PROJECT_BUSY` and is never
automatically deleted, since it cannot identify a live owner. Stop all older
writers, then manually remove that legacy file and restart only upgraded
writers. An absent legacy file alone does not prove older writers have stopped.

## Reusable operations

Each command owns its argument parsing, help and execution flow:
[list-tasks.mjs](scripts/list-tasks.mjs) calls `listTasks` and handles filtering,
counts and pagination; [get-task.mjs](scripts/get-task.mjs) calls `getTask` for
one ID; [get-tasks.mjs](scripts/get-tasks.mjs) calls `getTasks` for ordered,
cursor-bounded ID batches. Shared [argument helpers](scripts/arguments.mjs) resolve positional
project selection for all public scripts and handle selection/output options and
numeric checks. Shared [output helpers](scripts/output.mjs)
format supplied records and report errors. The two commands call these small
helpers directly. Error construction lives in [src/errors.mjs](src/errors.mjs)
so argument checks and storage operations use the same error vocabulary.
[create-task.mjs](scripts/create-task.mjs) calls `createTask` from
[src/create.mjs](src/create.mjs), accepting one bounded inline/file/stdin JSON
input and returning the complete created task. Like the other scripts, it
resolves an omitted project to the current directory; core APIs require a path.
It shares record/graph validation with
[src/validation.mjs](src/validation.mjs), and lock/atomic-replacement/service
helpers with [src/service.mjs](src/service.mjs).
[inspect-blockers.mjs](scripts/inspect-blockers.mjs) calls `inspectBlockers` from
[src/blockers.mjs](src/blockers.mjs), reuses numeric checks, JSON formatting and
error reporting, and renders its own human graph summary.

The scripts use `listTasks(projectPath, options)`,
`getTask(projectPath, id, options)`, `getTasks(projectPath, ids, options)` and
`countTasks(projectPath, options)` from
`app/src/tasks.mjs`. They do not print or exit the process. For example, run this
from the repository root:

```bash
node --input-type=module <<'JS'
import { listTasks, getTask } from './app/src/tasks.mjs';
const page = listTasks('.', { filters: [{ field: 'status', value: 'pending' }], limit: 2 });
console.log(JSON.stringify(page, null, 2));
console.log(JSON.stringify(getTask('.', 1, { stores: ['all'], fields: ['id', 'title'] }), null, 2));
JS
```

List options are `stores`, `group`, `fields`, `filters` (`{field,value}` with
string values), `ids`, `sort`, `descending`, `limit`, `offset` and `schemaPath`.
Get and the other reusable operations also accept `schemaPath`; relative paths
resolve from the project root. Get accepts
`stores`, `group` and `fields`. The list result contains `tasks`, `total`,
`offset`, `limit`, `stores` (selected filenames), `fields` (output columns),
`hasMore` and `nextOffset`. Use `nextOffset` for continuation; separate reads
observe current files rather than a snapshot across concurrent edits.
Get returns the projected task object. Count returns a number without projecting
or rendering task contents; the input
read limit still applies. All three operations throw errors with a `code` property.

`inspectBlockers(projectPath, id, { depth: 3, limit: 20 })` returns the blocker
result described above and throws the same coded errors. Its options are only
`depth` and `limit`; history selection and field projection do not apply.
Like list/get, it does not print, exit the process, write files or run Git.

| Error code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Invalid arguments, options, field or store selection |
| `PROJECT_NOT_FOUND` | The selected project path is missing or not a directory |
| `READ_ERROR` | Selected configuration/store/directory cannot be read |
| `INPUT_TOO_LARGE` | Applicable configuration and stores exceed the 128 MiB project budget, or an 8 MiB caller/service input budget |
| `OUTPUT_TOO_LARGE` | A record, exact blocker result or response metadata cannot fit; narrow list/get fields or selections as advised |
| `INVALID_JSON` | A selected file or creation input has malformed JSON or UTF-8 |
| `INVALID_CONFIG` | Store or group configuration is invalid or ambiguous |
| `INVALID_STORE` | A selected store has an invalid read structure, disallowed status or duplicate ID, or an examined blocker field is malformed |
| `TASK_NOT_FOUND` | The requested ID is absent from the selected group/stores |
| `ID_CONFLICT` | An explicit creation ID already exists in a retained store |
| `FILE_EXISTS` | Schema materialisation found an existing file; replacement requires explicit `--replace` / `replace: true` |
| `ID_EXHAUSTED` | Automatic allocation has reached the safe-integer limit |
| `ACTIVE_BLOCKERS` | Creation or transition into a working status references current Active IDs |
| `TRANSITION_CONFLICT` | The stored modification timestamp differs from the expected value or is missing |
| `TIMESTAMP_EXHAUSTED` | The task timestamp cannot advance beyond the supported date range |
| `RECOVERY_REQUIRED` | A pending lifecycle move must be recovered before reading |
| `RECOVERY_CONFLICT` | External edits conflict with a pending move; no recovery writes were applied |
| `INVALID_SERVICE` | Service JSON structure or its counter is invalid |
| `PROJECT_BUSY` | Another cooperating operation holds the write lock |
| `PROJECT_CHANGED` | Source data changed during validation, creation or transition |
| `WRITE_ERROR` | Locking or atomic replacement failed; a cleanup error may follow a saved operation |
| `WRITE_INCOMPLETE` | Creation saved a task without service refresh, or a lifecycle move is pending; recover and inspect before retrying |

Scripts exit 0 on success (including empty lists, blocked tasks and cycle
diagnostics) and 1 on errors. Errors are
prefixed with the code on stderr and leave stdout empty; malformed JSON errors
identify the file without echoing its contents. Selecting `--store all` can
fail on history that was deliberately not read by an Active-only query.

## Automatic project preparation

There is no setup command. Use commands inside an existing project directory,
or select one with a positional path, `--project-path` or configured `--project`
name. The root must already exist. No Git repository or AI skill is required.

```bash
mkdir my-project
cd my-project
tasks create --title "First task"
tasks list --limit 10
tasks transition 1 --status done
tasks transition 1 --status cancelled
```

The first project operation, including reads and validation, creates missing
`tasks/.task-tracker.json` under the shared lock. This is initially an empty,
uncertified JSON object. Reads do not scan retained history to allocate a counter;
validation and mutations certify state through the existing all-retained-ID
validation path. Existing metadata and repeated-read bytes remain unchanged.
Help and invalid command syntax do not prepare a project.

Task lists, detail lookups and blocker inspection with no task files report missing
storage or tasks and leave only the service file. Validation with no task files
fails with “nothing to validate”, leaving the service file uncertified. Existing
history-only projects can validate successfully and allocate above retained IDs
when their first Active task is created.

Creation adds missing `tasks/active.json` on demand. Completion and archival add
`done.json` and `archive.json` only when needed, including combined updates and
the standalone/core deletion operation. All task file creation uses the shared
mutation lock. A rejected mutation removes its newly created empty destination;
a saved task or pending move retains its file for recovery.

Only explicit `tasks schema --write` materialises `tasks/task-schema.json`.
Other operations do not create it eagerly. Without a selected schema, defaults are
Active (`pending`, `in_progress`, optional `review`), Done (`done`) and Archive
(`cancelled`), with creation defaulting to `pending`. Existing configuration and
unknown fields are preserved. Configured standard filenames may remain absent
until needed; validation skips those absent files. Missing configured custom
filenames remain errors. Reads still require their selected files to exist.
The tracker never ignores, stages or commits service metadata automatically.

If usage is not already documented, add this guidance to the project's
instructions, or use the maintained
[Outask AI agent skill guide](../docs/outask-ai-skill.md) as the skill source:

> Discover commands with `tasks --help` and `tasks <command> --help`. Use the
> current project directory, `--project-path /absolute/path`, or `--project name`
> with global program configuration (`--config /path/to/config.json`).
> Read bounded summaries with `tasks list --limit 10 --fields id,title,status`
> and follow its continuation command. Read one task with
> `tasks get <id> --fields id,title,status,scope,acceptance`; use `--group Done`,
> `--group Archive` or `--store all` for history. Change tasks with
> `tasks create --title "Task title"`, `tasks update <id> --title "New title"`
> and `tasks transition <id> --status <configured-status>`.
> Run `tasks validate` after manual JSON edits. Preserve IDs, unknown fields and
> service metadata; Git staging and commits remain separate operator actions.

Commands do not inspect, discover or edit instruction or skill files or assert
that guidance is absent. The same conditional reminder appears in CLI help.
Optional hook installation is implemented; see the [hook guide](#optional-pre-commit-validation).

## Verification

For repository contributions, use the [PR delivery guide](../docs/contributing.md),
including explicit local main push-guard installation. That repository safeguard
is separate from the product's optional `tasks hook` pre-commit validation.

From the repository root, use Node.js 22.23.3 or later, npm, Make, Git and tar.
Run the complete PR checks locally with:

```bash
make ci
```

The [PR workflow](../.github/workflows/pr-ci.yml) keeps the complete Linux x64
checks, native macOS arm64 distribution jobs on `macos-15`, and native Windows
x64 jobs on `windows-2025`. All platforms
use Node.js 22.23.3 (the minimum supported version) and Node.js 24. Every job
installs both locked dependency trees and audits production and development
dependencies. Linux also runs all `app/tests/*.test.mjs` and
`app/mcp/tests/*.test.mjs` files.

Distribution checks build an archive for the current supported host, require its
metadata to match the Node and OS architecture, and install it in a temporary
home. They verify missing-dependency and incompatible-runtime diagnostics, remove
the download, and check installed CLI create/list/search/update/transition/validate plus
real SDK stdio MCP reads and writes against the same storage and required-field
validation. Windows also checks concurrent CLI/MCP writes, unique IDs, live-lock
exclusion and process-termination recovery, Unicode with project paths containing
spaces and Unicode installation directories, CP437 cmd.exe launch without
changing the console code page, persistent user PATH without duplicate entries,
and tasks-by-name in
PowerShell/cmd.exe with refreshed environments. The Windows registry value and
its type are restored in a finally block after the isolated check. A second installation uses a new-version fixture to check update and
uninstall preservation of task records, history, schema, configuration and user
documents. The final JSON evidence records OS version/architecture, Node
version/platform/architecture, artifact version/target and SHA256. Temporary
builds, installation and fixtures are removed automatically; these checks do not
tag or publish a release or change the repository's package version.

Native acceptance requires successful checks on the matching platform.
Cross-built archives prove composition only; record native results with the task.

To repeat only a failed stage, use `make ci-dependencies`, `make test`, or
`make test-distribution`. Install the dependencies first before running either
test target. Successful stages print short PASS summaries; failed commands
print their captured stdout/stderr, including the full Node test report.
`make test-distribution` automatically selects Linux x64, macOS arm64 or Windows x64 from the
current native Node host; other hosts fail. On Windows without Make, use
`node scripts/ci.mjs dependencies`, then `node scripts/ci.mjs distribution`;
the Windows CI job also runs focused native lock and installer checks.
Cross-building the Windows archive on Linux proves archive composition only.
To verify both runtimes locally, select Node.js 22.23.3 and Node.js 24 in turn
and repeat the checks for the host platform.

The underlying core and MCP runners remain available for focused checks:

```bash
npm ci --prefix app --omit=dev
node --test app/tests/*.test.mjs
```

For MCP changes, also install its development dependencies and run the
[real SDK client checks](mcp/README.md#sdk-selection-and-compatible-client-verification):

```bash
npm ci --prefix app --omit=dev
npm ci --prefix app/mcp
node --test app/mcp/tests/*.test.mjs
```

Preparation tests cover a fresh installed non-Git lifecycle, first-operation
errors, repeated-read preservation, custom configuration, history-only adoption
and invalid-state non-certification.
The CLI suite installs into temporary directories, checks symlink-chain invocation
from another directory, script parity, registry precedence/collisions, executable
continuations and data preservation across update/removal. Mutation coverage
includes installed CLI lifecycle, required fields, mixed-input collisions,
patch/no-op/conflict behaviour, custom statuses, manual-edit validation,
concurrent CLI writers, readable Git diffs and unchanged Git index/history.
The application suites create isolated temporary existing-format and minimum
projects. They check scripts and reusable operations, configured/mixed stores,
exact filtering, ordering, pagination, explicit history, passive references,
manual edits, errors and byte-identical stores after read scenarios. Resource
checks cover UTF-8 output budgets, aggregate input limits, complete-record
pagination and executable continuation commands. Temporary data is removed
automatically. Permission-denied checks run on POSIX systems;
Windows skips that permission-specific case. The baseline suite checks the
unchanged reference helpers. No linter, type checker or build is configured for
these JavaScript modules; Node's test runner loads the actual script code.
Blocker coverage includes exact Active intersections, history access checks,
Done/Archive operator moves with byte-identical dependents, restored and
self-linked cycles, shared descendants, passive fields, traversal limits and
response truncation without incomplete eligibility results.
Creation coverage includes inline/file/stdin input, current-directory and
explicit project selection, rejection of conflicting/repeated sources, retrieval, defaults,
minimum and extended records, all-store ID collisions, counter certification,
manual edits, source-preserving append, working-status checks, active cycles,
concurrent process locking, interrupted task/service replacement and recovery,
and response/source limits before writes. A history parse counter demonstrates
the normal allocation fast path; injected filesystem failures are confined to
temporary child-process projects.
Shared command checks cover current-directory defaults, explicit selection,
required detail IDs, numeric directory names, missing stores without directory
searches, and executable pagination continuations with either selection form.

Lifecycle tests cover script completion/archive/restoration, custom mappings,
required destination fields, preserved record source, Active release/reactivation,
stale-timestamp and concurrent writers, history-parse avoidance, interrupted moves
at each replacement boundary, validation/creation recovery, recovery conflicts
and filesystem failure diagnostics. Fault injection is confined to temporary
child-process projects.

Timestamp checks include creation ownership, legacy/no-op preservation, exact
manual-edit preconditions, same-clock/rollback monotonicity, same-status store
changes, invalid and maximum dates, exempt-store validation, optional field
projection and shadowed/escaped status and date keys.

Partial-update tests cover whole field replacement, structural deduplication, explicit
removal, source preservation, atomic invalid patches, guarded status changes,
stale no-ops, concurrent additions, and inline/file/stdin script input.

Hook integration tests use disposable Git repositories and the installed CLI to
cover automatic preparation, blocked starts, completion/archive, start/complete/
restore, manual edits, validation and fresh IDs without a hook, accepted/rejected
commits, differing index/worktree snapshots, configured hook locations, preserved
foreign/modified hooks and hook-file symlinks, executable-mode restoration,
existing and later-created linked worktrees, repeated installation/removal and
cleanup. The automated
onboarding path is `node --test app/tests/hook.test.mjs`; it requires Git on PATH.
