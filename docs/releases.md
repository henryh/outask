# Release delivery

User-visible changes include a stable release by default. Only an owner's explicit
`RELEASE_DEFERRED` decision accumulates changes without publication; internal work
records `NO_RELEASE` with a reason. The owner's merge approves the exact candidate;
Actions tags, publishes and verifies it under the [delivery sequence](contributing.md#task-delivery).

## Prepare the candidate

Keep implementation, documentation, candidate task closure and release in the
same task PR. Include all still-unreleased user-visible changes since the latest
published tag. Use the next minor version by default, or a major for large/breaking
changes. Stable requests require a version without a prerelease suffix and notes
covering RC changes/corrections too; a rehearsal does not complete a stable release.

Commit these together:

- `app/package.json`: advancing three-component SemVer.
- `app/package-lock.json`: matching top-level/root-package versions.
- `docs/release-notes.md`: exact final UTF-8 notes with a final newline.

Use title `Outask AI v<distribution-version>` to opt into release. A separately
requested standalone release uses `release-<distribution-version>`; `release-*`
branches are always checked as release candidates. Other task titles do not publish.
Package `1.1.0` maps to tag `v1.1`, title `Outask AI v1.1` and
`OutaskAI-1.1-<target>.tar.gz`; nonzero patches stay complete. Prerelease suffixes
remain and produce GitHub prereleases. Existing releases stay unchanged.

Before final publication, complete all planned work, review/QA/documentation and
candidate closure. Declare publication/download acceptance as read-only post-merge
checks; resolve other unavailable acceptance with the owner. A preliminary draft
PR for hosted Actions requires explicit owner permission. Fix unexpected failures
in the same task/PR before readiness; no planned follow-up implementation or closure.

Fetch/merge current `origin/main` locally and verify before any PR. Present exact
commits, push/draft-PR actions, CI/ready transition, version/scope and notes in one
approval request. Changed candidates/subsequent pushes need renewed agreement.
Only the owner merges the whole approved revision using **Create a merge commit**.
Forks, other mergers, wrong revisions, squash/rebase or changed notes are rejected.
Publication currently supports personally owned repositories; organisation
ownership needs a separately defined release approver.

## Exact notes

Use these six `##` headings once each in order, without a repeated release title:

1. `Downloads`: direct links for Linux x64, macOS Apple silicon and Windows x64.
2. `Current version`: short product overview.
3. `What's new`: user-visible release changes, including new commands/options.
4. `Install`: Node.js 22.23.3 or later on PATH; extract and open the OutaskAI
   directory in a terminal. Show `./install.sh` for Linux, `./Install.command`
   for macOS and one Windows block with `./Install.cmd  # PowerShell` and
   `Install.cmd   & rem cmd.exe`.
   Do not include extraction commands, `cd` or platform placeholders.
5. `Run`: create and list from a project directory; open a new terminal after install.
6. `Documentation`: Basic use, Full operator reference and MCP setup links.

Use the actual repository, approved compact tag and archive names. CD validates
and publishes the committed file without rewriting it. Recovery preserves the
approved installer commands from the original release. Generated archive README
and installer help contain commands/defaults only for their destination platform.

## Check before merge and publish after merge

Release PR CI validates version/lockfile/notes and runs six native CI jobs. The
shared `release-archives.yml` builds one archive per platform and accepts each
with Node.js 22.23.3 and 24 before uploading Actions artifacts. Archive/download
acceptance uses `node scripts/ci.mjs archive` / `downloaded`; Windows uses native
PowerShell/system tar. Ordinary/new-release PR checks create no tags or releases.

After owner merge, `Release` verifies the owner, two-parent merge of the exact PR
head and exact notes, then reruns merged-main CI and the shared native archive
workflow at that merge. Only the publisher has `contents: write`: it creates the
annotated main tag, stages all three verified archives in a draft with exact
name/notes and publishes. It never creates source/task commits or pushes branches.
Failed required checks stop tagging/publication.

Six downloaded-archive jobs verify the published assets on the three platforms
with both Node versions. Treat these as read-only delivery verification; failures
do not authorise replacing published contents. After all destination/task/release
checks pass, synchronise the clean checkout under [contributor delivery](contributing.md#task-delivery).
No additional publication approval or release/closure PR is needed.

## Retry and private rehearsal

For a publisher code fix, the owner explicitly requests real Actions recovery in
the same corrective draft PR using title
`Publish approved release #<merged-release-PR> from run #<Release-run-ID>`.
It recovers that approved version; merging the corrective PR creates no new release.

The request PR and its trigger/rerun must belong to the owner in the same personally
owned repository. Actions verifies the original owner-merged PR, matching Release
run/revision, approval, six merged-main checks and three native archive builds.
The corrective PR must first pass its six regular CI jobs. Recovery checks out
the original approved merge and uses corrected publisher code with that run's
archives; it does not rebuild archives or create/move tags. Expired artifacts or
mismatched digests/notes stop recovery. Keep the PR draft until publication and all
six downloaded checks pass, then finish acceptance and green CI on final closure.

Use **Re-run failed jobs** to retain successful native-build artifacts. Rebuilding
may change bytes that cannot replace an existing draft asset. If artifacts expire,
stop and resolve the incomplete draft with the owner. Inspect drafts through the
release API URL returned by `gh release view`, which identifies the release by ID;
the release-by-tag API cannot retrieve drafts.

The existing tag must be annotated at the approved merge. Title/notes must match;
no unexpected assets are allowed. Selected existing assets must match verified
local size/SHA256/state. Upload only missing assets without `--clobber`. Publication
or read-only success requires all three matching local/remote archives, including
when `TARGETS` selects fewer. An identical published release is a read-only success;
never rewrite/delete mismatched published contents.

An agreed private test version still requires real owner merge/tag/run/release
and six downloaded checks. It authorises neither a stable release nor task-store
migration/reset. Local gate/upload tests do not prove GitHub publication.
