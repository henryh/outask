# Tracker contract

The standalone/core operations, CLI and local MCP adapter share storage and
validation. The read-only HTTP adapter is available from a source checkout; it
is outside packaged CLI/MCP release acceptance. Runnable usage is in the
[operator reference](../app/README.md), [MCP guide](../app/mcp/README.md) and
[HTTP guide](../app/HTTP.md). The [product direction](product.md) defines the
component boundaries. Examples explicitly described as proposals remain proposals.

## Implemented project selection

All standalone scripts use one positional project-selection contract:
`list-tasks.mjs`, `create-task.mjs` and `validate-task-stores.mjs` accept zero or
one project path; `get-task.mjs`, `inspect-blockers.mjs`, `transition-task.mjs`
and `delete-task.mjs` accept an optional
project path followed by a required ID. With no project path, the script uses
the current working directory. An explicit path selects that directory;
relative paths resolve from the caller's directory, not the script's location.

ID-based commands use positional count without guessing: one positional is the ID
in the current directory; two are project path then ID. A numeric directory
name is a path only in the two-positional form. Missing IDs and extra positional
arguments are `INVALID_INPUT`. No command searches other directories when
a required store is absent: reads report the missing store, and validation fails
when no task files are available. Project operations create missing service state
automatically; mutations create standard destination stores when needed.
No command prompts for project selection. See [automatic preparation](#project-initialisation).

This default belongs to scripts. Reusable core APIs continue to require an
explicit project path. Task reads preserve source records but can create missing service metadata.
Output formats and source validation remain shared. List continuation commands retain
the original selection form and must be run from the same working directory.

## Implemented read configuration

List/get and blocker inspection resolve one selected project directory and use
the same store discovery and read checks. Configuration is optional. Automatic
selection uses `tasks/task-schema.json`; if that file is absent, an existing
legacy `docs/task-schema.json` remains supported. If both exist, the operation
fails with `INVALID_CONFIG` until the caller selects one with `schemaPath` in
core, `--schema-path` in scripts/CLI/HTTP startup, or `schema_path` in MCP.
Explicit paths are relative to the project, must remain inside it and must exist.
The schema must be a regular file reached through ordinary project directories;
the file and its path components cannot be symbolic links. The same link check
applies to automatic default and legacy candidates before service preparation.
An explicit selector overrides both automatic candidates; no schema or task
record is moved or rewritten. The CLI's `--config` selects global program
configuration, not a project schema. No global configuration is read for task
record rules.

Without configuration, `tasks/active.json` supplies Active with `pending`,
`in_progress` and `review`. Existing `done.json` (`done`) and `archive.json`
(`cancelled`) supply the other groups; those history files are optional.
With configuration, the existing `stores` object declares filenames and
allowed statuses. Existing `validate` and `plan.required_for_statuses` settings
are accepted. No configuration or task record is rewritten.

The optional project `search` object configures content search. `mode` accepts
`scan`, `indexed` or `auto` and defaults to `scan`. The project schema does not
own performance thresholds. The installed program's global configuration owns
the non-negative integer `slow_query_ms`, shared across projects on the machine,
with a calibrated default of `150`. `auto` uses a current index, or performs a
scan and schedules a non-blocking refresh when the index is missing or stale.
`indexed` prefers a current index; when acceleration is unavailable it performs
the same authoritative scan, requests a refresh and emits a non-fatal
`CACHE_FALLBACK` advisory.

The optional `groups` object maps statuses to activity groups. When provided,
it replaces inferred mappings: every declared status must occur in exactly one
group, with no undeclared statuses. Empty/omitted groups are allowed. For example:

```json
{
  "stores": {
    "queue.json": { "statuses": ["todo", "doing"] },
    "mixed.json": { "statuses": ["todo", "shipped"] },
    "cancelled.json": { "statuses": ["cancelled"], "validate": false }
  },
  "groups": {
    "Active": ["todo", "doing"],
    "Done": ["shipped"],
    "Archive": ["cancelled"]
  }
}
```

Without `groups`, standard status names retain their standard mappings, then
statuses declared for `active.json`, `done.json` or `archive.json` inherit that
file's group. Conflicting conventional-file mappings are errors. This supports
existing configurations, including an `archived` status in `archive.json`.
Custom statuses in other filenames need `groups` for activity-group selection;
explicit store selection still reads those files without a mapping. If no
store maps to Active, a default read reports a configuration error instead of
silently presenting an empty work list.

Group selection reads only configured files whose declared statuses intersect
that group, then filters records by their mapped status. Thus mixed stores work,
and a conventional separate history file is not opened by an Active query.
For list/get, `--store` and `--group` are mutually exclusive. Explicit store
selection selects records in those stores regardless of group; results are still paginated.
`--store all` includes both
configured files and other discovered `tasks/*.json` files; missing configured
files fail when selected. An unconfigured retained file is available through
explicit store/all selection, without being assumed to contain Active work.
Filenames are local basenames; discovery does not recurse.

`tasks/.task-tracker.json` is reserved for service state and always excluded
from task discovery; explicitly configuring/selecting it as a task store fails.
After project and schema selection succeeds, every project operation creates it
if missing, including reads. Ambiguous or unsafe schema selection fails before
preparation. Existing service
state is not parsed for task reads or blocker eligibility. This name is settled for read discovery;
its implemented counter and fingerprint format is described under
[validation](../app/README.md#validation-and-manual-edits).

Read checks require JSON arrays of objects with positive safe-integer IDs and
non-empty title/status strings, and reject duplicate IDs in the selected files.
Declared store statuses are checked unless that store has `validate: false`.
Exempt stores still need the minimum read structure to return addressable tasks.
Every present `updated_at` must be a canonical UTC millisecond timestamp,
including in exempt stores; an absent legacy date remains valid.
Unknown fields are preserved as data. The standalone validator checks project-required
fields, plan fields, priorities, blockers and service freshness; a successful read is not a full validation verdict.
Blocker inspection checks the structure of examined blocker fields as described
[below](#implemented-local-blocker-inspection).
No read operation scans unselected history to validate project-wide IDs.

### Read limits and pagination

Read limits belong to the shared operations and also apply to standalone
scripts and future adapters. Lists default to 10 records and accept page sizes
from 1 through 50. Zero and larger values fail; there is no unlimited mode or
override. Filtering and deterministic sorting precede pagination.

Responses have a hard 32 KiB UTF-8 budget, including list metadata. A page may
contain fewer records than requested to fit the budget. Stop between complete
records, preserve their values, and continue after the actual returned count.
If the first projected record or a detail result cannot fit, fail with guidance
to select fewer fields. Empty successful pages must not hide an oversized
record. Field selection, all-field reads and alternate output formats cannot
bypass the limit; rendered output is bounded too.

JSON lists are objects containing `tasks`, `total`, `hasMore` and `nextOffset`,
with the selected page's metadata. `total` counts matches before pagination.
The last page has `hasMore: false` and `nextOffset: null`. This replaces the
earlier standalone script's bare JSON array. Human-readable output reports the
returned range and supplies a safely quoted next-page command preserving the
original project selection, filters, sorting, fields and format. CLI continuations
use `tasks list`; standalone continuations use `node` from `PATH` and a script
path relative to the current working directory. Run them in the same shell
environment and directory. Do not embed the installed Node version or absolute
script path. Human pagination guidance goes to
stderr; it shares the response budget with stdout. JSON carries pagination in
its page object without success diagnostics on stderr. Callers follow the returned continuation
rather than assuming the requested page size was filled. Separate invocations
read the current files; offset pagination does not create a snapshot across
concurrent edits.

Each operation may read at most 128 MiB of authoritative project JSON source bytes
in total, including optional configuration and the applicable selected or retained
stores. Enforce the budget during bounded file reads before parsing; an oversized
source produces an actionable error. Store arrays are decoded one record at a
time for validation, indexing and writes, so those operations do not retain
multiple decoded copies of the complete project. Operations that inherently sort
or return a selection may retain selected records in memory. Adapter requests and
service metadata retain their separate 8 MiB limit, and responses retain 32 KiB.
The project-source limit does not alter source files or read unselected history.

## Shared operations

Reusable scripts expose the basic operations independently of the CLI or any
service. CLI, MCP and HTTP are separate consumers of the same operations:
select a project, resolve local task references,
list/get/batch-get/create/update/delete tasks, filter and sort lists, change status,
search task content, inspect local blockers and validate stores. Each adapter exposes its supported
subset: HTTP exposes schema/list/count/get/search/batch and blocker reads for its startup-selected
project. Adapters own argument/response conversion and transport access controls.
The core owns file access, configuration, validation and write coordination.

Keep the first implementation small. Do not add a separate database, daemon,
event system or a generic plugin framework to extract the existing helpers.

### Implemented content search

`searchTasks(projectPath, query, options)` and the standalone/installed `search`
commands perform bounded, case-insensitive literal substring search in one
selected project's JSON stores. Search defaults to the Active group and the
fields `title`, `scope`, `acceptance`, `dependencies`, `sources` and `notes`.
Selected search fields combine with OR semantics. Missing fields do not match;
arrays and nested objects are traversed for scalar values without treating
object key names as searchable content.

Each result projects `id,title,status` by default and adds `matched_fields` and
bounded `snippets`. Callers may select result fields, search fields, one activity
group or explicit stores, and a page size from 1 through 50. Group and store
selection remain mutually exclusive. Search reuses the shared project/schema
selection, store validation, 128 MiB project-source limit and 32 KiB response limit.

JSON search pages contain `tasks`, `hasMore`, `next_cursor`, `stores`, `fields`
and `search_fields`. The opaque cursor is bound to the query, search fields,
result fields, group and stores; changing any of them fails with
`INVALID_CURSOR`. Human formats provide a safely quoted continuation. Each page
rereads current files and is not a snapshot across concurrent edits. Search does
not change the list/get response formats.

When a scan takes longer than global `slow_query_ms`, the page also contains a
bounded `advisories` array with `SLOW_SCAN`, the measured `elapsed_ms` and a
recommendation to enable or await indexed search. The array is absent below the
threshold and for indexed results. Advisory bytes count toward the existing
32 KiB response limit and may reduce the number of tasks that fit on a page.

The indexed backend uses a project-scoped SQLite FTS5 trigram database under
the user's cache directory, outside the project working tree. It stores task
records with an ID lookup index, store/status metadata, field text and source fingerprints, but remains
disposable: JSON task stores are the only source of truth. Fingerprint changes,
removed stores and schema changes make a generation stale. Refreshes are
deduplicated with a recoverable project lock and publish a complete database
atomically; failure leaves the previously published generation intact.

### Implemented read replica

The same disposable SQLite generation accelerates task detail, bounded list and
count reads (including filters and sorting), and local blocker inspection. These
operations use SQLite only after the current schema and complete retained store
set produce the generation recorded inside the database and its atomic pointer.
The replica contains each complete task record plus its sequence, ID, store and
status; operation-specific values are decoded from that record instead of
creating another writable or independently maintained task representation.

A missing, stale, corrupt or schema-incompatible generation is never an
operation error by itself. The read immediately uses the selected authoritative
JSON stores and schedules at most one refresh for that project generation.
Standalone and installed commands detach that refresh; persistent MCP and HTTP
adapters and direct core callers schedule it in their existing process. Refresh
still uses the search index's cross-process lock, complete temporary database and
atomic publication. A failed refresh leaves the previous complete generation in
place, although it remains unusable after its sources change.

Because freshness is checked before every replica read, a supported mutation or
manual JSON edit makes the old generation ineligible for the next read. That
read observes JSON immediately and a later read may use the newly published
generation. `search.mode` continues to select content-search and batch behaviour;
it does not disable this correctness-gated acceleration of list, detail or
blocker reads. Core, CLI, MCP and read-only HTTP continue to share the same
selection, projection, pagination, response-limit and error contracts.

Every task-data read accepts `noCache` in core, `--no-cache` in standalone and
installed CLI commands, `no_cache` in MCP, and `no-cache=true` in HTTP. It has
highest precedence over project `search.mode`: list/count/detail, batch, search
and blocker inspection read authoritative JSON without opening, building or
refreshing the SQLite cache. Cache acceleration uses the supported runtime's
built-in `node:sqlite`; no external SQLite package is used.

Cache support is optional for correctness. If SQLite cache acceleration cannot
be initialised, the read uses JSON and reports bounded `CACHE_UNAVAILABLE`
advisory metadata through the boundary's diagnostic channel. An explicitly
indexed search or batch without a current generation similarly returns JSON
with `CACHE_FALLBACK`, never an operation error caused only by cache state.
Core callers may supply `onAdvisory`; CLI uses stderr, MCP adds a small text
content item and HTTP uses a `Warning` response header. One request probes or
schedules a failing cache path at most once.

Development rule: every new task-data read operation must retain focused tests
for an authoritative JSON-only path and must remain correct with `noCache` set.
SQLite may be recommended as disposable acceleration, but no task-data result,
ordering, validation or error contract may require it. JSON remains the sole
source of truth and the only task-data write target.

### Implemented batch retrieval

`getTasks(projectPath, ids, options)` and the standalone/installed `get-many`
commands retrieve several known task IDs from one selected project. IDs must be
positive safe integers and may not repeat. Results preserve the caller's ID
order, while IDs absent from the selected group or stores are returned in
`not_found`. Active is the default selection; `group` and `stores` retain the
same mutually exclusive semantics as list/get.

Batch pages contain `tasks`, `not_found`, `hasMore`, `next_cursor`, `stores`
and `fields`. The limit from 1 through 50 counts requested IDs, including IDs
reported missing. The opaque cursor is bound to the ordered ID list, projected
fields, group and stores. Pages reread current source state and are not a
snapshot across edits. The 32 KiB response budget may end a page before the
requested limit; an oversized first projected record fails with guidance to
select fewer fields.

Batch retrieval follows the configured `search.mode`. `scan` reads selected JSON
stores, while `auto` and `indexed` use a current cache or fall back to a correct
scan and schedule a refresh when the derived cache is absent or stale. The
indexed path uses the cache's ID lookup and verifies the same store/schema
fingerprints as content search, so stale task data is never returned. JSON files
remain authoritative. CLI and MCP expose this operation; HTTP exposes it as
`GET /tasks/batch` for the startup-selected project. `GET /tasks/search` exposes
shared content search. Both preserve shared cursors, cache diagnostics, advisories
and response limits; the [HTTP guide](../app/HTTP.md) defines query encoding.
Automatic cache refresh remains a shared core side effect, with no HTTP
index-build operation or adapter-owned indexing.

## Record model and references

The accepted minimum retained task record requires only:

- `id`: the task identifier; preserve existing local numeric IDs.
- `title`: the task's name.
- `status`: the task's state.

Unless a project specifies otherwise, the standard format adds:

- `blockers`: local task IDs that block work only while present in `Active`.
- `priority`: the task's priority, supported by explicit list sorting.

The standard format does not make these fields universal requirements: a
project can choose the three-field minimum or specify its own extension.
Projects and skills define further fields and their requirements, including
`scope`, `acceptance`, `techdesign`, `stages`, `values` or `completed_at`.
Operations must preserve additional fields in existing records. Existing stores
must not be bulk-rewritten merely to add standard fields. Creation defaults to
the standard format with `priority: "medium"` and `blockers: []`; top-level
`format: "minimal"` in the selected task schema omits those defaults. Omitted
status defaults to `pending`, configurable through `default_status`. Title is
required and ID is allocated when omitted. Creation in both formats additionally
stamps tracker-owned `updated_at`; caller-supplied dates are rejected. Existing
three-field records remain valid and are not migrated merely by reads/validation.
See [creation](#implemented-creation) for its input and destination rules.

This repository declares its stricter contributor task format in
`tasks/task-schema.json`; it does not change the tracker's minimum. Existing
records remain valid without a bulk rewrite. Project-specific required fields
use global or per-store `required_fields` arrays, enforced by shared validation
as specified below.

The first version uses a flat task list with local blockers. Fields such as
`type` and `parent` are preserved as project data, without built-in meaning,
default type values, parent validation, child lookup or hierarchy traversal.
Local hierarchy may be added later as a separate optional component.

External references are passive task data for a human or agent to follow.
Projects choose their field name and representation. Do not introduce external
strings into enforced `blockers`, parse or resolve external links, validate
their targets or use them to select work. An extension field named `parent`
does not create an enforced relationship.

For local blockers, detect cycles between active tasks. Only links between
active tasks participate in the blocking graph; inactive references need no
target lookup. Do not infer blockers from `parent` or other extension fields.

## Priorities

The standard priority scale is `low`, `medium`, `high`. The default is `medium`.
When sorting by importance, use `high` before `medium` before `low`.

Under the standard format, a missing priority is treated as `medium` without
rewriting an existing record. Creation uses `medium` when no priority is
supplied. A project that selects the minimum format does not acquire an extra
mandatory field. Projects may define another scale and its ordering; the exact
configuration syntax remains open.

## Statuses and activity groups

### Effective schema operations

Implemented: shared `inspectSchema` and `materialiseSchema` operations expose
the selected project schema as a complete editable JSON document. Standalone
`schema.mjs` and `tasks schema` inspect by default; `--write` materialises and
`--replace` explicitly permits replacement. MCP exposes `inspect_schema` and
`materialise_schema`; read-only HTTP exposes `GET /schema` only. Project and
schema selection match other operations, including required existence of an
explicit schema selector. Both operations return the same direct schema JSON.

No-schema output includes all standard stores and Active/Done/Archive groups,
even for absent optional history files, plus standard creation format, pending
default and working statuses. Configured stores, fields and extension data
remain intact. Inferred groups include declared statuses only; unmapped custom
statuses require explicit groups. Absent creation/working defaults are expanded
only where their explicit values satisfy existing schema rules: undeclared
`pending` stays implicit, undeclared working statuses are omitted from the
expanded set, and defaults mapped outside Active stay implicit. This preserves
the custom project's existing creation/blocking semantics.

Inspection needs no task stores and performs only normal service preparation.
Materialisation validates existing retained stores, checks response/source
budgets before writing, uses shared write coordination and atomically creates
or replaces only the selected schema. Existing schemas fail with `FILE_EXISTS`
without explicit replacement. Failures leave schema/task bytes unchanged;
normal service preparation may already have happened. Empty projects may obtain
a skeleton without creating stores; shared validation still requires a retained
store. Materialisation does not certify new service fingerprints: subsequent
validation or task writes refresh them through the existing validation path.
See the [operator commands](../app/README.md#inspecting-and-materialising-the-task-schema).

### Activity groups

Statuses belong to three activity groups:

| Group | Meaning | Standard statuses |
| --- | --- | --- |
| `Active` | Current work, including waiting and work under review | `pending`, `in_progress`; optional `review` |
| `Done` | Completed tasks | `done` |
| `Archive` | Cancelled or deleted tasks retained outside current work | `cancelled` |

Review is optional: a project can use `pending`, `in_progress`, `done` and
`cancelled` without a review stage. Existing `review` records remain supported.
The standard working statuses are `in_progress` and, when used, `review`;
membership in `Active` alone does not mean work has started.

Projects may define their statuses and map them to these groups and working
semantics. Group membership follows that mapping; it does not add another
mandatory field to task records. Cancellation/deletion leads to `Archive`,
retaining the task record rather than treating it as completed work or silently
removing it from all stores. Physical store mapping must remain compatible with
existing project files; permanent removal is not part of the specified status
changes.

Allow transitions from any status to any other status permitted by the project's
configuration. Do not impose a fixed transition sequence or require review.
This includes returning tasks from `Done` or `Archive` to `Active` with the same
ID. Existing project validation, active-blocker start checks and cycle checks
still apply to the resulting state. Reactivation makes the ID active again;
dependent records remain untouched.

Standalone transitions and deletion are implemented by `transitionTask` and
`deleteTask` and their scripts. There is no `from`/`--from` input. The optional
`ifUpdatedAt`/`--if-updated-at` precondition compares the exact stored timestamp
under the shared writer lock; a different or missing date fails with
`TRANSITION_CONFLICT`. Without a condition, operations use current state. Delete
selects a configured Archive destination, and restore is an ordinary transition
to Active. Missing standard destination files are created when needed, matching creation;
missing custom files remain errors.
Existing extension fields are preserved; no completion date is generated.
Final destination requirements and Active checks apply.

Creation and every actual lifecycle mutation set `updated_at` to a canonical
ISO UTC millisecond string. Date generation takes the later of the current clock
and one millisecond after the previous date, so repeated or rolled-back clocks
do not repeat a version. A true no-op preserves record and service bytes;
a same-status change of store is an actual mutation. Legacy records may omit
the date; their first actual change adds it. The maximum supported date remains
valid for reads/no-ops but cannot advance (`TIMESTAMP_EXHAUSTED`). Invalid
stored dates fail validation, including in exempt stores. Source edits preserve
shadowed duplicate keys, other fields and numeric literals while changing only
the effective status/date or inserting a missing date.

Manual editing remains supported. Operators must advance a timestamped task's
`updated_at` when editing it so callers holding its previous date are protected.
The date is an exact optimistic precondition, not a content hash. Reads and
validation do not bulk-add timestamps or infer manual changes.

Cross-file lifecycle movement uses a bounded pending journal and recoverable
roll-forward of destination, source and service replacements. Reads reject a
pending journal; validation, creation and transition recover it under the shared
lock. Recovery rejects external file/service changes instead of overwriting them.
The shared synchronous lock resides in `app/src/project-lock.mjs`. It uses a
built-in SQLite exclusive transaction on a retained external coordination file
keyed by the canonical project path. Completion, exceptions and process death
release the OS lock without deleting the file. All adapters share this mechanism;
same-user local Linux/macOS/Windows processes coordinate independently of
environment cache/temp settings. Windows uses the OS-reported user profile
under AppData/Local/OutaskAI/locks and case-normalised canonical project keys;
POSIX retains /var/tmp/task-tracker-locks-<uid>. Project-relative service and
recovery journal paths use forward slashes on every platform. Legacy repository locks fail closed and require a coordinated
writer upgrade; see [lock paths, permissions and upgrade procedure](../app/README.md#project-lock-coordination-and-upgrades).
Certified transitions parse Active stores and the destination first, then search
other configured stores until finding the source ID. Restoring a history task
can therefore parse earlier history stores; all retained bytes are still hashed.
Unconfigured sources require configuration before movement. Missing/stale
certificates and IDs absent from configured stores use full validation/scanning.
See the runnable examples, timestamp limitations and
[recovery procedure](../app/README.md#changing-statuses-archiving-and-restoring).

Moving a blocker to either `Done` or `Archive` makes that ID stop blocking its
dependants because it is no longer in `Active`. No dependent record is updated. Eligibility
uses only active membership, as specified below; it does not require proof of
completion or a lookup of the task's destination store.

## Work lists and starting a task

A developer or agent chooses a task from current, filtered lists. Provide
explicit sorting, including priority where used, and make local blocking
relationships visible. The tracker supplies the data and enforces local start
constraints; it does not impose a business-priority or task-selection policy.
A `next` convenience may later compose these operations without becoming a
required core operation.

For projects using local blockers, load the IDs of the current project's active
tasks once for the operation. A task is blocked exactly when its `blockers`
array intersects that set. No intersection means eligible, even if a referenced
ID cannot be found in another store. Do not load `Done` or `Archive`, or resolve
individual inactive IDs, for this check. A failed read of the active data is an
operation error, not an empty active set.

Any operation that creates or moves a task into a working state must reject it
while that intersection is non-empty.
This applies to generic updates as well as explicit status transitions and is
enforced by the shared write logic for scripts, CLI and MCP. The HTTP adapter
does not expose writes. Recheck the
current stored state at the write boundary; a previously eligible list result
is not permission to bypass the check. Report the blocking tasks in the error.

The operator must move each active blocker out of `Active` or explicitly remove
its blocking relationship before starting. Preserve all other IDs in `blockers`,
including those absent from `Active`; ignoring an ID for eligibility never means
removing it. Changing, completing, archiving or deleting a blocking task must
not rewrite dependent tasks. The next eligibility check simply uses the current
active ID set.

Inspection of former blockers in `Done` or `Archive` is an explicit detail/history
request, separate from eligibility. An inactive or unknown blocker ID is not an
unresolved-reference error for normal list, validation or start operations;
structural field validation still applies. External informational links never
take part in these checks.

### Implemented local blocker inspection

`inspectBlockers(projectPath, id, options)` in `app/src/blockers.mjs` and
`tasks deps <id>` inspect one Active task. The command supports text and JSON output. It shares list/get's store
reader, rereads the complete Active set on each call, and applies the same
128 MiB project-input and 32 KiB response budgets. Multiple Active stores and mixed-status
stores follow the configured group mapping. No separate history store, inactive
target, service state or external project is opened for eligibility or traversal.
An ID absent from Active is `TASK_NOT_FOUND`; a failed Active read remains an
operation error. This operation preserves task records, while creating missing
service state like other project operations. Creation and lifecycle transitions
enforce working-status blocker checks at their coordinated write boundary;
partial updates reuse the same checks.

The result contains `id`, `eligible`, `activeBlockers` and `graph`.
`activeBlockers` is the exact sorted, unique Active intersection, and `eligible`
is true exactly when it is empty. Eligibility describes only local blockers,
not a status transition or automatic task choice. Omitted blocker fields act
as empty arrays. Any examined blocker field must be an array of positive safe
integer local IDs; malformed fields produce `INVALID_STORE`. Duplicate blocker
IDs are collapsed in results without editing records. Project-required fields
and unrelated task graphs are outside this inspection's validation scope.

Options are `depth`/`--depth` from 1 through 20 (default 1 hop), and
`limit`/`--limit` from 1 through 50 (default 10 returned graph edges). No history
or field selection options apply. The graph contains `depth`, `limit`, `edges`,
`cycle`, `cycleStatus` and `truncated`. Edges are `{from,to}` ID pairs in
breadth-first order with ascending blocker IDs. Each task is expanded once at
its shortest distance from the root, which has depth zero. The graph contains
only links reachable from the selected task through Active nodes.

Cycle diagnostics apply to the returned edges. `cycleStatus: "found"` returns
the first detected closed cycle path in `cycle`, including `[id,id]` for a
self-link. `cycleStatus: "none"` requires a complete reachable graph with no
cycle. If that graph is incomplete and no cycle was found, the status is
`"unknown"`; `cycle` is empty for both `none` and `unknown`. A diagnostic does
not change the exact eligibility rule, and blocked/cyclic results exit 0.
Operation errors use the [read error vocabulary](../app/README.md#reusable-operations)
and exit 1.

`graph.truncated` has boolean `depth`, `limit` and `response` flags disclosing
cuts encountered at the hop, edge and UTF-8 output bounds. A found cycle can
coexist with truncation. Response-size truncation removes complete edges from
the end and recomputes diagnostics; it never shortens `activeBlockers`. If the
exact direct result cannot fit, the operation fails with `OUTPUT_TOO_LARGE`
instead of returning a partial intersection. Human output is also bounded.
See [runnable examples and operator checks](../app/README.md#local-blockers).

## Implemented creation

`createTask(projectPath, input, { store })` in `app/src/create.mjs` and
`tasks create --json '<object>'` create one task.
The command uses the shared [project-selection contract](#implemented-project-selection),
including the current-directory default; the core API requires a project path.
Supply standard field flags and/or one `--json` object string or
`--input <file|->` source, with the disjoint-field rules documented under
[CLI](#cli). Empty invocations, conflicting and repeated sources are rejected
before reading or writing project data. Inline input has the same
8 MiB input budget as file/stdin input, checked before JSON parsing.
The script accepts `--format json` (also the default) and returns the full task.
The API accepts JSON values and returns that same object without printing or
exiting. `--input -` reads stdin. Optional `--store name` (or `name.json`) chooses
among configured stores that allow the task's status. Without it there must be
exactly one destination. Creation creates a missing standard destination store as needed. Existing custom
configuration is preserved; missing custom stores remain explicit errors.
There is no separate initialisation command.
All file sources and creation stdin must contain valid UTF-8. Shared readers
reject malformed encoding with `INVALID_JSON` before task/service persistence;
invalid bytes are never repaired through replacement characters.

Top-level `format` is `standard` or `minimal`; top-level `default_status` must
name a declared status. Optional `working_statuses` lists declared Active
statuses and replaces the standard `in_progress`/`review` working set. An empty
array is permitted. Shared project loading validates these settings, including
when running explicit validation. See the [configuration example and defaults](../app/README.md#creating-tasks).

New records undergo shared field/required-field/plan checks even when their
destination exempts retained records from validation. Creation rejects
self-links in all statuses and cycles in the resulting non-exempt Active graph,
including a cycle exposed by a previously absent new ID. All current Active
IDs, including ones in exempt stores, participate in the working-status blocker
check. These checks happen after acquiring the shared project lock and rereading
the source state. Inactive blocker IDs remain untouched.

Task and service bytes remain unchanged on validation, collision, blocker or
size failure. The full result must fit 32 KiB before writing; the resulting
configuration/store sources must fit the 128 MiB project budget; service state
and caller-supplied task input must each fit their separate 8 MiB budgets.
Creation appends to the original array source, preserving unrelated records,
number literals and formatting, and emits the new record with two-space
indentation. It updates the counter and affected fingerprint after replacing
the task file. Both replacements are atomic individually; interruption and
recovery semantics are documented in the [operator contract](../app/README.md#creating-tasks).

## Partial updates

The implemented `updateTask(projectPath, id, patch, options)` operation follows the same timestamp contract as
creation and lifecycle operations. Callers cannot replace/remove tracker-owned
`updated_at`; an actual change stamps a strictly later date, and a true no-op
preserves it. An optional exact expected timestamp is checked under the write
lock before applying changes, including no-ops; stale or missing versions fail.
Manual editors retain responsibility for advancing their date. The optional
`ifUpdatedAt` precondition uses the shared `TRANSITION_CONFLICT` error.

An update changes only the fields and array operations supplied by the caller,
plus tracker-owned `updated_at` for an actual mutation; all other fields remain intact. Text, numeric and object-valued fields are
replaced with the complete supplied value. Objects are not recursively merged.
Prefer a flat record structure and avoid unnecessary nesting in project fields;
existing nested data remains supported. An agent edits a retrieved text or
object itself and sends the finished field value; the tracker does not interpret
text-editing instructions.

Arrays support both explicit whole-array replacement and addition of elements.
When adding, check for duplicates against the existing array and within the
incoming elements. Silently skip duplicates and append only new elements,
preserving existing order and the order of new elements. Do not emit duplicate
warnings or a separate report of skipped values. Equality is structural: object key order does not matter, array element order
does, and scalar types must match. Existing duplicates are retained.

An update returns the complete resulting task as persisted. If an addition
contains only duplicates, the task record remains unchanged and is returned
normally. The caller can inspect that task to see the final state.

For `blockers`, also reject self-links and cycles in the resulting active-task
graph before writing. Both replacement and addition use this check, so replacing
an array cannot bypass blocker validation. Inactive blocker IDs remain stored
and do not require history lookup.

Provide explicit operations to remove an optional field and to remove selected
array elements, including individual blockers. Required-field validation still
applies; removing a required field must fail without changing the record.
The patch envelope accepts only `set`, `add`, `remove` and `unset`:
`{"set":{"title":"Finished text","object":{"complete":true}},"add":{"tags":["new"]},"remove":{"blockers":[42]},"unset":["optional"]}`.
Each field can occur in only one operation; operations address literal top-level
field names, not nested paths. `set` replaces any JSON value, including arrays;
`add` and `remove` map fields to arrays of elements. Addition to an absent field
starts an empty array. Removal of an absent field/element is a silent no-op;
removal deletes all structurally equal occurrences. Applying array operations to
an existing non-array fails. `unset` removes optional fields. Attempts to patch
or remove `id` or `updated_at` fail even when supplying the current value.
Empty patches and structurally equal replacements are no-ops.

The standalone `update-task.mjs` accepts the same `--json`/`--input` sources as
creation and the same ID/project selection and `--store`/`--if-updated-at`
options as lifecycle commands. A content-only patch preserves its source store
unless `--store` is supplied; explicit status replacements resolve destinations
exactly like transitions, including ambiguous-store errors. Status and content
changes validate together against the final destination before any write.
Every update mode shares lifecycle locking, timestamp checks, journal recovery,
source-preserving writes, full-record/active-graph validation and resource limits.
Cooperating writers serialize and apply patches to the latest record. Callers
replacing content derived from an earlier read should supply its timestamp to
reject stale edits and reread/retry; arbitrary manual writers retain the
limitations documented for lifecycle operations.

## ID allocation and service state

Assign new numeric IDs with uniqueness across all task stores in the owning
project, including `Active`, `Done`, `Archive` and retained stores exempt from
record validation. There is no cross-project numeric ID allocator.

A small per-project service file may store an auto-increment counter to avoid
reading every task file on each allocation. The first project operation creates missing service metadata automatically.
This does not certify task contents: validation and writes use the shared
validator to scan all retained task files when allocation state is absent or
stale. Initialise the counter from that scan before allocating an ID. Preserve
other service fields when adding the counter. New IDs must exceed the observed
maximum, and ordinary allocations advance the stored counter.

Task JSON remains the source of truth; the service file is allocation metadata,
not another task store. Store discovery must exclude it from task-record scans.
Do not add a Git ignore rule for this file. This repository tracks validated
service state with the corresponding task-store changes under its
[Git delivery rules](../AGENTS.md#git-delivery-and-service-state). Staging and
committing remain operator/agent actions; the tracker must not perform them
automatically.
Counter allocation and task creation use the shared write coordination to
prevent cooperating writers from issuing the same ID. Failure/recovery rules
must preserve that uniqueness.

After external changes, the validator checks both task structure and whether
the counter still covers all task IDs. The service file records the validated
state of task files, for example as per-file content hashes. A mismatch or a
change in the discovered file set means that the cached state needs validation.
Missing state is initialised through the same validation path. Cached allocation
state must not be trusted after an external change has been detected.

On successful validation, bring the counter up to date and record the validated
file fingerprints, preserving other service fields. Invalid task data produces
errors without rewriting the task files or marking the invalid state as
validated. Successful tracker writes also keep their affected service metadata
consistent with the validated data. The fast path must not trigger a full scan
and parse of every task file merely because a normal tracker write occurred.

Provide a standalone validator that a developer may also invoke through a local
Git hook. Enabling and maintaining the hook is the project's developer's choice;
explicit hook installation is implemented as described below. Do not depend
on a hook's presence for correctness.
Git hooks are optional automation for the same validator, not a separate
validation implementation.

The service filename is reserved by [read discovery](#implemented-read-configuration).
The implemented validator stores a non-negative safe integer `counter`, its
certified value in `validated.counter`, and SHA-256 hashes in `validated.files`,
including configuration presence/content. It preserves the highest valid
observed/certified counter and unrelated service metadata. Missing or mismatched
counter certification, changed hashes or a changed file set makes creation run
full shared validation before allocation. Older certificates refresh through
the same path. These fields are tracker-owned cache state, not authentication
against deliberate edits to both counters and hashes.

With matching state, automatic IDs and explicit IDs above the counter avoid
parsing separate history. Explicit IDs at/below the counter run full validation
and an all-retained-ID collision check; an unused lower ID leaves the counter
unchanged. Normal creates parse destination/Active stores, hash all source
files twice and refresh only the affected fingerprint plus counter certification.
They do not parse all historical records merely because the previous creation
changed a task file. Explicit validation still checks all records on each
invocation. Hashing remains linear file I/O, bounded to 128 MiB per project-source pass.
See the [operator contract](../app/README.md#creating-tasks) for costs,
lock waiting, atomic replacement and manual-editor race limitations.
Ordinary blocker eligibility still uses only active IDs; a separate validation
or ID-allocation operation may inspect history stores when required.

## Project field validation

A project can declare additional required fields in its configuration. Shared
validation enforces those requirements consistently for scripts, CLI and
adapters using the corresponding operations. HTTP uses only shared reads;
scripts, CLI and MCP expose mutations. For example, a project requiring `acceptance` must reject a
new record without that field. Requirements apply to that project, not to the
universal three-field minimum.

Validate the resulting record before committing a create, update or status
change. A partial update need not resupply required fields already in the
record, but must not remove a field required by the applicable project rules.
Report which requirement failed and leave the stored data unchanged. Explicit
validation also reports violations introduced by manual edits.

Keep preserving additional fields not mentioned in the project configuration.
These checks concern declared structure; assessing the meaning and quality of
task content remains the responsibility of skills and developers. Implemented
global and per-store `required_fields` arrays keep their original presence
checks: values must exist and not be null, blank strings or empty arrays; zero,
false and objects remain valid. Optional extension fields otherwise remain
passive.

For typed project-owned fields, use a `fields` object at the top level or inside
a store. Store rules add to global rules; they do not override them. Each field
rule supports:

- `required`: require the field to be present and non-null. Empty arrays remain
  valid unless a separate array rule rejects them.
- `required_for_statuses`: require the field only for listed configured
  statuses.
- `type`: one of `string`, `array`, `number`, `integer`, `boolean`, `object`,
  `date` or `timestamp`.
- `non_empty`: reject blank strings and empty arrays.
- `items`: for arrays, require every item to match a supported scalar/object/date
  type.
- `non_empty_items`: for string array items, reject blank strings.
- `min_items`: require at least that many array items.

`date` accepts a parseable date string. `timestamp` requires the canonical UTC
millisecond form used by tracker-owned `updated_at`. Legacy
`plan.required_for_statuses` additionally checks non-empty `techdesign` strings
and non-empty `stages` arrays of non-empty strings. Validation-exempt stores
require only readable arrays of objects with usable, globally unique IDs.

## Configuration

Implemented global program configuration: `--config <file>` overrides `TASK_TRACKER_CONFIG`,
then `$XDG_CONFIG_HOME/task-tracker/config.json`, falling back to
`~/.config/task-tracker/config.json`. Explicit config replaces the default; no
registry is created automatically. Example:

```json
{
  "slow_query_ms": 150,
  "projects_root": "/path/to/projects",
  "projects": {
    "external-library": "/outside/projects/library"
  }
}
```

CLI `--project <name>` resolves immediate children of `projects_root` and explicit
`projects` mappings. Both settings use absolute paths. Different real directories
for the same name fail with `AMBIGUOUS_PROJECT`; aliases of one real directory
are equivalent. Names allow hyphens, never path traversal. `--project-path <path>`
or the existing positional path selects a directory without using its project
registry entries. Search still reads the global `slow_query_ms`. With no selector,
use the caller's current directory. Selectors cannot
be combined or repeated. There is no ancestor search, nested scan or worktree
heuristic: choose the exact worktree path or a distinct configured name.
Standalone scripts retain path-only selection but search reads global
`slow_query_ms` using the same default path and environment override.

The first release handles one project per command/request, including lists.
To access a neighbouring project, issue a separate request selecting it. Do not
aggregate several projects or accept several target projects in one operation.
Project-name/path resolution selects one target; it does not imply aggregation.

Keep supporting existing legacy `docs/task-schema.json` for stores, allowed statuses,
validation exemptions, required plan fields and configured `fields`. The
implemented status-to-group mapping is described in
[read configuration](#implemented-read-configuration). Additional presence-only
requirements use `required_fields`; typed or conditional requirements use
`fields`; creation format, default status and working semantics use the
top-level `format`, `default_status` and `working_statuses` settings described
under [creation](#implemented-creation).
Global config holds machine locations and machine-level search timing;
repository config holds shared project rules.
Registry precedence and complete usage are documented in
[CLI project selection](../app/README.md#selecting-a-project).
Project selection must not trigger traversal of external links in task data.

## CLI

`tasks list`, `tasks get`, `tasks deps`, `tasks validate`, `tasks create`,
`tasks update`, `tasks transition` and `tasks hook` are implemented through
the same handlers as the standalone scripts. Run `tasks --help` after installation.
The supported Node.js range is declared in `app/package.json` and checked by
the release installer. The CLI retains exit 0 for successful results (including blocker/cycle
diagnostics from `deps`) and exit 1 with `CODE: message` on stderr for failures.
Output formats and limits match scripts; executable continuation commands use
`tasks list` with the original arguments and a replaced offset. Explicit project
selectors retain their supplied form; implicit current-directory selection adds
no path. Help and Usage errors name the public command.
Public and standalone lists default to a compact `id,title,status` table.
`--full` selects all available fields and defaults to text without table-cell
truncation; explicit `--format text|table|json` overrides that rendering default.
`--full` with `--fields` or `--format ids` is invalid. Existing page/output limits
still apply, and continuation guidance preserves `--full` and explicit formats.
Other commands and core/MCP/HTTP defaults are unchanged.
See [CLI usage and errors](../app/README.md#installed-cli).

The following read examples work after installation:

```text
tasks list --project backend --status pending --fields id,title,status
tasks get 42 --project backend --fields id,title,scope,acceptance
tasks deps 42 --project backend --depth 3
tasks validate --project backend
```

Mutation commands are documented in [CLI task maintenance](../app/README.md#cli-task-maintenance):

```text
tasks create --project backend --input -
tasks update 42 --project backend --input -
tasks transition 42 --project backend --status cancelled
```

`tasks create --project backend --title "First task"` creates the first task and
its missing standard store in that selected project.

The optional local MCP adapter launches through `tasks mcp`. Published release
archives include its production SDK dependencies; source-checkout development
installs them separately. See the [implemented MCP contract](../app/mcp/README.md).

Support convenient CLI parameters for standard fields such as title, status,
priority and blockers, alongside JSON input/patch via stdin for complete
structures and project-specific fields. Both paths invoke the same operations
and validation. Implemented flags are `--title`, `--status`, `--priority` and `--blockers`
(comma-separated positive IDs; empty string clears). JSON uses `--json` or
`--input <file|->`, exclusively. Flags can accompany JSON only for disjoint
fields, including every patch operation; collisions and repeated scalar mutation
options fail. Mutation output is always the complete task as JSON.
All lifecycle changes use an explicit configured status through
`transition --status` or `update --status`, including starting, completing,
archiving and restoring. Archive transitions retain the task and its ID.

Follow [partial updates](#partial-updates) for field replacement, array addition
and explicit removals; its timestamp ownership and optional exact-date
precondition are settled above. The agent supplies only the requested changes; the utility preserves
the rest. Creation uses [ID allocation and service state](#id-allocation-and-service-state).
Ordinary deletion moves the task into `Archive`, preserving its ID and record;
status changes do not free that ID for reuse.

Preserve compact default lists (10 records; id/title/status), mandatory
[bounded pagination](#read-limits-and-pagination), field projection, count,
sorting, filtering and explicit history access.
Use exact status matching in the new interface; the old helper's substring
matching must not accidentally select a different status. Lists cover the one
selected project. Cap blocker-graph depth/output and disclose truncation.
Detail reads are explicit. Lists support choosing work as described
in [work lists and starting a task](#work-lists-and-starting-a-task); retrieving
a list does not select or start a task automatically.

Provide JSON and human-readable output, a stable documented error vocabulary,
and clear exit codes. Define errors for missing requested task/project, invalid
input/store, an active blocker preventing start, cycle and write conflict.
Read/modify operations must not require agents to access raw store files.

## Project initialisation

Project preparation is automatic; there is no separate `init` command. A valid
project operation automatically creates missing `tasks/.task-tracker.json`, even
when a subsequent read or validation reports missing task files. The selected
project directory must already exist. Help and rejected command syntax do not
prepare a project. Project selection remains shared across commands.

Preparation creates no task store or configuration eagerly. Creation creates a
missing standard Active destination; completion or archive/deletion creates its
missing standard destination when required, including combined field/status
updates. Standard defaults work without a task schema. Existing custom
configuration, records, IDs and extension fields are preserved; missing custom
store files remain errors rather than being guessed or replaced. Standard files
may be absent even when declared in configuration: validation skips absent
standard files, while reads of a selected missing store report an error.

Without the selected task store, `list`, `get` and `deps` report missing storage
or tasks and never create Active. `validate` fails with a clear missing-files or
nothing-to-validate diagnostic when no task files are present. Existing task JSON
without technical files validates normally and produces current service state,
including projects with only Done/Archive history and no Active file.
Reads preserve existing task bytes and do not refresh existing service metadata.
Missing metadata alone is not proof of validated task contents: successful
validation and writes establish the counter and fingerprints using the shared
validation, lock and recovery paths. Invalid data is never certified as valid.

The tracker never stages, commits or ignores these files automatically. It does
not discover, inspect or edit project instructions or skills. Help/documentation
provide conditional, copyable usage guidance: if usage is not already documented,
add it to project instructions, or alternatively a skill. It covers command
discovery, project selection, bounded reads, mutations and manual-edit validation.
Onboarding works without Git or an installed AI skill.

Implemented: `tasks hook [project-path] --install|--remove` explicitly selects
shared-validator installation as a POSIX `pre-commit` hook. CLI project selectors
match other commands. The hook validates working-tree data, not staged data, and
may refresh working-tree service metadata without staging it. Invalid staged data
with valid working-tree data can pass; invalid unstaged data can block a valid
staged snapshot. Operators remain responsible for reviewing/staging exact bytes.
Git resolves the configured hook location. Automatic installation requires the
selected Git root and a hook directory contained in it; shared/external locations
and nested projects receive concrete manual integration instructions. Existing
linked worktrees also prevent automatic installation from the main checkout.
An installed hook rejects invocation from another working tree, including one
created later. Shared-hook manual instructions select the invoking Git root.
Existing or modified hooks are preserved, including symlinks and non-executable files.
Repeat installation/removal recognises only the exact generated hook for this
checkout/project. See [hook operations](../app/README.md#optional-pre-commit-validation)
for coexistence, removal and configuration-change limits.
Ordinary task operations do not install hooks. Hook installation is separate
from Git staging and committing; the validator remains shared.

## Installation and skills

Implemented development installation (after
`npm ci --prefix app --omit=dev`, run `node app/scripts/install-cli.mjs install`):

```text
~/.local/bin/tasks -> /path/to/outask/app/bin/tasks
```

The entry point resolves its real installation location through symlinks;
the caller's working directory selects the target project independently of
application modules. Installation rejects unrelated targets and executable
`tasks` commands on `PATH`, and is idempotent for this checkout. Update this
checkout to update the linked command. `uninstall` removes only its own symlink;
`--bin-dir` overrides the default directory for both actions. These operations
never modify project data or configuration. See the complete
[install/update/removal procedure](../app/README.md#installed-cli).

When a developer or agent separately chooses to switch a skill to this tool,
use the repository-owned [agent skill guide](outask-ai-skill.md) as the
maintained source. It describes command discovery, config, operations, bounded
reads, errors, authorisation boundaries and continuation. Update its entry point
and affected references consistently; do not maintain a second implementation
in the skill. The tracker does not discover or edit skills. Compatibility shims
are only needed for actual remaining callers. Roles decide task content and
value; the tracker enforces data integrity. Human JSON editing stays supported.

## MCP and HTTP

Published release archives include the CLI and local stdio MCP adapter with
its production dependencies. The implemented read-only HTTP adapter is available
from a source checkout and remains outside packaged CLI/MCP release acceptance.

Both adapters reuse shared operations and remain independently usable; neither
requires a web panel or GUI to be delivered in this repository.

The implemented local stdio MCP adapter exposes typed list/get/create/update,
transition/delete, blocker inspection and validation tools through `tasks mcp`.
It uses the shared project resolver, operations, limits and write coordination;
external references and hierarchy fields remain passive. Dependencies are
isolated from scripts/CLI task commands. The [adapter guide](../app/mcp/README.md)
defines tool arguments, structured results/errors, client setup, removal and
verified SDK compatibility. It needs no HTTP daemon.
Protocol reference: https://modelcontextprotocol.io/docs/learn/architecture

The independent read-only HTTP adapter is implemented through `tasks http`. It
serves one startup-selected project on IPv4 loopback, using the shared core and
current repository files for schema/list/count/get/search/batch/blocker reads. A mandatory server
environment Bearer token protects reads; rotation replaces the environment token
and restarts the process. There are no HTTP mutations or validation endpoint.
The [HTTP guide](../app/HTTP.md) defines routes, bounded input/output, errors,
project/file access, HTTPS reverse proxy requirements and optional exact browser
origins/preflight. Startup selection follows CLI defaults; requests cannot choose
arbitrary project/configuration paths. The adapter permits public proxy Host and
browser headers. Deployment, TLS and authentication infrastructure beyond the
read token remain operator responsibilities outside current scope.

Web panels and GUI wrappers belong to separate projects if the user wants them.
This repository must not acquire UI assets, a frontend build or web/GUI delivery
tasks as part of the base utility.
