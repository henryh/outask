# Tasks in this repository

Only PM changes contributor tasks, within the owner's authorised scope.
`tasks/active.json` and `tasks/done.json` own status; `tasks/task-schema.json`
owns required fields. Do not import other project stores or reset the backlog.

## Task records

- Positive integer IDs are unique across retained stores; the tracker allocates them.
- Every task requires `scope`, nonempty `acceptance` and `blockers`.
- Done requires `completed_at`. Only blockers still in Active prevent starting.
- For standalone backlog creation or correction, save and validate the records with refreshed `tasks/.task-tracker.json` on the current branch. Stop there; creating or switching branches, staging, committing and starting implementation require separate user authorisation.
- During authorised task delivery or Git recording, commit changed stores with refreshed `tasks/.task-tracker.json`.

### Delivery statuses

| Group | Status | Meaning |
| --- | --- | --- |
| Active | `pending` | Waiting to start |
| Active | `in_progress` | Implementing the feature |
| Active | `review` | Independent feature review |
| Active | `feature_qa` | Functional acceptance and regression tests from source |
| Active | `awaiting_owner` | Waiting for the owner's manual-test decision or result and agreement to proceed |
| Active | `delivery_in_progress` | Preparing the delivery candidate |
| Active | `delivery_review` | Independent review of the combined candidate |
| Active | `delivery_qa` | Build, artifacts and native installation acceptance |
| Done | `done` | Accepted candidate on the task branch and delivered change on `main` |

All started statuses remain Active until local candidate closure. Apply the blocker check when entering a started status. Under the [delivery sequence](contributing.md#task-delivery), record the owner's decision before starting delivery. Close the candidate on `task-<id>-<slug>` and set `completed_at` before requesting push approval. For rework, return to the affected stage and remove `completed_at` until its gates pass again.

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

If MCP is unavailable, run the [CLI](../app/README.md) from the repository root. Use `--project-path` when selecting another directory:

```sh
outask list --fields id,title,status --limit 10
outask get 1
outask validate
```
