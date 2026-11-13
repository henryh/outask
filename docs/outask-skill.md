# Outask agent guidance

Use Outask for authorised project planning, task selection, delivery and
continuation. The tracker preserves task data; agents and project instructions
own scope, priorities, acceptance, review and Git actions.

## Authority and adoption

Select or create the project's task stores and schema according to its owner's workflow.

For a project that has adopted Outask, add this reference to its `AGENTS.md`
or equivalent, adjusting the guide path to its readable maintained location:

```md
For authorised multi-step work, follow `docs/outask-skill.md`. Prefer the
connected Outask MCP server; use the installed outask CLI when unavailable.
Select this project explicitly, preserve IDs and fields, and treat status-only
requests as reads.
```

Apply the target project's branch, review and release requirements.

## Connect an existing project

Select the exact project directory and inspect its records and effective schema with `outask schema --project-path /absolute/project` before changing data. MCP uses the same project selector (`project_path`) with `inspect_schema`.

Declare the project's stores, statuses, groups and field types in `tasks/task-schema.json` or `docs/task-schema.json`. This example accepts string `scope` and `acceptance` fields:

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

For a missing `status`, projects using the default schema infer `pending` in `active.json` and `done` in `done.json`. Custom schemas require the per-store `missing_status` settings shown above, using a non-working status allowed by each store. Other stores require a schema setting or persisted status. Explicit values take precedence and receive normal validation. Reads and validation use effective statuses and preserve task files. Creation and actual mutations persist status; no-ops preserve task bytes and timestamps.

Run `outask list --project-path /absolute/project --limit 10 --fields id,title,status` (or MCP `list_tasks`), then `outask validate --project-path /absolute/project` (or `validate_project`). A missing-fallback error names the store and schema setting to correct manually. Other minimum-field errors name the file, zero-based record index and incompatible or missing field. Obtain the project owner's approval for data corrections, including malformed IDs or explicit statuses. Preserve existing IDs, unknown fields, field types and project-owned stores. Re-run the read and full validation after approved manual edits.

## Tool route

Prefer connected Outask MCP tools. Select the project on every call using
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
