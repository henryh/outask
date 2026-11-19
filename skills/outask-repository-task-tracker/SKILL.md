---
name: outask-repository-task-tracker
description: Turn work requests, plans, and technical specifications into tracked tasks. Use when the user asks to create a task, break work into tasks, set up or use a task tracker, check task status, or start or resume a task.
---

# Plan to Tasks

Follow the current repository's instructions for task ownership and workflow. Route task management through its designated role when it has one.

## Require Outask

Before investigating or planning the requested work, look for connected Outask MCP tools and verify access to the current repository with a small task read. Use the discovered tool schemas and [Outask MCP documentation](https://github.com/henryh/outask/blob/main/app/mcp/README.md) for operational details. Offline, use locally available Outask documentation and tool schemas.

If Outask is unavailable, restrict your actions and response to setup. Offer to install it using the [installation guide](https://github.com/henryh/outask/blob/main/docs/install.md) or connect an existing installation using the MCP documentation. With the user's authorization, follow those instructions. For a user-supplied Outask archive or local path, use the bundled instructions, including offline. Resume task work after a successful MCP task read.

## Respond to the request

- **Implement one result.** An actionable request such as “Fix sorting” authorizes recording the work and starting it. Find or create the task, briefly confirm its ID and title, then record the start and begin implementation in the same turn when eligible. Respect the current task, blockers, and project approval gates.
- **Implement several results.** Split the request only where each result can be accepted independently. Save the missing tasks and their dependencies. If the user or project selected a task to start, start it when eligible. Otherwise reply with only the saved or reused IDs and titles, plus an optional one-line next-task suggestion.
- **Save a task or plan.** Record the requested work and confirm its IDs and titles. Start a saved task only when the request also calls for implementation.
- **Resume a task.** Use its existing ID and verify eligibility before recording the start and continuing.
- **Discuss, check status, or suggest next work.** Answer within the requested read-only scope.

## Record the outcome and follow the project

Match the requested result against existing and relevant historical tasks before creating anything. Use bounded reads, inspect the effective schema before writing, and reuse matching IDs and project-owned fields. Ask a focused question only when an unresolved choice materially changes the requested result or scope.

Write each title and description around the problem, the result the user needs, and how to verify it. Base acceptance on agreed requirements and established project behavior. Include agreed delivery constraints and dependencies. Omit the choice of task tracker from task records. Keep implementation, review, testing and delivery together when they serve the same result. Once started, advance the same task through the repository's workflow and pause at its approval boundaries.
