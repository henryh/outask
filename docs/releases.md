# Release delivery

A release candidate contains an advancing application version, matching lockfile
versions and the exact final notes. The owner's merge approves and publishes
that candidate. An ordinary task PR accumulates unreleased changes; it does not
assign a release version or publish. Explicit recovery can finish a previously
approved release through Actions before a corrective PR is merged.

## Prepare the candidate

Prepare the version and all accumulated user-visible changes since the latest
published tag, retaining earlier deferred changes, as part of the final task
candidate. Present version/scope and exact notes in its single publication
approval request. Use the next minor version by default or a major version for
a large/breaking change. An agreed prerelease uses its own test version and does not authorise a stable release.

When the requested outcome is a stable release, finish with a package version
without a prerelease suffix and notes covering all changes since the latest
stable release, including RC changes and later corrections. Rehearsal or recovery
does not complete that outcome. Use the new-release title below so the final
owner merge publishes the stable release automatically.

By default, keep the existing task branch and include implementation,
documentation, candidate task closure and the stable release in the same PR when
release value exists. An explicit owner deferral accumulates changes without
publication; internal maintenance uses `NO_RELEASE`. For a separately requested
standalone release, prepare `release-<distribution-version>` from current `main`.
Do not create another release or closure PR for combined delivery.
Both kinds include:

- `app/package.json`: advancing three-component SemVer.
- `app/package-lock.json`: matching top-level and root-package versions.
- `docs/release-notes.md`: the complete exact description to publish.

Use the exact PR title `Outask AI v<distribution-version>`. That title explicitly
opts a task PR into release. An ordinary task PR without release intent does not
publish. A standalone `release-*` branch is always checked as a release candidate.
Package `1.1.0` becomes tag `v1.1`, title `Outask AI v1.1` and
`OutaskAI-1.1-<target>.tar.gz`; non-zero patches remain complete. Prerelease
suffixes remain, such as `1.1.0-rc.2` becoming `1.1-rc.2`. CD marks these as
GitHub prereleases. Existing releases remain unchanged.

Complete every planned task-owned change, review/QA/documentation gate and
candidate closure before final readiness. If the task includes publication,
its acceptance explicitly declares real publication/downloaded-asset verification
as read-only post-merge delivery checks, not results already observed before
merge. All inputs and checks must be prepared so no further planned file changes
or additional PRs are needed. A preliminary draft PR is allowed to verify hosted
Actions only when the owner explicitly permits it; unexpected failures are
corrected in that same task/PR before final readiness.

Fetch/merge current `origin/main` locally and verify integration. Present the
complete candidate, commits, exact push/PR actions, CI monitoring and ready
transition in one approval request. Include version, user-visible scope and the
exact final description. A changed candidate/subsequent push needs renewed
agreement. The owner reviews the whole revision and merges
with **Create a merge commit**, approving implementation, version/scope and notes
and authorising publication. Other contributors' merges, forks, wrong revisions,
squash/rebase merges or rewritten notes are rejected. The current workflow
supports personally owned repositories; organisation ownership requires a
separately defined release approver.

## Exact notes

Use these six `##` headings once each in order, without repeating the Release title:

1. `Downloads`: direct links for Linux x64, macOS Apple silicon and Windows x64.
2. `Current version`: a short overview of the current product.
3. `What's new`: this release's user-visible changes, including new commands/options.
4. `Install`: Node.js 22.23.3 or later on PATH, extraction into a directory the user
   will keep and opening that directory. Use a Linux/macOS block with `./install.sh` and one Windows block with
   two lines: `./install.cmd  # PowerShell` and `install.cmd   & rem cmd.exe`.
   Do not include extraction commands, `cd` or platform placeholders.
5. `Run`: create and list from a project directory.
6. `Documentation`: links labelled Basic use, Full operator reference and MCP setup.

Use the actual repository, approved compact tag and archive names in links.
Keep the description short. Commit the exact UTF-8 file with a final newline;
CD validates and consumes it without regenerating or editing its contents.

## Check before merge and publish after merge

PR CI validates release intent/version/lockfile/notes and runs the six regular
native CI jobs. Explicit release candidates also call the shared
`release-archives.yml` workflow: one native build per platform, installation and
CLI/MCP acceptance of each actual archive on both Node.js 22.23.3 and 24, then
upload the tested archives as Actions artifacts. Archive and downloaded checks
use the native CI runner (`node scripts/ci.mjs archive` / `downloaded`) and
Windows PowerShell with the system tar, rather than Git Bash tar. Ordinary and
new-release PR checks write no Git tags
or GitHub Releases. The explicit recovery mode below is the only pre-merge
publication path.

After an approved merged-PR closed event, `Release` validates owner, merge commit
and exact notes, reruns merged-main CI and calls the same native archive workflow
at that approved commit. Only the publisher has `contents: write`; it creates the
annotated tag at the approved main merge, stages all three verified archives in
a draft with exact title/notes, then publishes. The bot never creates source/task
commits or pushes branch refs. Failed required checks stop tagging/publication.
Six post-publication jobs download the platform assets and verify installation,
CLI/MCP, shared storage/validation, update/uninstall and user-data preservation.
Those results are read-only delivery verification; do not claim them before they
run. A failure is reported without silently replacing the released contents.
No further release approval prompt is needed for this approved sequence. After
successful destination/task/release/download verification, the agent returns the
clean local checkout to `main` and fast-forwards it from `origin/main`, following
the [completion safety rules](../AGENTS.md#git-delivery-and-service-state).

The flow uses GitHub's
[merged-PR event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
and [same-commit reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

## Retry and private rehearsal

If the publisher itself needs a code fix, test the corrected publication through
Actions in the same corrective draft PR before merging it. The owner explicitly
opts in with the exact title
`Publish approved release #<merged-release-PR> from run #<Release-run-ID>`.
This is recovery of that existing approved version, not a new release candidate.
Merging the corrective PR does not create another release.

Both the requesting PR and its trigger/rerun must belong to the repository owner
in the same personally owned repository. Actions verifies the referenced PR was
owner-merged to `main`, the original `Release` run matches its approved revision,
and its approval, six merged-main checks and three native archive builds passed.
The corrected PR must pass its own six regular CI jobs first. The publisher then
checks out the original approved merge, verifies its existing annotated tag and
exact notes, and uses the corrected publisher with the original run's artifacts.
It does not rebuild archives or create/move tags. Existing asset digest and note
checks still apply. Expired artifacts or mismatches stop recovery.

Recovery really changes the approved draft to published; it is not a dry run.
The same shared `release-downloads.yml` acceptance
workflow then downloads the published assets on all three platforms and both
Node versions. Ordinary titles never enter this path. Keep the corrective PR in
draft until actual publication and downloaded-asset acceptance have passed, then
finish task acceptance and require green CI on the final task-closure commit.

Use **Re-run failed jobs** to reuse successful native-build artifacts. Rerunning
successful builds may produce different bytes, which are refused as replacements.
If artifacts expire, stop and resolve the incomplete draft with the owner.
Draft metadata is read through the release API URL returned by
[`gh release view`](https://cli.github.com/manual/gh_release_view),
which identifies the release by ID; the release-by-tag API cannot retrieve drafts.
The existing tag must be annotated and point to the approved merge. Existing
notes/title must be identical; no unexpected assets are allowed. Selected draft
assets must match verified local size/SHA256/state. Publication or complete
read-only success requires all three matching local and remote archives even
with a partial `TARGETS` selection. Retry uploads missing assets without
`--clobber`. An already published identical release is a read-only success;
mismatched published contents are never rewritten or deleted.

An agreed private test version may be delivered by the combined task/release PR.
Verify its real merge/tag/run/release and all six downloaded-asset jobs read-only
after owner merge, without another implementation/release/closure PR. A rehearsal does not authorise a stable release or task-store migration/reset. Local gate
and upload tests cover skip/block/retry predicates, but do not prove unobserved
GitHub publication. A post-publication failure does not authorise asset rewriting.
