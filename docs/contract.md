# Tracker contract

Planned coordination is defined in the [Work Origin delivery contract](work-origin.md).

Core/standalone operations own storage, validation and write coordination. CLI,
MCP and read-only HTTP adapt their inputs and outputs to those operations.
Shared reads belong in all four interfaces; writes belong in core/standalone,
CLI and MCP. Packaged releases
contain CLI/MCP; HTTP is available from a source checkout. See the
[operator commands](../app/README.md), [MCP guide](../app/mcp/README.md) and
[HTTP guide](../app/HTTP.md) for transport-specific usage.

## Product identity and installation footprint

Outask is the displayed product name; `outask` is the command and service
identifier. `tasks` is a permanent equivalent command.

The permanent default roots are `~/.local/share/outask` on Linux,
`~/Library/Application Support/Outask` on macOS, and
`%LOCALAPPDATA%\Programs\Outask` on Windows. Application files, default
`config.json` and disposable `cache/` live in these roots.
Updates stage and back up only managed program files beside that root. The
root, registry, cache and coordination inodes stay in place; successful updates
remove staging and backups. Installation cleanup covers managed application directories selected for migration and preserves unrecognised sibling files. Conflicting registries stop migration.

npm installations use npm's global package directory and command entries for application files. They use the same default Outask configuration, cache and coordination paths. Native npm install/update/uninstall owns the program lifecycle; npm uninstall preserves configuration, cache, skills and project records. See the [npm guide](npm.md).

`outask self update` manages the running CLI installation from any directory. It updates managed archives through the packaged updater and global npm packages through their owning npm/prefix/registry. Archive installation records the command directory as `bin` in installed `release.json`; commands can also be resolved through PATH. Updates retain the installation's distribution channel and newer installed versions. `--check` queries version availability and preserves application/project files (npm may write cache/logs): exit 0 current/newer, 10 update available, 2 unsupported context, 1 failure. Source checkouts, local npm/npx and unrecognised contexts receive update guidance. See [installation and updates](../app/README.md#installation-and-updates).

Necessary external integrations are POSIX links for both commands in
`~/.local/bin`, existing managed shell PATH blocks (including `ZDOTDIR`), and
Windows user PATH pointing to the root's `commands/` directory. Installation
consolidates its generated PATH blocks and preserves other shell code.
Managed source payloads are identified by release metadata and package ownership inside the known application parents. Refresh explicit client/hook references
when changing layouts; remove an installed hook with its original command first.
Explicit `--bin-dir`, `--release-root`, `--config`, `TASK_TRACKER_CONFIG` and XDG
paths remain supported choices. Modified hooks require manual integration.

Writer coordination uses the fixed POSIX `/var/tmp/task-tracker-locks-<uid>`
namespace and Windows `<OS-user-home>/AppData/Local/Programs/Outask/locks`,
independently of HOME/cache/config/temp overrides. Before changing coordination locations or protocol generations, finish active writes and close CLI/MCP/HTTP sessions. Start upgraded writers together on one generation.
Compatible updates within that generation preserve running sessions. Never
unlink or relocate live coordination files. Retirement requires all affected
writers to finish and close before coordinated migration and restart.
Loaded readers retain their cache paths; fresh processes use the Outask root or explicit XDG cache location. Clear a cache after its readers and refresh workers close.

CLI/MCP/HTTP launchers set the Node process title to `outask`; MCP metadata and
the HTTP `Server` header report `outask`. OS executable-image names (for example
`node.exe` on Windows), client-chosen connection labels and wrapper processes
are controlled by the OS/client.

Core entry points take a project path and return values; adapters handle output and exit status. Their options follow the shared rules below:

| Module under `app/src/` | Operations |
| --- | --- |
| [tasks.mjs](../app/src/tasks.mjs) | `listTasks`, `getTask`, `getTasks`, `countTasks` |
| [search.mjs](../app/src/search.mjs), [blockers.mjs](../app/src/blockers.mjs) | `searchTasks`, `inspectBlockers` |
| [create.mjs](../app/src/create.mjs), [update.mjs](../app/src/update.mjs) | `createTask`, `updateTask` |
| [transition.mjs](../app/src/transition.mjs) | `transitionTask`, `deleteTask` |
| [schema.mjs](../app/src/schema.mjs), [validation.mjs](../app/src/validation.mjs) | `inspectSchema`, `materialiseSchema`, `validateProject` |

## Project selection

Each operation selects one existing project directory. CLI/MCP support the
current directory, an explicit path or a configured name; HTTP fixes selection
at startup. Core APIs require an explicit project path. Relative paths resolve from the caller's directory. Select the exact project or worktree directory.

Standalone scripts use path-only selection: non-ID commands accept zero or one
project path; ID commands accept an ID alone or a project path followed by ID.
One numeric positional is always an ID; a numeric directory needs the two-item
form. Missing IDs, extra positionals and combined/repeated selectors fail with
`INVALID_INPUT`. Continuations retain the original selector and require the
same working directory and environment.

Global configuration precedence is explicit `--config`, `TASK_TRACKER_CONFIG`,
then the platform Outask application root's `config.json`. An explicit
`XDG_CONFIG_HOME` selects `$XDG_CONFIG_HOME/outask/config.json` instead.
The `task-tracker/config.json` path supplies configuration when the canonical registry is absent; installation copies it byte-for-byte into the canonical root and links the source filename for running clients. POSIX
uses a symlink; Windows uses a hard link, which is refreshed after each update.
A Windows registry-link failure preserves both settings copies; explicitly select an external registry when needed. Reconcile conflicting registries before installation. Explicit config selects the registry path. `projects_root` and `projects` mappings
use absolute paths. Names select immediate children or explicit mappings,
allow hyphens and reject traversal. Different real directories for one name
fail with `AMBIGUOUS_PROJECT`; aliases of one directory are equivalent.
Explicit paths bypass registry entries. Global config also owns non-negative
integer `slow_query_ms` (default `150`), including for standalone search.
Define task rules in the project schema.

## Implemented read configuration

The project schema defaults to `tasks/task-schema.json`, falling back to an
existing `docs/task-schema.json`. Both present is `INVALID_CONFIG` unless an
explicit selector chooses one: core `schemaPath`, CLI/scripts/HTTP startup
`--schema-path`, MCP `schema_path`. Explicit paths must exist, stay inside the
project and name a regular file through ordinary directories. Schema files and
all their path components must not be symlinks, including automatic candidates.
Selection preserves schema and record files.

The default schema assigns `active.json` the Active statuses `pending`,
`in_progress`, `review`; existing optional `done.json` (`done`) and
`archive.json` (`cancelled`) supply history. Files live directly in `tasks/`.
A configured `stores` object declares basenames, allowed statuses and optional
`validate: false`; discovery reads files directly in `tasks/`. An explicit `groups` mapping
replaces inference: every declared status must occur exactly once across
`Active`, `Done`, `Archive`, with no undeclared statuses. Empty groups are valid.
Without it, standard statuses retain their groups and other statuses in
conventional filenames inherit the file's group. Conflicting mappings fail.
Custom statuses elsewhere need explicit groups for group selection.

Group reads open only files declaring statuses in the selected group, then
filter records by status. Mixed stores work; separate unselected history stays
unread. Active is the default; no Active mapping is a configuration error.
`group` and explicit `stores` are mutually exclusive. Store selection includes
all records in those stores regardless of group. `stores: ["all"]` includes
configured files and other discovered `tasks/*.json` files; unconfigured stores
are otherwise available only by explicit selection. Selected missing stores
fail. Default/group reads and store selections `all` or `active` instead read as
empty when there is no schema or task JSON, and valid service metadata has no
evidence of previous task storage. List/search/batch return no tasks, count
returns `0`, and individual lookups return `TASK_NOT_FOUND`. Missing standard
files are skipped by full validation; missing configured custom files remain
errors.

`tasks/.task-tracker.json` is reserved service metadata, excluded from discovery
and forbidden as a task store. After safe project/schema selection, operations
create it if absent, including reads that subsequently fail for missing stores.
Preparation creates no schema or task store. Help and invalid command syntax do
not prepare projects. Reads preserve task bytes and do not refresh existing
service metadata or inspect it for blocker eligibility. Missing metadata is
uncertified; successful validation or writes establish its fingerprints/counter.

Selected read stores must be arrays of objects with positive safe-integer IDs, non-empty title and effective status strings and no duplicate IDs across selected files. Declared statuses are checked unless `validate: false`. Even exempt stores need this read structure; schemas cannot waive the ID/title minimum. Minimum-field read errors identify the source file, zero-based record index and first missing/incompatible field with a correction to make. See [connecting an existing project](outask-skill.md#connect-an-existing-project) for explicit schemas and approved corrections that preserve existing data. Every present `updated_at` must be canonical UTC milliseconds; a missing `updated_at` is valid. Reads preserve unknown fields and do not validate unselected history or all project-required fields. Blocker inspection additionally checks examined blocker fields. A successful read is not a full validation verdict.

## Records and project rules

Read and ordinary validation require `id`, `title` and an effective `status`. Only an absent status is inferred: without a schema, `active.json` supplies `pending` and `done.json` supplies `done`. Other stores have no implicit fallback. With a schema, each store containing status-less tasks needs an explicit `missing_status` naming one of its allowed statuses. Fallbacks cannot be `in_progress`, `review` or any configured `working_statuses` value. Explicit blank, null, wrong-type and undeclared values retain their existing validation rules. Inference supplies the same status for reads, filters, groups, search, counts and blocker checks; it never edits records or schemas. Full-validation exemptions remain as described below.

Standard creation adds omitted `priority: "medium"` and `blockers: []`; schema `format: "minimal"` omits those defaults. Both stamp tracker-owned `updated_at`. Title is required; omitted status defaults to `pending` or configured `default_status`; omitted ID is allocated. A configured default must name a declared status. Unknown fields, IDs, records and readable source formatting must be preserved.

`Active` means current work, `Done` completed work, `Archive` retained cancelled
or deleted work. Review is optional; standard working statuses are
`in_progress` and `review`. Schema `working_statuses` replaces that set with
an array of declared Active statuses, including an empty array. Active
includes pending and working tasks. Projects own their workflow and additional fields. External links and fields such as `type` or `parent` are stored as project data.

Full validation scans all configured/discovered retained stores and checks
project-wide ID uniqueness. Exempt stores need readable object arrays, usable
IDs and valid present timestamps, while other record rules are skipped.
Normal stores check title/status, declared statuses, optional standard priority,
blocker structure and project rules. Only configured, non-exempt Active records
participate in cycle validation. Inactive/absent blocker IDs need no lookup.
Unknown retained stores receive ordinary field/ID checks. Invalid task data yields validation errors and remains intact.

Global and per-store `required_fields` require present values other than null,
blank strings or empty arrays; zero, false and objects are valid. Typed `fields`
rules in stores add to global rules rather than overriding them:

| Rule | Contract |
| --- | --- |
| `required` | Present and non-null; an empty array is allowed unless separately constrained |
| `required_for_statuses` | Required only in the listed configured statuses |
| `type` | `string`, `array`, `number`, `integer`, `boolean`, `object`, `date`, `timestamp` |
| `non_empty` | Reject blank strings or empty arrays |
| `items` | Array elements match a supported type other than `array` |
| `non_empty_items` | Reject blank string array elements |
| `min_items` | Minimum array length |

`date` accepts a parseable date string; `timestamp` requires canonical UTC
millisecond form. `plan.required_for_statuses` requires a non-empty
`techdesign` string and non-empty `stages` array of non-empty strings. Mutations
validate the complete resulting record against its final destination; patches
need not resupply retained fields but cannot remove required fields. New tasks
meet ordinary creation rules even in validation-exempt destinations.

## Read limits and pagination

Shared limits apply across interfaces and output formats:

| Resource | Limit |
| --- | --- |
| List/search/batch page | Default 10, permitted 1–50 |
| Authoritative project sources | 128 MiB total per source pass, including applicable schema/stores |
| Caller input, adapter requests, service metadata | Separate 8 MiB budgets |
| UTF-8 response, including metadata/diagnostics | 32 KiB |

Source budgets are enforced during bounded reads before parsing. Store arrays
are decoded incrementally for validation/indexing/writes; selections and sorts
may retain selected records. Inputs must be valid UTF-8: malformed encoding or
JSON fails with `INVALID_JSON`. Limits never alter
source files or cause unselected history to be read.

Responses stop between complete records and continue after the actual returned
count. A first projected record/detail or required metadata that cannot fit
fails with `OUTPUT_TOO_LARGE` and narrowing guidance. Empty pages cannot hide an
oversized first record. Projection, all-field reads and human formats do not
bypass the budget. Mutation results must fit in full before persistence.
Human pagination guidance uses stderr and shares the output budget; JSON page
metadata needs no success diagnostic. Pages reread current files and provide
no snapshot across edits; follow returned continuations rather than assuming
the requested page filled.

### Lists, details and counts

Lists default to `id,title,status`; details return the complete record unless
projected. `fields: ["all"]` includes extensions. Missing fields are omitted in
JSON and shown as `(unset)` in human output. Unknown fields are reported when
records allow checking; `priority`, `blockers`, `updated_at` remain selectable
when absent. A task field named `store` remains ordinary task data.

Exact case-sensitive status filters prevent substring matches. Other string or
object filters use case-insensitive substring matching; numbers/booleans match
exactly and arrays match any member. Repeated filters combine with AND; requested
IDs combine with OR. Filtering and sorting precede pagination. Priority sorts
`high`, `medium`, `low`, treating missing/unrecognised values as medium and preserving stored values. Other sorts compare numbers numerically and strings in UTF-16
order; missing/null values are last ascending. Descending reverses the primary
order; ties always use ascending ID. Mixed numeric/non-numeric relative order
is unspecified and uses authoritative JSON regardless of cache availability.

List JSON contains `tasks`, `total`, `offset`, `limit`, `stores`, `fields`,
`hasMore`, `nextOffset`; total counts matches before pagination. The last page
has `hasMore: false`, `nextOffset: null`; offsets beyond the end return an empty
page. Get returns the projected object or `TASK_NOT_FOUND`; count returns a
numeric match total. Human list continuations retain all
selectors, filters, fields, sorting and formats with safe quoting. CLI uses
`outask list`; standalone uses Node from PATH and a script path relative to cwd.

CLI list defaults to a compact table; `--full` selects all fields and defaults
to text showing complete field values. Explicit `--format text|table|json` overrides
that default; `--full` with `--fields` or `--format ids` fails. List/get/search/
batch support text/table/json/ids; tables default to 60-character cells, changed
with `--max-width`. Blocker inspection and validation support text/json.

### Search and batch retrieval

Search is case-insensitive literal substring matching, defaulting to fields
`title`, `scope`, `acceptance`, `dependencies`, `sources`, `notes`. Search fields
combine with OR. Missing fields do not match; nested objects/arrays contribute
scalar values, not object key names. Results add `matched_fields` and bounded
`snippets` to projected task fields. Search JSON contains `tasks`, `hasMore`,
`next_cursor`, `stores`, `fields`, `search_fields`.

Batch retrieval requires distinct positive safe-integer IDs, preserves input
order and reports IDs absent from the selection in `not_found`. Its limit counts
requested IDs, including missing ones. Batch JSON contains `tasks`, `not_found`,
`hasMore`, `next_cursor`, `stores`, `fields`. Search/batch cursors bind the query
or ordered IDs, fields, search fields where applicable, and group/store
selectors. Changed selectors or malformed cursors fail with `INVALID_CURSOR`.
Both operations share selection, validation, limits and non-snapshot paging.

### Disposable cache

JSON is the only task-data authority and write target. A disposable project
SQLite generation outside the working tree accelerates list/count/detail,
blocker, search and batch reads. Before use, its recorded generation and atomic
pointer must match the current schema and complete retained store set. Manual
edits and supported mutations immediately make old generations ineligible.
Missing, stale, corrupt or incompatible caches fall back to authoritative JSON;
refreshes are deduplicated per project, recoverably locked and atomically
published. Failure retains the previous complete generation without making it
eligible against changed sources. CLI/standalone refreshes detach; persistent
adapters/core schedule them in-process.

Project `search.mode` is `scan` (default), `auto` or `indexed`, governing search
and batch. `auto` uses a current generation or scans and requests a refresh;
`indexed` also returns correct JSON when unavailable, with `CACHE_FALLBACK`.
List/detail/blocker acceleration follows source freshness checks.
Every task-data read supports core `noCache`, CLI/scripts `--no-cache`, MCP
`no_cache`, HTTP `no-cache=true`. It overrides mode and reads authoritative JSON directly. Cache bypass skips cache opening, building and refresh. Each new shared read must retain a tested JSON-only path.
Cache results, ordering, validation and errors must match authoritative reads.

Cache support uses built-in `node:sqlite`; failure to initialise acceleration
uses JSON and bounded `CACHE_UNAVAILABLE` advisory metadata. A request probes
or schedules a failing cache path at most once. Core uses `onAdvisory`, CLI
stderr, MCP a text content item, HTTP a `Warning` header. Search scans exceeding
global `slow_query_ms` add bounded `SLOW_SCAN` advisories with `elapsed_ms` and
index guidance.
Advisories count toward the response budget and may shorten pages.

## Local blockers

A task is blocked exactly when its `blockers` intersect current Active IDs.
Load Active once per operation; never fetch inactive/unknown targets, separate
history or external projects for eligibility. Failed Active reads are errors.
Omitted blockers act as empty arrays; examined values must be arrays of positive
safe-integer IDs. Results deduplicate blocker IDs and preserve stored arrays.

Creating or moving into a working status rechecks this intersection under the
writer lock, including through generic updates. Every Active ID participates,
including IDs in exempt stores. Reject with `ACTIVE_BLOCKERS` and the blocking
IDs. Self-links are rejected in all mutation destinations; resulting non-exempt
Active cycles fail validation. Completing/archiving a blocker releases dependants
through membership only: no operation rewrites dependent records or removes
inactive/unknown IDs. Operators must finish/archive blockers or explicitly
remove a relationship before starting.

`inspectBlockers` inspects one Active task, returning `id`, `eligible`, exact
sorted unique `activeBlockers` and `graph`. Missing Active ID is `TASK_NOT_FOUND`.
No history/projection selector applies. `depth` is 1–20 (default 1 hop), `limit`
1–50 (default 10 edges). Edges `{from,to}` follow breadth-first order, ascending
blocker IDs; each task expands once at its shortest distance from depth-zero
root. Only reachable Active nodes participate.

Graph fields are `depth`, `limit`, `edges`, `cycle`, `cycleStatus`, `truncated`.
`found` returns the first closed cycle path, including `[id,id]`; `none` requires
a complete cycle-free reachable graph; incomplete graphs without a found cycle
report `unknown`. The latter two have empty `cycle`. Truncation flags `depth`,
`limit`, `response` disclose each cut. Response cuts remove complete final edges
and recompute diagnostics, never shorten exact `activeBlockers`; an oversized
exact result fails. Cycles/blockers are successful diagnostics, independent of
eligibility and outside unrelated graph/project-field validation.

## Writes, versions and recovery

Writes reread current state under a shared same-user, same-host local writer
lock. Creation/lifecycle writes wait up to five seconds; validation fails
immediately when busy (`PROJECT_BUSY`). Canonical path aliases share a lock;
Windows normalises case. Coordination ignores cache/temp/home environment
settings. POSIX uses `/var/tmp/task-tracker-locks-<uid>` with private directory/
file permissions; Windows uses the OS user profile under
`AppData/Local/Programs/Outask/locks` with inherited ACLs. Projects containing that lock
directory are rejected for writes. Different projects have independent locks.

The retained external SQLite coordination files contain no task data. Completion,
exceptions and process death release the OS lock; a retained file is not evidence
of ownership. Never remove/replace coordination files while tracker processes
may run. Optional cleanup requires all that user's tracker processes to stop.
Ordinary compatible upgrades preserve persistent MCP/HTTP sessions and in-flight
writes. Sessions use their loaded code until their launching client restarts them normally; fresh
launches use the updated installation. Only an incompatible coordination-protocol
migration requires arranging for affected clients to close old sessions after
active writes finish before upgraded writers start. A `tasks/.task-tracker.json.lock` causes `PROJECT_BUSY`. Confirm that its writers have stopped before clearing it, then restart upgraded writers together. See [upgrade commands](../app/README.md#project-locks-and-upgrades).

These guarantees exclude arbitrary editors, cross-user/host/network-filesystem
writers, atomic snapshots across concurrent completed moves and power-loss
durability. Detected changes between source checks fail with `PROJECT_CHANGED`;
an arbitrary editor can still race the last check/rename.

Creation and actual mutations stamp canonical ISO UTC millisecond `updated_at`, strictly later than the prior date: max(current clock, prior + 1 ms). No-ops preserve record/service bytes; changing store at the same status is a mutation. An actual change also persists the effective/final status on a record with a missing status; equal updates and same-store transitions remain no-ops and leave status absent. The maximum supported date is readable/no-op-safe but cannot advance (`TIMESTAMP_EXHAUSTED`). Callers cannot supply, patch or remove this field. Manual editors must advance existing dates; reads/validation neither infer changes nor bulk-stamp records.

Optional `ifUpdatedAt` (CLI `--if-updated-at`) compares the exact stored date
under lock after recovery, even for no-ops. Missing/different dates yield
`TRANSITION_CONFLICT`; malformed expected dates are `INVALID_INPUT`. Unconditional changes use current state. When replacing content from a read, supply its observed date, then reread and reconcile on conflict.

CLI/script creation and updates accept one JSON object from `--json` or UTF-8
`--input <file|->`, plus standard `--title`, `--status`, `--priority`,
`--blockers` flags only for disjoint fields. Blockers use comma-separated
positive IDs; an empty string clears them. Field collisions across any patch
operation, repeated scalar options, combined/repeated input sources and
invocations without fields/input fail before project reads/writes. Output is full
JSON only. Inline/file/stdin input shares the 8 MiB caller-input budget.

### Creation and ID allocation

IDs are unique across the project's retained stores, including exempt/unconfigured history. Automatic IDs exceed the observed maximum
and stored counter. Unused explicit lower IDs leave the counter unchanged; higher IDs advance it. Automatic exhaustion is `ID_EXHAUSTED`; an unused
explicit safe-integer ID remains possible.

Service state stores non-negative safe-integer `counter`, `validated.counter`
and SHA-256 `validated.files`, including schema presence/content. Unknown service
fields survive refresh. Missing/mismatched certification, changed hashes or file
sets trigger full validation before allocation. Preserve the highest valid
observed/certified counter; malformed metadata is an error, never silently reset.
Matching certification allows automatic/higher-ID creates to avoid parsing
separate history; lower IDs require a full retained-ID collision check. Source
bytes are still hashed before and just before writes. Explicit validation always
checks all records; certificates are freshness metadata, not authentication.

Creation/status changes select a configured destination allowing the final status;
ambiguity requires explicit `store`. Missing standard destinations are created
on demand; missing custom stores fail. Creation uses two-space indentation.
New or changed nonempty arrays and objects are written across multiple lines
with two-space indentation at each nesting level; empty arrays and objects stay
inline as `[]` and `{}`. Updates align these values with their field indentation.
Creation, updates and lifecycle moves put the store's closing bracket on a
separate line and end with a newline. They preserve untouched fields and
records byte-for-byte, including numeric/string lexemes and existing formatting;
equal values are not reformatted. No-ops preserve all store and service bytes.
Lifecycle source edits preserve shadowed duplicate keys and change only effective
requested fields/date. Invalid records, collisions, blockers, stale requests and
size failures leave existing task/service bytes unchanged, apart from normal
missing-metadata preparation or recovery of an earlier operation.

A successful mutation returns the full persisted task. Creation atomically
replaces the task before service state; if service refresh fails,
`WRITE_INCOMPLETE` reports the saved ID. Inspect it and validate before another
create: blindly repeating an interrupted/lost response can create another task.
Changed fingerprints force safe revalidation; a saved ID is never freed.

### Partial updates

`updateTask(projectPath, id, patch, options)` accepts only `set`, `add`, `remove`,
`unset`. They address literal top-level fields, each in only one operation.
`id` and `updated_at` cannot be patched, even to their current values.

| Operation | Behaviour |
| --- | --- |
| `set` | Replace the entire JSON value, including objects/arrays; no recursive merge |
| `add` | Field-to-array map; append new structurally distinct elements in input order |
| `remove` | Field-to-array map; remove all structurally equal occurrences |
| `unset` | List of optional fields to remove, subject to final required-field checks |

Structural equality ignores object key order, preserves array order and compares
scalar types exactly. Addition checks existing/incoming duplicates silently,
preserving old duplicates/order. An absent addition starts an empty array;
removing an absent field/element is a no-op. Array operations on existing
non-arrays fail. Empty patches/equal replacements/duplicate-only additions are
no-ops and return the full current task. The tracker interprets values, not text
editing instructions. Unmentioned fields remain intact.

Content-only updates retain their source store unless explicitly selected;
status replacements resolve destinations as transitions do. Combined content/
status changes validate together, including working blockers/cycles. Updates
share lifecycle timestamps, locks, recovery, source preservation and limits;
cooperating writers apply patches to the latest record.

### Lifecycle and interrupted writes

Transitions allow any configured status to any other; there is no fixed order
or mandatory review. Delete selects a configured Archive status/store and retains
the record/ID; multiple Archive statuses require explicit `status`. Restore is
a transition back to Active with the same ID and final
validation/blocker checks. No completion date is generated; dependants are
untouched. Unconfigured source stores need configuration before movement.

Lifecycle moves stage full replacements and save bounded
`tasks/.task-tracker.pending` before atomically replacing destination, source
and service files, then removing the journal. Reads/inspections refuse pending
moves with `RECOVERY_REQUIRED`. Validation, creation and lifecycle writes recover
under the same lock. Never delete the journal to bypass recovery.

Recovery rolls forward verified before/after states, including temporary duplicate
copies, to exactly one retained record and matching metadata. It is idempotent
and checks staged content, paths, source budget and external file/service edits.
Malformed journals fail; external changes yield `RECOVERY_CONFLICT`, preserving
journal/current bytes for reconciliation. Post-publication failure reports
`WRITE_INCOMPLETE` with empty stdout. Recover and inspect before retrying:
a saved conditional request then conflicts; an unconditional repeat to the same
status/store is a no-op. Leftover UUID temporary files may be removed only after
the crashed process has stopped. See [recovery commands](../app/README.md#statuses-and-recovery).

## Effective schema and Git hooks

`inspectSchema`/`materialiseSchema` return the complete editable selected schema;
CLI `schema`, MCP `inspect_schema`/`materialise_schema`, HTTP `GET /schema` share
selection and JSON. Inspection performs normal project preparation.
Materialisation validates existing retained stores, checks budgets and uses the
writer lock/atomic replacement. Existing schema requires explicit replacement
(`FILE_EXISTS` otherwise). Failure preserves schema/task bytes. Empty projects
may obtain a skeleton; full validation needs a retained store. Run `outask validate` after materialisation to certify service fingerprints.

Default schema output includes standard stores/groups,
standard creation format, pending default and working statuses. Configured data
and extensions survive. Inferred groups include declared statuses only.
Expansion adds defaults only when they preserve existing semantics: undeclared
pending or defaults outside Active stay implicit; undeclared working statuses
are omitted. Custom unmapped statuses still require explicit groups.

`outask hook --install|--remove` explicitly manages an optional POSIX pre-commit
hook using the shared validator. It validates working-tree bytes and can refresh working-tree metadata. A staged snapshot can differ from the working-tree validation input. Operators review and stage exact bytes themselves.

Automatic installation requires the selected Git root and an internal hook
directory. Nested projects, shared/external hooks and existing linked worktrees
receive manual integration instructions. Installed hooks reject other working
trees, including later-created ones; manual shared hooks select the invoking
root. Existing/modified hooks, symlinks and non-executable files are preserved;
only an exact generated hook is recognised for repeat installation/removal.
Track the service file with task changes under this repository's [delivery rules](../AGENTS.md).

## Errors

Core throws errors with a `code` property. Task CLI/scripts
exit 0 on success, including blocked/cyclic inspection results, and 1 on errors
with empty stdout and `CODE: message` on stderr. JSON errors identify the source. Adapters preserve shared meanings:

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT`, `INVALID_CURSOR` | Bad inputs or continuation selectors |
| `PROJECT_NOT_FOUND`, `AMBIGUOUS_PROJECT` | Missing or ambiguously named project |
| `READ_ERROR`, `INVALID_JSON` | Unreadable source or invalid JSON/UTF-8 |
| `INVALID_CONFIG`, `INVALID_STORE`, `INVALID_SERVICE` | Invalid schema, record/store or metadata |
| `INPUT_TOO_LARGE`, `OUTPUT_TOO_LARGE` | Applicable input/response budget exceeded |
| `TASK_NOT_FOUND`, `ID_CONFLICT`, `ID_EXHAUSTED` | Missing selected ID, retained collision or exhausted allocator |
| `ACTIVE_BLOCKERS`, `TRANSITION_CONFLICT`, `TIMESTAMP_EXHAUSTED` | Blocked start, stale version or date cannot advance |
| `FILE_EXISTS` | Schema replacement needs explicit permission |
| `PROJECT_BUSY`, `PROJECT_CHANGED` | Lock unavailable or sources changed during an operation |
| `RECOVERY_REQUIRED`, `RECOVERY_CONFLICT` | Pending move or external edits preventing recovery |
| `WRITE_ERROR`, `WRITE_INCOMPLETE` | Persistence failed or saved data needs inspection/recovery |
