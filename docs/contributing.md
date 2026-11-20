# Contributor setup and PR delivery

The repository owner alone administers and merges. Contributors push task branches
and open PRs only after explicit agreement. Without write access, use a fork PR
if forks are permitted. These rules do not enable repository protections or
change account tiers; independent review/QA and passing CI are still required.

## Fresh clone

Use Node.js 22.23.3 or later, npm, Git, Make and a POSIX shell. Native packaging also requires tar.

```sh
make install-push-guard
make ci-dependencies
make test-feature
```

Install the guard explicitly in every clone. It installs only this checkout's
`.git/hooks/pre-push`, preserves other hooks/configuration, and safely repeats
when identical. Inspect/remove an older guard before reinstalling; a different
hook is never replaced. The guard blocks destination `refs/heads/main` for all
remotes. Bypassing it does not authorise a main push.

For existing hooks, custom `core.hooksPath`, shared worktree locations or symlinked
hook directories, preserve existing checks and integrate the guard manually.
Invoke `sh scripts/pre-push.sh` from this repository with the original pre-push
input. If another check consumes stdin, capture it once and replay it to every
check, stopping on failure; do not append after a consuming check or an exit.
Apply shared hook-manager integration only to this repository. The task-validation
pre-commit hook is independent.

## Task delivery

### Stage 1 feature acceptance

1. Create `task-<id>-<slug>` from current `main`. PM starts the task and commits validated stores and service metadata under [task management](task-management.md). Implement the feature and its user documentation on the local branch. Use the normal entry point from the source checkout.
2. Conduct independent feature review against the agreed requirements, then run the affected acceptance scenarios and regression tests from source. Use `make test-feature` (`node scripts/ci.mjs test-feature`) for the source core and MCP suites. Use narrower Node test files when they cover the affected contract or suit the available host. Version changes, release notes, platform packaging configuration, artifact builds, native installer acceptance and GitHub delivery belong to stage 2.
3. Show the owner what changed, how to try it from source and what passed. Ask whether the owner wants to test manually and record the decision. If they do, wait for the result and address findings before proceeding. Move to stage 2 once the owner accepts the feature and agrees to delivery. For an agreed local-only result, record the acceptance and stop here.

### Stage 2 delivery

1. Confirm the [release scope](releases.md#prepare-the-candidate). Prepare the version and exact notes when releasing. For an ordinary PR, follow the existing release decision rules at the current version. Fetch and merge current `origin/main` locally and resolve conflicts there. Repeat integration if main advances.
2. Independently review the combined delivery candidate, including packaging, affected platform contracts and release metadata where applicable. Run `make ci` and affected delivery gates. If integration or delivery work changes feature behavior, repeat the affected stage 1 review and tests, including the owner's acceptance of that change. Verify available native hosts locally and use required hosted CI for other platforms. Owner-run native checks are required only when acceptance names a scenario that hosted CI cannot cover.
3. PM records acceptance, sets `completed_at`, closes the candidate task and runs
   task validation. Commit stores and `tasks/.task-tracker.json` with the complete
   implementation before requesting the final push. Do not defer known work to
   another PR. Declare real publication/download acceptance as read-only post-merge
   checks; resolve other unavailable acceptance with the owner before publication.
4. Present one approval request containing branch, commits, exact push/draft-PR
   actions, CI monitoring and ready transition. Include release version/scope and
   exact notes when applicable. After agreement, push only the task branch and
   open a draft PR to `main`, or hand the owner prepared commands/text for manual
   execution. Describe the problem, resulting behaviour and brief verification.
   Changed candidates and subsequent pushes require renewed agreement.
5. Wait for all required jobs on the final commit: six native PR CI jobs plus,
   for release candidates, three native archive jobs and six native npm artifact
   acceptance jobs. Each platform is checked
   with Node.js 22.23.3 and 24. Failed gates stop readiness. If rework is needed,
   return the task to the affected stage and remove `completed_at`. Fix the issue, repeat affected gates,
   close/validate/commit again and obtain agreement for the new push. If main
   advances, repeat local integration, verification and push agreement. Mark ready
   only after success; the agreed sequence already covers that ready transition.
   Native tests must inspect the selected runtime and archive, not unrelated global
   runner state. A host file or package is a gate only when the tested contract owns it.
6. Hand the ready PR to the owner for **Create a merge commit**, or owner-run
   `gh pr merge <number> --merge`. Never directly push main, rewrite history,
   squash/rebase delivery, perform a local delivery merge or tag/upload manually.
   A release PR's owner merge approves its exact revision/version/scope/notes;
   [Actions owns publication](releases.md#check-before-merge-and-publish-after-merge).
7. Monitor Actions after merge. Verify merged main, closed task and applicable
   release/download results read-only, reusing unchanged evidence. A failed gate
   stops completion. Do not create a follow-up closure/release PR or seek another
   publication approval for the agreed sequence. After successful verification,
   synchronise the clean checkout as below.

```sh
git fetch origin
git switch main
git merge --ff-only origin/main
```

Confirm `HEAD` equals `origin/main` and the worktree is clean. Stop if dirty files
or local/ahead/diverged commits make synchronisation unsafe; do not stash, discard,
reset or rewrite them. Keep the task branch. Starting work, passing checks or
merge approval alone never authorises other remote actions.

## Native distribution acceptance

Use this route in [stage 2](#stage-2-delivery).

Run `make regression` (native Windows: `node scripts/ci.mjs regression`) for full core/MCP and native archive/npm regression, including CLI self updates and non-mutating update checks. Install locked dependencies first. Dedicated self-update tests live in `app/tests/regression/`; ordinary `make test`, `make ci` and distribution smoke omit them. Release archive/download and npm artifact/download acceptance enable the installed self-update scenarios; release archive acceptance also runs the dedicated tests. Existing installer/npm lifecycle smoke remains in ordinary CI.

PR CI covers Linux x64, native macOS arm64 and native Windows x64. Linux runs the
core/MCP suites; all platforms install locked dependencies, audit them and accept
an installed archive with Node.js 22.23.3 and 24. Release jobs accept the actual
archives before publication and downloaded archives afterward.

Run native commands locally only on available hosts. Hosted PR CI supplies the
required evidence for unavailable operating systems; local emulation is not a
substitute. Before push, review affected platform tests for isolation, prior
contracts and assumptions about the host. Keep diagnostics about ambient state
separate from assertions about the selected executable or archive.

On Linux/macOS, with each required Node version:

```sh
make ci-dependencies
make test-distribution
```

On native Windows x64, with each required Node version:

```text
node scripts/ci.mjs dependencies
node --test app/tests/project-lock.test.mjs app/tests/windows-install.test.mjs
node scripts/ci.mjs distribution
```

Make/WSL is unnecessary on Windows; use native Windows tar. Record actual native
results in the task. Archive composition or configured jobs do not prove native
acceptance. CI reports OS/Node/target/version/SHA256 and verifies installation,
CLI/MCP, packaged GitHub Latest update/current/failure paths and uninstall,
including live-session and user-data preservation. Native update acceptance
substitutes GitHub network responses with a local newer archive; installation
and runtime checks use the actual packaged updater.

Native jobs also accept npm global installation, updating, aliases, fresh CLI/MCP and removal with user-data preservation. Release jobs accept the same `npm-package` tarball on all three platforms with both Node versions. `node scripts/ci.mjs npm` builds and accepts a temporary package locally. Its update check uses a controlled local registry; public-registry verification uses `node scripts/ci.mjs npm-downloaded` and explicitly reports `WAITING` when the package has no registry entry. See [npm packaging and publication](releases.md#npm-publication).
