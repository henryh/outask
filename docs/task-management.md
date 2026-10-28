# Tasks in this repository

Only PM changes contributor tasks, within the owner's authorised scope.
`tasks/active.json` and `tasks/done.json` own status; `tasks/task-schema.json`
owns required fields. Do not import other project stores or reset the backlog.

## Task records

- Positive integer IDs are unique across retained stores; the tracker allocates them.
- Active: `pending`, `in_progress`, `review`. Done: `done`.
- Every task requires `scope`, nonempty `acceptance` and `blockers`.
- Done requires `completed_at`. Only blockers still in Active prevent starting.
- Validate and commit changed stores with refreshed `tasks/.task-tracker.json`.
  The tracker never stages or commits files.

Use `task-<id>-<slug>` and preserve corrections there. Record acceptance, set
`completed_at` and close on that branch before the final push. Branch-local done
means candidate acceptance; status on `main` owns delivered completion. Rework
returns to review and removes `completed_at` until affected gates pass again.
Follow the complete [delivery sequence](contributing.md#task-delivery).

## Agent task access

Prefer connected tasks MCP tools; pass this repository's absolute `project_path`.
List Active with `fields: ["id", "title", "status"]`, `limit: 10`; follow pagination.
Use `get_task` or `get_tasks` for selected details and explicit history selectors
when needed. See [MCP setup](../app/mcp/README.md).

PM uses `create_task`, `update_task`, `transition_task` and `delete_task` for writes.
Use the last-read `if_updated_at` for stale-write protection. Successful mutations
validate/refresh service state; use `validate_project` after manual repairs and
at explicit validation gates. Report failures and inspect state before retrying;
a mutation transport failure may already have persisted.

If MCP is unavailable, use the [CLI](../app/README.md) with an explicit project path:

```sh
outask list --project-path /absolute/project --fields id,title,status --limit 10
outask get 1 --project-path /absolute/project
outask validate --project-path /absolute/project
```
