# Contributor setup and PR delivery

The repository owner is the sole administrator and merge operator. Contributors
with repository access push task branches and submit pull requests only after
explicit agreement for those remote actions; contributors
without write access use fork PRs when the repository permits forks. These instructions do not
enable branch protection, rulesets or change the account tier. The owner can merge
without a second GitHub reviewer, but must record independent feature review and
QA evidence and wait for passing PR CI.

## Fresh clone

Use Node.js 22.23.3 or later, npm, Make, Git, a POSIX shell and tar. From the
repository root, explicitly install the local push guard and run checks:

```bash
make install-push-guard
make ci
```

Installation copies `scripts/pre-push.sh` into this checkout's `.git/hooks/pre-push`
with executable permissions. It does not change local or global Git configuration,
touch `pre-commit`, or install anything in other clones. Repeat installation for
each fresh clone. Repeating it with an identical hook is safe and restores its
executable permissions. To update an older copy, inspect it, remove that copy and
install again; installation never replaces a different existing hook.

Any push targeting `refs/heads/main` is rejected, including normal updates, forced
updates, deletion and a main update within a multi-ref push. The guard permits
task-branch pushes, but that does not provide user authorisation. The check follows
the destination ref, so `HEAD:main` is also rejected.
It applies to every remote. This is a local accident safeguard: `git push
--no-verify`, removing or disabling the hook can bypass it, and unconfigured clones
remain unguarded. Bypassing the guard does not authorise a direct main push.

If a `pre-push` hook already exists, installation leaves it intact and exits with
a diagnostic. Custom `core.hooksPath`, shared worktree locations and symlinked hook
directories also require manual integration. Keep the existing checks and have
your hook manager invoke `sh scripts/pre-push.sh` from the checkout root with the
original Git pre-push input. If other checks consume stdin, capture that input once
and replay the same input to each check; stop on any failing check. Do not simply
append the guard after a check that consumes stdin or exits. For a shared hook
manager, apply this guard only to this repository. The existing `tasks hook
--install` validation uses `pre-commit` independently and remains unchanged.

## Task delivery

1. Create `task-<id>-<slug>` from the current `main`. PM moves the task to
   `in_progress` through the task interface, validates and commits the stores and
   refreshed `tasks/.task-tracker.json` together on that branch.
2. Implement the task, complete independent feature review, QA and documentation,
   fetch the current `main` and merge `origin/main` into the task branch locally.
   Resolve conflicts locally, inspect the combined changes and run `make ci` on
   that result. Complete any affected review/QA gates again. Commit the verified
   candidate. Apply the release value gate before final publication: by default,
   include a stable version, matching lockfile and current release notes in this
   task PR when release value exists. Only an explicit deferral accumulates those
   changes; internal maintenance records `NO_RELEASE`.
3. PM records acceptance evidence, sets `completed_at` and moves the task to
   `done` on the same task branch. Run `tasks validate` and commit the changed
   stores together with `tasks/.task-tracker.json` before the final push.
   Present the branch, commits and exact proposed push/PR actions, CI monitoring
   and ready transition in one explicit approval request. Include release
   version/scope and exact notes when applicable. After approval, push only the
   task branch and open a draft PR
   targeting `main`, or provide the prepared commands and PR text for the owner
   to perform these actions manually. Keep its description short: the problem, resulting
   behaviour and brief verification. Put details in the task record and commits,
   following the [PR description rules](../AGENTS.md#git-delivery-and-service-state).
   The approved sequence covers the complete candidate's draft PR and its ready
   transition after hosted gates pass, without another prompt. Do not defer known
   implementation, acceptance or closure work to that PR. Changed candidates and
   subsequent pushes require renewed remote-action agreement.
4. Wait for all six PR CI jobs on the final commit containing implementation and
   task closure: Linux x64, native macOS arm64 and native Windows x64, each with
   Node.js 22.23.3 and 24. CI installs locked dependencies and audits them; Linux
   runs core/MCP tests, and all three platforms check a native installed distribution.
   A release candidate also requires all three native release-archive jobs, each
   testing the actual candidate archive with both Node versions.
   If rework is required, PM returns the task to `review` and removes
   `completed_at` in this branch. Correct failures, repeat affected gates, close
   the task again and validate/commit stores before the next final push.
   Present the PR as ready only after CI passes on the resulting final commit.
   If `main` advances, fetch and merge it locally again, resolve conflicts there
   and repeat affected verification before proposing the updated push for
   agreement. Do not
   use GitHub's conflict editor. The same rule applies to release PRs.
5. Hand the ready PR to the owner, who approves it by using GitHub's
   **Create a merge commit**, or `gh pr merge <number> --merge`. The owner's merge
   also approves the release version/scope/exact notes in a release PR. Do not
   squash or
   rebase, perform a local delivery merge, or push `main`.
6. Monitor Actions after the owner's merge. The server verifies merged `main`
   and, for a release PR, builds/tests the archives, creates the approved main tag,
   publishes exact notes/assets and runs all six downloaded-archive checks.
   Verify the destination and closed task record and the applicable release
   results read-only; reuse unchanged evidence where valid. Do not request more
   publication approvals or create a follow-up release/closure PR. A failed gate
   stops completion. An explicitly deferred ordinary PR leaves its changes
   unreleased; internal maintenance remains `NO_RELEASE`.
7. After successful delivery verification, automatically return the clean local
   checkout to `main` and fast-forward from `origin/main`. Confirm local `HEAD`
   equals `origin/main` and the worktree is clean. Preserve dirty files and
   local/ahead/diverged commits as required by the
   [completion safety rules](../AGENTS.md#git-delivery-and-service-state);
   do not reset, stash, discard work or delete the task branch automatically.

Locally, after step 6 passes and the checkout is safe to synchronise:

```bash
git fetch origin
git switch main
git merge --ff-only origin/main
```

Status on `main` is authoritative for delivered completion. `done` on an unmerged
task branch records candidate acceptance; the task remains open on `main` until
the PR is merged. Implementation and closure use one PR, without a separate
closure branch or PR.

Only the owner performs remote merges. An agent prepares task branches
locally and performs pushes or PR creation only after explicit agreement for those
actions. Task or merge approval alone does not provide that agreement. If the
owner chooses manual publication, hand over the verified candidate, commands and
PR text and wait for the owner's result. Hand off the ready task PR and wait for the owner's merge.
For a standalone release, prepare `release-<version>` with the package version,
matching lockfile and exact `docs/release-notes.md`. The default combined
task/release PR includes those files together with implementation and task
closure. Its exact title `Outask AI v<distribution-version>` opts into release.
PR CI validates release inputs and checks the actual three archives through the
same shared workflow used after merge. The owner's merge approves version/scope
and notes and starts automated publication; chat messages and other
contributors' merges do not publish. Verify publication and downloaded archives
read-only after merge, under the explicitly declared task acceptance boundary.
No further implementation, release or closure PR is needed for combined delivery.
Do not tag/upload manually. For a failed publisher fix, the owner may explicitly
request [CI recovery](releases.md#retry-and-private-rehearsal) of the original
approved release in the corrective draft PR before merge. Its merge creates no
new release. See [release delivery](releases.md).
Internal repository maintenance has no product release value.

## Native distribution acceptance

`make test-distribution` selects the current supported host: Linux x64 or native
macOS arm64. The macOS jobs use GitHub's standard Apple Silicon `macos-15`
[runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
The checks require matching Node/OS architecture and archive metadata, and print
JSON evidence with OS and Node versions, artifact version/target and SHA256.
They cover clean installation, dependency diagnostics, CLI/MCP shared storage and
validation, download removal, update and uninstall with preserved user data.
Temporary artifacts and fixtures are removed after each check.

For owner-run native acceptance, install the dependencies with
`make ci-dependencies`, then run `make test-distribution` on Apple Silicon with
Node.js 22.23.3 and 24 in turn. Record the successful output with the current task.
Configured jobs and cross-built archives alone do not establish macOS acceptance;
observed native results are required.

## Focused push-guard checks

```bash
node --test app/tests/push-guard.test.mjs
```

These tests install the actual hook into disposable repositories and exercise real
Git pushes to a local bare remote. They also verify existing-hook preservation and
coexistence with the task-validation pre-commit hook. Temporary repositories are
removed automatically. The standard `make test` and PR CI discover this test file.

### Native Windows distribution checks

Windows PR CI uses `windows-2025` x64 with Node.js 22.23.3 and Node.js 24.
From a native Windows checkout, run `node scripts/ci.mjs dependencies`,
`node --test app/tests/project-lock.test.mjs app/tests/windows-install.test.mjs`
and `node scripts/ci.mjs distribution`. These need Node.js/npm and Windows tar;
Make and WSL are unnecessary for this route. The full general core/MCP suite
continues to run on Linux; POSIX-only installer/hook fixtures are not Windows
acceptance checks. The native Windows job exercises the built archive using the
documented PowerShell and cmd.exe installation/launch instructions and packaged
MCP definition. It reports OS, architecture, Node and archive versions; checks
Unicode, spaces, write locking/termination, persistent user PATH and update/
uninstall data preservation; and restores the original user's registry PATH
value and type even if a check fails. These native checks establish Windows
acceptance; cross-built archives prove composition only.
