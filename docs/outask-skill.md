# Outask agent guidance

Use Outask for authorised project planning, task selection, delivery and
continuation. The tracker preserves task data; agents and project instructions
own scope, priorities, acceptance, review and Git actions.

## Authority and adoption

Outask uses the selected project's task stores and schema. Adoption requires selecting or creating that project's records deliberately; connecting MCP does not migrate another tracker or define the project's workflow.

For a project that has adopted Outask, add this reference to its `AGENTS.md`
or equivalent, adjusting the guide path to its readable maintained location:

```md
For authorised multi-step work, follow `docs/outask-skill.md`. Prefer the
connected Outask MCP server; use the installed outask CLI when unavailable.
Select this project explicitly, preserve IDs and fields, and treat status-only
requests as reads.
```

Outask requires no Git workflow or private agent skills. Apply branch, review
and release requirements only where the target project declares them.

## Connect an existing project

Select the exact project directory and inspect its records and effective schema with `outask schema --project-path /absolute/project` before changing data. MCP uses the same project selector (`project_path`) with `inspect_schema`.

Declare the project's existing stores, statuses, groups and field types in `tasks/task-schema.json` (or retain its existing `docs/task-schema.json`). For example, this schema accepts string `scope` and `acceptance` fields without converting them to arrays or importing this repository's contributor rules:

```json
{
  "stores": {
    "active.json": { "statuses": ["pending", "in_progress"], "missing_status": "pending" },
    "done.json": { "statuses": ["done"], "missing_status": "done" }
  },
  "groups": {
    "Active": ["pending", "in_progress"],
    "Done": ["done"],
    "Archive": []
  },
  "fields": {
    "scope": { "type": "string" },
    "acceptance": { "type": "string" }
  }
}
```

Adapt that example to the actual files and workflow; retain schema extensions and use `required: true` only for fields the project requires. If both schema locations exist, select one with CLI `--schema-path` or MCP `schema_path`. Reads require a positive safe-integer `id`, a non-empty string `title` and an effective status, including in `validate: false` stores. Full validation's [exemption rules](contract.md#records-and-project-rules) remain separate.

For records without a `status` field, no-schema projects infer `pending` in `active.json` and `done` in `done.json`. Existing schemas must explicitly add the per-store `missing_status` settings shown above, using statuses allowed by each store. Choose a non-working workflow status: `in_progress`, `review` and configured `working_statuses` cannot be fallbacks. Other stores need an explicit schema setting or persisted status; no status is guessed for them. Explicit values always take precedence and retain normal validation. Reads and validation return/use effective statuses without adding fields to task files. New tasks persist status; an actual change to a legacy task persists its effective/final status. No-ops preserve task bytes and timestamps.

Run `outask list --project-path /absolute/project --limit 10 --fields id,title,status` (or MCP `list_tasks`), then `outask validate --project-path /absolute/project` (or `validate_project`). A missing-fallback error names the store and schema setting to correct manually. Other minimum-field errors name the file, zero-based record index and incompatible or missing field. Obtain the project owner's approval for data corrections, including malformed IDs or explicit statuses. Preserve existing IDs, unknown fields and field types; do not renumber tasks, replace stores or copy another project's data. Re-run the read and full validation after approved manual edits. Connecting and reading never migrate or repair task records automatically.

## Tool route

Prefer connected Outask MCP tools (existing `tasks` registrations remain supported). Select the project on every call using
`project_path` or configured `project`. Start with a small Active list projected
to `id,title,status`, then retrieve selected details. Use `get_tasks` for several
known IDs; keep selectors and returned cursors consistent across pages.

If an MCP operation fails, report it and inspect its result before retrying or
switching interfaces, especially for mutations. Use CLI when MCP is unavailable:

```bash
outask list --project-path /absolute/project --limit 10 --fields id,title,status
outask get 1 --project-path /absolute/project
outask deps 1 --project-path /absolute/project
outask schema --project-path /absolute/project
outask validate --project-path /absolute/project
```

Inspect the effective schema before changing unfamiliar records. Preserve
project statuses, required/unknown fields, IDs and service metadata. Use shared
create/update/transition operations for authorised task changes; validate after
manual JSON edits. Reads preserve task records but may prepare service metadata.
See [CLI commands](../app/README.md), [MCP setup/tools](../app/mcp/README.md),
and [data rules](contract.md). This repository has stricter
[agent task access](task-management.md#agent-task-access).
