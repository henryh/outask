# Working in Outask AI

Read only the route needed for the request:

- Product scope and limits: [docs/product.md](docs/product.md).
- Shared data and operations: [docs/contract.md](docs/contract.md).
- Contributor tasks and agent access: [docs/task-management.md](docs/task-management.md).
- Setup and delivery: [docs/contributing.md](docs/contributing.md).
- Version, exact notes and publication: [docs/releases.md](docs/releases.md).

## Scope and layout

Application code and package manifests belong in `app/`; documentation, task
stores and release tooling belong at the root. Preserve the existing layout.
JSON in each project is authoritative. Preserve records, IDs, unknown fields
and readable diffs. Do not copy other projects' task stores into this repository.
The empty repository backlog is ready for explicitly authorised contributor work;
a discussion, status or next-task request does not start implementation.

CLI, MCP and HTTP share core storage and validation. New shared reads belong in
core/standalone, CLI, MCP and read-only HTTP; writes belong in core/standalone,
CLI and MCP. HTTP remains read-only. Document any exception with its concrete
reason. Align shared selection/defaults, options, inputs, output and errors,
including help, operator documentation and focused public-boundary checks.
Keep changes small and verify affected contracts. Documentation is in English.
Record current decisions in the affected document and acceptance evidence in
the task. Do not create duplicate project-state reports or historical handoffs.

## Task workflow

Only the PM role changes contributor tasks. Prefer connected `tasks` MCP tools;
use CLI/standalone only when MCP is unavailable. Report MCP failures and inspect
the result before retrying mutations. Ordinary lists use Active with
`id,title,status` and a small page; include history only when needed.
Read the [task workflow](docs/task-management.md) before task delivery. Preserve
corrections within the selected task and branch unless the owner agrees otherwise.

## Git delivery and service state

Follow the complete [contributor delivery policy](docs/contributing.md#task-delivery)
and [release policy](docs/releases.md) for every task/release candidate.
Use task branches. Finish implementation, independent review, QA, documentation,
acceptance evidence and candidate task closure before final publication. Deliver
implementation and closure together; do not defer known work to later PRs.
Declare publication/downloaded acceptance as read-only post-merge checks when
release is in task scope; resolve other unavailable acceptance with the owner
before publication. Before any PR, fetch and merge current `origin/main` locally,
resolve conflicts and verify the combined candidate; repeat if main advances.

Request explicit agreement for the exact final push/PR, CI monitoring and ready
transition. Include commits, version/scope and exact notes when applicable.
Changed candidates and subsequent pushes need renewed agreement. Starting work,
passing checks or merge approval alone does not authorise remote actions.
Only the owner merges, using **Create a merge commit**. Never directly push
`main`, rewrite history, squash/rebase a delivery merge or tag/upload manually.
The exact `Outask AI v<distribution-version>` PR title opts into publication;
the owner's merge approves that exact revision/version/notes and CD publishes.
Complete all native CI/archive gates before readiness and verify merged state,
publication and downloaded assets afterward. Failed gates stop delivery.

PM closes the task on its branch before the final push. Track
`tasks/.task-tracker.json`; validate and commit refreshed service metadata with
every task-store change. Rework returns the task to review and removes
`completed_at` until affected gates pass again. Status on `main` is authoritative
for delivered completion; branch-local done records candidate acceptance.
The tracker never stages or commits files.

Apply the release value gate: include an advancing stable package version,
matching lockfile and exact release notes for user-visible changes by default.
Record an owner's explicit deferral as `RELEASE_DEFERRED`; internal work without
release value uses `NO_RELEASE` with a reason. Accumulate all still-unreleased
user-visible changes in the next release. Use compact zero-patch identifiers
outside manifests/lockfiles, for example package `1.0.0` becomes `v1.0`.
Keep exact note structure and release/recovery safeguards in
[docs/releases.md](docs/releases.md).

For each clone explicitly run `make install-push-guard`; preserve existing hooks
as described in [setup](docs/contributing.md#fresh-clone). After approved delivery
verification, fetch origin, switch a clean checkout to main and fast-forward
from origin/main. Confirm matching HEAD and clean state. Preserve dirty files or
local commits: stop on unsafe synchronisation without stashing, discarding,
resetting or rewriting work. Do not delete the task branch automatically.
