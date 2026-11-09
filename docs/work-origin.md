# Work Origin delivery contract

Use this agreed plan when implementing the optional Outask Work Origin client and its integration with the separate Outask Server project. These capabilities are planned, not currently supported commands. Apply the [2.0 scheduling and release gate](releases.md#work-origin-scheduling): deliver unrelated active work first; ship synchronization changes only in Outask 2.0.0 or later.

## Preserve local operation

Without configured coordination, preserve existing task fields and bytes, numeric ID allocation, statuses, lists, command outputs and network-free operation. Do not add coordination fields or require an installed server. Enrolling an existing project is explicit and preserves its records and unknown fields.

With coordination enabled, full tasks remain repository-local JSON distributed through Git. Outask contains a lightweight client and optional installation/configuration wrappers for the separately packaged Linux server. Coordination requests carry only identity, numeric allocation, status, ownership and operation-control data, not full task content.

## Identify projects, tasks and clients

- Use a stable project identity independent of checkout paths.
- Store `outask_origin_uuid` on each coordinated task, including tasks created offline. Preserve it through numeric renumbering and status changes.
- Identify each independent clone/worktree as `outask_client`, using a hostname plus an atomically assigned numeric suffix within the project, such as `myworkpc0` and `myworkpc1`.
- Preserve a client's identity on reconnect; copied checkouts and coincident hostnames must not accidentally share authority. Keep client credentials and local queue state outside tracked project files.

The worktree is the ownership boundary. Processes sharing one worktree share its client identity; independent ownership requires separate worktrees or clones. Hostnames are labels, not authentication credentials.

## Coordinate online and offline work

Coordinate creation, taking ownership, edits, completion and archival across every retained store and status, including project-defined statuses. Check ownership and the expected current revision atomically. Ordinary conflicting or stale operations fail clearly. Network waits must not hold local writer locks, and final local validation/write coordination still applies.

Confirm force for a concrete operation, affected task, expected state and destructive consequences. Changed state invalidates confirmation. CLI asks interactively; MCP exposes a separate confirmation step rather than permanent blanket authority. An explicitly forced creation with an occupied numeric ID replaces the existing task; it never leaves duplicate IDs in the final store.

When disconnected, continue creating, taking, editing, closing and archiving tasks. Maintain a durable local queue and visibly distinguish unconfirmed work. Taking a task last known to be free is provisional; known foreign ownership requires confirmed force. Ownership does not expire automatically when a client disconnects.

Use small non-overlapping client ID blocks to reduce requests and support offline creation. If allocation is unavailable or a block is exhausted, permit provisional numeric IDs. Reconcile in bounded batches: automatically confirm compatible changes and preserve conflicting local results for user resolution. Require confirmation before renumbering; update known structural references such as blockers consistently, but do not silently rewrite arbitrary text, external links or branch names.

Retries and recovery after lost replies, interrupted synchronization or local write failure must not create another task or repeat an applied operation. Allocation idempotency alone is not whole-task-creation idempotency. Detect editor/older-client changes during reconciliation without claiming knowledge of other disconnected clients' work.

## Configure and operate the origin

Store the shared project binding and published address in project configuration distributed through Git. Permit local per-project address overrides and explicitly selected network profiles for loopback, LAN and Internet addresses. Keep credentials outside Git and logs; verify project identity independently of its URL. Separate bind and published addresses. Use authenticated remote connections protected by HTTPS; HTTP is acceptable for loopback.

Planned `outask origin up/down/status` commands configure the service and invoke standard Linux systemd commands. `up` checks installed Outask, the separate server package, runtime prerequisites and project access; offers explicit installation when needed; registers the project; asks which address to publish; and starts the service. It does not commit or push the configuration or configure DNS/NAT. `down` warns about every affected registered project before stopping the shared service and preserves registrations. `status` reports the service and selected project's connectivity. Planned `outask origin sync` reconciles pending work.

Run Outask Server as a Linux system component under a configured unprivileged account with project access. Use `systemctl start/stop/restart/status outask-server.service` and `journalctl -u outask-server.service`. Keep the process and its service state outside project directories. Installation and service actions use normal system authorization; clients on macOS/Windows may connect remotely but do not install or start this server.

## Outask Server boundary and handoff

One server coordinates multiple registered projects. Installed Outask and accessible server-side project checkouts are prerequisites; use Outask operations to read and validate tasks rather than implementing independent task-storage rules. Missing Outask prevents startup. Require an accessible registered project for initial operation; failure of one project does not disable the others.

The server keeps a current minimal registry: task UUIDs, occupied numeric IDs across all statuses, current status/ownership/revision, allocation counters and limited retry/client state. Retain a minimal identity/occupied-ID record for completed or archived tasks. Do not keep full task content, task-version history or an unbounded operation history. Bound messages, batches and waits; permit a current snapshot when incremental state is no longer available. Discarding retry history must not make an old request execute again.

Move the coordinator by stopping the old server, preparing an agreed current Git state in a checkout on the new host, rebuilding its registry through Outask, and distributing the changed binding through Git. No SQLite/database transfer or coordinator-generation field is required. Clients reconfirm registration, ownership and ID allocations, preserving pending local work. Previously allocated blocks and ownership are not automatically valid after reconstruction. A binding update does not stop the old process or instantly reach disconnected clients; automatic leader election/failover is outside this contract. The server does not pull, merge, commit or push Git data.

Create these independently verifiable deliverables in the separate server project; allocate identifiers there rather than reserving them here:

1. **Provide online multi-project Work Origin coordination:** project/client registration, bootstrap from local project data, atomic numeric allocation, ownership/status/revision checks, explicit force confirmation, safe retries and authenticated project isolation. Verify real concurrent HTTP clients, all statuses and lost replies. Supply an independent test client; completion must not depend on Outask task 24.
2. **Reconcile offline work and rebuild coordination from Git:** ID blocks, bounded reconciliation, conflicts, retry-state cleanup and reconstruction without database transfer. Depend on the online server deliverable; verify two disconnected clients and a new empty coordinator. This supplies Outask task 25's external prerequisite.
3. **Package and operate Outask Server as a Linux system service:** separate package, dependency checks, systemd/journald, service directories, multi-project registration and remote-deployment instructions. Depend on the online server deliverable; verify actual Linux service lifecycle, project failures and alternate endpoints. This supplies Outask task 26's external prerequisite.

Link actual server project/task references in the consuming Outask tasks once those records exist. Server acceptance must be executable independently to avoid a circular client/server dependency. Do not create tasks in the other project under Outask planning authorization.

## Outask delivery ownership

| Task | Result | Local prerequisite |
| --- | --- | --- |
| 24 — Coordinate online task operations through Work Origin | Unique creation and protected online ownership/changes through core, standalone, CLI and MCP | Planning task 9 and unrelated backlog |
| 25 — Continue task work offline and reconcile pending changes | Continued offline work and explicit reconciliation/recovery | 24 |
| 26 — Configure Work Origin connections and manage the Linux server service | Shared/local connection settings and systemd wrappers | 24 |
| 27 — Integrate Work Origin checks with existing Git hooks | Publication checks with worktree-aware integration | 25 |

Tasks 24–26 also require the corresponding delivered server capabilities above; real-server verification cannot be replaced by fixtures. Recheck the [release gate](releases.md#work-origin-scheduling) and unrelated backlog before starting implementation.

Extend existing `outask hook --install/--remove`, preserving user checks and correct worktree selection. Keep current working-tree validation before commit; before push inspect the outgoing task revision, not just working files. Block known conflicts unless explicitly confirmed, but do not block ordinary offline commit/push merely for unavailable connectivity or pending operations. Warn about reconciliation. Hooks do not silently synchronize, renumber, edit, stage, commit or publish. Server-side Git enforcement is not required.
