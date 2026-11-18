---
name: outask-repository-task-tracker
description: Turn an agreed plan into Outask tasks for the current repository, reuse matching tasks, suggest an eligible next task, or resume a saved task by ID. Use when the user wants to track or continue repository work with Outask MCP.
---

# Plan to Tasks

Use the target repository's instructions for task ownership, authorization,
schema selection, priority, and delivery. Treat planning, a request for status,
and a request for the next task as reads. Write when the user authorizes saving
tasks or changing their status.

## Connect and read

Find the connected Outask MCP tools. Verify the connection and project with
`list_tasks` using `{"group":"Active","fields":["id","title","status"],"limit":10}`.
Use the server's working directory when you can confirm it is the target
repository. Add the target's absolute `project_path` to each call when the
server runs elsewhere, its working directory is unknown, or the project
requires explicit selection. Keep any required schema selector consistent.

If the server is missing or cannot start, follow [Outask and Codex CLI setup](references/setup.md).
An empty Active result is valid. Check `isError` and read `structuredContent`
or the client-rendered structured result. A fixed text acknowledgment alone
does not establish which records were read or written.

## Save the plan

1. Identify actionable tasks from the agreed plan. Capture their intended
   results, acceptance, and explicit dependencies using the project's fields.
2. Match each item against the Active results. Use `search_tasks` for
   distinctive terms from the desired outcome or title, one phrase per query, with
   `fields: ["id","title","status"]` and a small integer `limit`. Search relevant
   retained history explicitly with `group: "Done"`, `group: "Archive"`, or
   `stores: ["all"]` when configured stores require it. Use one store selector
   at a time. Use `search_fields` when relevant details are in custom fields.
   Follow returned cursors with the same query where needed. Fetch
   only candidate details using `get_task` with a numeric `id` or `get_tasks`
   with numeric `ids`, projecting the fields needed to judge a match. Reuse
   the ID when the intended outcome already exists. Ask about material ambiguity
   before creating a possible duplicate or changing existing scope. Resolve
   relevant incomplete or failed reads before concluding that a task is missing.
3. Before writing, call `inspect_schema`. Use its field types, required fields,
   default status, and store rules. Call `create_task` with a nested `task` object
   containing the title and applicable project fields. Let Outask allocate IDs.
   When authorized dependencies need IDs, save prerequisites first and use
   their returned numeric IDs in the dependent record. Create only missing
   tasks. If a write fails or its outcome is unknown, reread the selected
   project for the record before deciding whether to retry.

## Suggest or resume work

Prefer work already in progress when the project treats it as current. For an
eligible next-task recommendation, follow the project's order. If it defines
none, prefer higher priority then lower ID among startable tasks. Page the
bounded Active list with the returned `nextOffset` where needed, projecting
`id,title,status,priority,blockers`. A blocker is active only if its ID occurs
in Active. For a named candidate, `inspect_blockers` with its numeric `id`
returns its eligibility and Active blockers. Respect any additional
prerequisites in project instructions.

In a fresh session, retrieve the selected task by ID with only the fields
needed for the work, including `updated_at` if changing status. When the user
authorizes starting or resuming it, use `transition_task` with its numeric
`id`, the exact configured working `status` (normally `in_progress`), and the
last-read `if_updated_at` when present. Retain the same ID. For stale writes or
uncertain results, inspect the current task first. Report the saved or reused
IDs, the eligible task, and any blockers that affect the user's next action.
