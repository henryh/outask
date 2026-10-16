# Tasks in this repository

The public repository starts with an empty backlog and completed-task store.
New contributor tasks begin at ID 1. Historical development tasks are not part
of these stores. Do not import old tasks or reset an existing contributor backlog.

Task status is owned by `tasks/active.json` and `tasks/done.json`.
`tasks/task-schema.json` declares this repository's stricter contributor format:
every task requires scope, acceptance checks and blockers; done requires
`completed_at`. Active statuses are pending, in_progress and review; Done is done.
These are repository rules, separate from the tracker's three-field minimum.
IDs are positive integers unique across all retained stores. Only blockers still
in Active prevent starting work.

## Delivery plan

Only the PM role changes records. Create or select work only within the owner's
authorised scope. Use a matching `task-<id>-<slug>` branch and preserve corrections
in that task. Implement, obtain independent feature review, complete QA and
documentation, then record acceptance evidence and candidate closure on the same
branch. Validate and commit `tasks/.task-tracker.json` with every store change.
Do not create a separate closure PR. Rework returns the task to review and removes
`completed_at`; repeat affected gates before closing again.

The [full contributor delivery policy](contributing.md#task-delivery) governs
integration, explicit remote-action agreement, hosted CI, owner merge, release
value and post-merge verification. Follow it before publishing any candidate.
Status on main is authoritative; done on an unmerged task branch records
candidate acceptance. For release tasks, declare real publication and downloaded
asset acceptance as read-only post-merge delivery checks. Never describe those
results as already observed during pre-merge acceptance.

## Agent task access

Prefer connected `tasks` MCP tools. Discover their schemas in the tool catalog;
pass the known repository path as `project_path`. An ordinary list uses Active,
`fields: ["id", "title", "status"]` and `limit: 10`. Follow bounded pagination;
include history or detailed fields only for the requested check. Use `get_tasks`
for a known ordered ID batch. Read known instruction routes directly.

PM uses `create_task`, `update_task`, `transition_task` and `delete_task` for
authorised writes; `validate_project` checks all stores and refreshes service
state. The [MCP guide](../app/mcp/README.md) owns schemas and errors. If MCP is
unavailable, use the CLI or standalone equivalents. Report MCP failures and
inspect the result before retrying a mutation; switching interfaces does not
bypass errors or grant authority.

CLI reads default to the current directory and support explicit project paths.
Use `tasks list`, `tasks get <id>`, `tasks get-many --id <id>`, `tasks deps <id>` and
`tasks validate`. The [operator reference](../app/README.md) explains selection,
projections, search, structured write input and manual edits. PM prepares required
project fields before creating or changing tasks. Prefer `--if-updated-at` with
the last-read timestamp for stale-write protection. The tracker does not invent
`completed_at` and never stages or commits files.
