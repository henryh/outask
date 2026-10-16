# Outask AI product direction

Outask AI keeps tasks with code in readable, repository-local JSON. It is a
small utility for code projects, usable directly by developers or through local
AI agents. A project defines its task fields and workflow; the tracker enforces
data integrity without owning planning decisions or Git delivery.

## Philosophy and layers

1. Data remains readable and editable without the tracker or AI.
2. Standalone/core operations implement storage and validation.
3. The CLI exposes those operations to people and scripts.
4. Optional MCP and read-only HTTP adapters consume the same operations.

Lower layers remain independently useful. Web panels and graphical clients are
separate consumer projects. There is no central authoritative database, remote
sync service, automatic Git operation or cross-project dependency engine.

## Supported behaviour

The CLI and local stdio MCP adapter provide task creation, projected/paginated
lists and details, bounded content search, partial updates, lifecycle changes,
local blocker inspection, schema inspection and validation. Project selection
uses the current directory, explicit paths or configured names. Installation
supports Linux x64, macOS Apple silicon and native Windows x64 with Node.js
22.23.3 or later. The HTTP adapter is available from a source checkout and is
outside packaged CLI/MCP release acceptance; see [its guide](../app/HTTP.md).

The universal record minimum is `id`, `title` and `status`. Standard creation
also supplies priority and blockers; projects can declare stricter fields and
statuses. Preserve existing records, IDs and unknown fields without bulk rewrites.
Blockers affect eligibility only while the referenced local ID remains in Active.
External references and hierarchy fields remain informational.

Writes validate before persistence and coordinate cooperating local processes.
Manual edits remain supported; validation refreshes service metadata and recovers
interrupted lifecycle moves. Local locks do not coordinate separate Git branches
or arbitrary editors. Git integration conflicts require explicit resolution.

See the [operator reference](../app/README.md) for implemented commands,
[shared contract](contract.md) for data and operation details, and
[contributor task workflow](task-management.md) for repository delivery.
