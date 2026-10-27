# Outask agent guidance

Use Outask for authorised project planning, task selection, delivery and
continuation. The tracker preserves task data; agents and project instructions
own scope, priorities, acceptance, review and Git actions.

## Authority and adoption

Read the project's instructions and existing task workflow first. Use its
current tracker; adopting or migrating to Outask requires the user's decision.
Do not create parallel task stores. Status questions only read existing state;
planning authorisation does not itself authorise implementation. Task changes
and delivery follow the project's assigned roles and approval boundaries.

For a project that has adopted Outask, add this reference to its `AGENTS.md`
or equivalent, adjusting the guide path to its readable maintained location:

```md
For authorised multi-step work, follow `docs/outask-ai-skill.md`. Prefer the
connected Outask MCP server; use the installed outask CLI when unavailable.
Select this project explicitly, preserve IDs and fields, and treat status-only
requests as reads.
```

Outask requires no Git workflow or private agent skills. Apply branch, review
and release requirements only where the target project declares them.

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

## Work loop

1. Read current persisted task state before choosing work or resuming a session.
   Existing in-progress, review or merge-pending work stays current until the
   project workflow releases it.
2. Check relevant existing tasks before creating new ones. Split authorised work
   into independently observable outcomes with acceptance checks at their
   actual boundary.
3. For next-task selection, rank bounded Active candidates using project rules
   and inspect local blockers. Selecting or proposing work does not start it.
4. Record local dependencies as blocker IDs; inactive/unknown IDs do not block
   eligibility. External references remain informational.
5. During authorised delivery, record meaningful changes, observed checks, gaps
   and next action in the task. Do not claim acceptance beyond the exercised
   boundary or reconstruct task state from memory on continuation.
