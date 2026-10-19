# Working in Outask AI

Read the route needed for the request:

- [Product scope](docs/product.md).
- [Shared data and operations](docs/contract.md).
- [Contributor tasks and agent access](docs/task-management.md).
- [Setup and task delivery](docs/contributing.md).
- [Versions, exact notes and publication](docs/releases.md).

## Scope and layout

Keep application code/manifests in `app/` and docs, tasks and release tooling at
root. Project JSON is authoritative: preserve records, IDs and unknown fields;
do not import another project's stores. Discussion does not start delivery.

Shared reads belong in core/standalone, CLI, MCP and read-only HTTP; writes in
core/standalone, CLI and MCP. Keep defaults, inputs, outputs, errors, help and
focused boundary checks aligned. Document exceptions with their concrete reason.

Write English, command-first documentation. Keep READMEs under 200 lines and
archive instructions specific to their target platform. Record current decisions
in their owning document and acceptance evidence in the task; avoid duplicate reports.

## Task workflow

Only PM edits contributor tasks. Follow [task management](docs/task-management.md),
using connected tasks MCP with this repository's absolute `project_path` first.
Ordinary lists use Active, `id,title,status` and a small page. Report MCP failures
and inspect state before retrying mutations. Preserve corrections in the selected
task and branch unless the owner agrees otherwise.

## Git delivery and service state

Follow the complete [delivery](docs/contributing.md#task-delivery) and
[release](docs/releases.md) policies for every candidate. Use task branches;
finish review, QA, documentation and candidate closure before the final push.
Obtain exact push/draft-PR/CI/ready agreement; changed candidates need new agreement.
Only the owner merges, using **Create a merge commit**. Never push `main`, rewrite
history, squash/rebase delivery, or tag/upload manually.

Install the push guard in each clone. After successful delivery verification,
return a clean checkout to `main` and fast-forward from origin, preserving dirty
files/local commits and retaining the task branch as required by the delivery policy.
