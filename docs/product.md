# Outask

Outask keeps project tasks in readable, repository-local JSON. Developers
and local AI agents use the same operations; each project owns its fields,
workflow and planning decisions.

## Layers

1. Core/standalone operations own storage and validation.
2. The CLI exposes those operations to people and scripts.
3. Optional local stdio MCP and read-only HTTP adapters reuse the core.

JSON remains usable without the tracker or AI. There is no authoritative remote
database, automatic Git operation or cross-project dependency engine. Web panels
and graphical clients are separate consumers.

## Supported scope

CLI/MCP provide task creation, bounded lists/details/search, partial updates,
lifecycle changes, local blockers, schema operations and validation. Published
archives support Linux x64, macOS Apple silicon and Windows x64 with Node.js
22.23.3 or later. HTTP is source-only and outside packaged CLI/MCP acceptance.

Projects retain their records, IDs and extension fields. Writes validate and
coordinate local tracker processes; manual JSON editing remains supported.
See [installation and use](../README.md), the [shared contract](contract.md)
and this repository's [contributor workflow](task-management.md).
