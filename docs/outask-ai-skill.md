# Outask AI Agent Skill

Use this guide when an agent is asked to plan, select, execute or continue
multi-step project work with Outask AI. It is portable project guidance: it
does not require the author's private skills, a plugin, a UI or a particular
home-directory layout.

Outask AI stores tasks in repository-local JSON and exposes the same operations
through the `tasks` CLI and optional local stdio MCP adapter. The tracker keeps
task data consistent; the agent and project instructions remain responsible for
scope, value, acceptance quality, implementation, review and Git actions.

## When To Use

Use this skill for authorised project work that benefits from persisted task
state, such as:

- splitting an approved feature, fix or documentation effort into tasks;
- selecting the current or next ready task;
- recording meaningful progress and checks for later continuation;
- resuming a later session from the repository's task data.

Do not use it merely because the user asks for status, asks a question or
requests a proposal. A status question reads existing task state only. A request
to plan work may create or update tasks when authorised, but it does not start
implementation unless the user also authorises delivery.

Before proposing Outask AI adoption, inspect and honour the project's existing
instructions and task system. If the project already has another tracker or an
incompatible task format, use that system and do not create a competing Outask
AI store unless the user explicitly decides to migrate or adopt it.

## Prerequisites

- The `tasks` command is installed, or the agent has a connected `tasks` MCP
  server for the target project.
- For MCP, the client can launch the local stdio adapter with `tasks mcp`; MCP
  requires Node.js 22.23.3 or later.
- The agent can select the target project explicitly with an absolute path or a
  configured project name.
- The project authorises the requested planning or delivery work.

Outask AI works without Git, but if the project uses Git, staging, commits,
branching, merges and publishing remain separate operator or project workflow
actions. Do not invent Git requirements unless the project instructions require
them.

## Project Instruction Snippet

When a project wants agents to use this skill without a plugin, add a short
reference to its `AGENTS.md` or equivalent project instructions:

```md
For authorised multi-step project work, use Outask AI task guidance in
`docs/outask-ai-skill.md`. Use the connected `tasks` MCP server first when it is
available; otherwise use the installed `tasks` CLI. Select this project
explicitly, preserve existing task IDs and fields, and do not create or start
tasks for status-only questions.
```

If the guide is kept outside the project, replace the path with the checked-in
or pinned location that agents can read.

## Tool Route

Prefer the connected `tasks` MCP server when it is available. Select the project
on every call with `project_path` or a configured `project` name. Use bounded
projections for lists, then read one selected task in detail. If an MCP call
fails, inspect and report the failure before retrying or switching interfaces;
do not use another interface to hide a failed mutation.

Use the installed CLI when MCP is unavailable:

```bash
tasks --help
tasks list --limit 10 --fields id,title,status
tasks get 1 --fields id,title,status,scope,acceptance
tasks get-many --id 1 --id 2 --fields id,title,status,scope,acceptance
tasks deps 1
tasks validate
tasks schema
```

Use `tasks create`, `tasks update` and `tasks transition` only when the user or
project workflow authorises task changes. Run `tasks validate` after manual JSON
edits. Preserve project-defined statuses, required fields, unknown extension
fields, IDs and service metadata.

Use MCP `inspect_schema` or CLI `tasks schema` to inspect the effective editable
configuration. With authorisation to create configuration, use
`materialise_schema` or `tasks schema --write`; replacing an existing schema
requires explicit `replace: true` / `--replace`. These leave task records intact.
When several task IDs are already known, prefer MCP `get_tasks` or CLI
`tasks get-many` to retrieve their bounded projections in one request; preserve
the ordered ID list and cursor selectors across pages.
See the [schema guide](../app/README.md#inspecting-and-materialising-the-task-schema)
for path selection, defaults and validation limits.

For maintained command and schema details, link to the existing owners instead
of copying them into a skill: CLI selection and task maintenance live in the
[operator reference](../app/README.md#selecting-a-project), MCP tool selection
lives in the [MCP guide](../app/mcp/README.md#tools-and-selection), and this
repository's own stricter PM access route lives in
[agent task access](task-management.md#agent-task-access).

## Minimal Work Loop

1. Read the project instructions, product requirements and any existing task
   workflow that applies to the request.
2. Check existing tasks before creating new ones. Search by relevant titles,
   IDs or area to avoid duplicates.
3. Split authorised work into independently verifiable outcomes. Each task
   should have a result that can be observed at its own boundary and acceptance
   checks that prove that result.
4. Record actual local dependencies as blockers. Only active blocker IDs should
   prevent selecting ready work.
5. Select current work before choosing a new task. A task already in progress,
   review, blocked or merge-pending remains current until the project workflow
   releases it.
6. For a next-task request, list Active tasks with bounded fields, rank by the
   project's priority rules when present, inspect blockers for the best
   candidates and report why the selected task is ready.
7. During delivery, record meaningful progress: changed artifact, checks run,
   observed result, gaps and next action. Do not claim acceptance from tests that
   do not exercise the requested boundary.
8. On continuation, read persisted task state first. Resume the current task or
   the next eligible task from the store; do not recreate tasks from memory.

Keep the workflow small. Do not impose mandatory extra fields, review stages,
branch rules or release steps unless the target project's own instructions or
task contract requires them.

## External Trackers

If the project already uses another tracker, issue system or task format:

- read the existing project instructions for that system;
- use the existing tracker for status, planning and continuation;
- do not create `tasks/active.json`, `tasks/done.json` or service metadata as a
  parallel record;
- recommend Outask AI only as an explicit adoption choice, with the tradeoff
  that the project would gain repository-local JSON and CLI/MCP operations.

## Plugin Packaging

This guide is the repository-owned source that a future plugin can package as a
skill. A plugin should reference or include this guidance, expose the local
`tasks` MCP route when supported by the client, and keep CLI fallback guidance.
It should not duplicate task storage logic, ship a separate scheduler, migrate
projects automatically or depend on private local paths.
