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

Use title `Outask v<distribution-version>` to opt into release. A separately
requested standalone release uses `release-<distribution-version>`; `release-*`
branches are always checked as release candidates. Other task titles do not publish.
Package `1.1.0` maps to tag `v1.1`, title `Outask v1.1` and
`Outask-1.1-<target>.tar.gz`; nonzero patches stay complete. Prerelease suffixes
remain and produce GitHub prereleases. Existing releases stay unchanged.

Each platform build produces one Outask archive. Release names, assets, notes validation and recovery use the same naming contract. Release publication accepts only the repository owner's merge commit of the approved PR head; squash/rebase merges and changed notes are rejected. The current approver lookup supports personally owned repositories; organisation ownership requires an explicit approver implementation. Follow [task delivery](contributing.md#task-delivery) for candidate review, approval and integration.

## Exact notes

Start with the opening sentence of `README.md`, unchanged and without a heading. Do not add a `Current version` heading or repeat the release title. Then use these five `##` headings once each in order:

1. `Downloads`: only direct archive links for Linux x64, macOS Apple silicon and Windows x64. Auxiliary files such as `SHA256SUMS` remain available under GitHub Assets; do not duplicate their links in the description.
2. `What's new`: a few short bullets describing changes a user can notice or act on since the latest published release. Explain the result for the user; keep internal implementation, CI, tests and publication mechanics in the PR. Link to the installation/update guide for upgrade or migration requirements instead of repeating procedures in the description.
3. `Install`: Node.js 22.23.3 or later on PATH; extract and open the Outask
   directory in a terminal. Show `./install.sh` for Linux, `./Install.command`
   for macOS and one Windows block with `./Install.cmd  # PowerShell` and
   `Install.cmd   & rem cmd.exe`.
   Do not include extraction commands, `cd` or platform placeholders. Keep upgrade, migration and session-management procedures, Node-provider choices and incidental platform setup advice in the installation/update guide. Do not repeat them in release descriptions.
4. `Run`: create and list from a project directory; open a new terminal after install.
5. `Documentation`: Basic use, Full operator reference and MCP setup links.

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
name/notes and publishes. Stable publication explicitly sets GitHub Latest and
checks the latest-release API; prereleases explicitly leave Latest unchanged.
It never creates source/task commits or pushes branches.
Failed required checks stop tagging/publication.

Six downloaded-archive jobs verify the published assets on the three platforms
with both Node versions. Treat these as read-only delivery verification; failures
do not authorise replacing published contents.
## npm publication

Build the npm tarball through the same payload preparation as archives with `node app/scripts/release.mjs --npm`. Native CI accepts the packed package with `node scripts/ci.mjs npm`; the release archive workflow retains the accepted tarball as the `npm-package` Actions artifact. The four GitHub release assets remain the three platform archives and `SHA256SUMS`.

The npm publisher requires `OUTASK_NPM_OWNER` to identify a package maintainer and OIDC trust for `.github/workflows/release.yml`. It publishes only the accepted artifact from the approved revision. Existing versions must match accepted bytes, and prereleases must not replace `latest`. An absent package reports `WAITING`; the workflow does not create its initial registry entry automatically. This is not completed public-registry acceptance.

Verify the public package read-only with `node scripts/ci.mjs npm-downloaded`. Packed lifecycle checks exercise updates through a controlled local registry; public download checks require an existing published version. Required archive publication and download checks still apply.

## Verify a download

Download your platform's archive and `SHA256SUMS` from the same release into one directory. Before extracting, open that directory in a terminal and run the matching command below (these examples use v1.5.1). A matching file reports `OK`; altered bytes or a missing checksum fail. SHA-256 checksums verify file integrity; they are not a signature of origin.

Linux:

```sh
sha256sum --ignore-missing --strict -c SHA256SUMS
```

macOS:

```sh
shasum -a 256 --ignore-missing --strict -c SHA256SUMS
```

Windows PowerShell:

```powershell
$archive = 'Outask-1.5.1-windows-x64.tar.gz'
$entries = @(Get-Content .\SHA256SUMS -ErrorAction Stop | Where-Object { $_ -cmatch ('^[0-9a-f]{64}  ' + [regex]::Escape($archive) + '$') })
if ($entries.Count -ne 1) { throw 'Missing or duplicate checksum entry' }
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive -ErrorAction Stop).Hash.ToLowerInvariant()
if ($actual -cne $entries[0].Substring(0, 64)) { throw 'Checksum mismatch' }
Write-Output "Checksum OK: $archive"
```

## Release recovery

Recovery is selected by a corrective draft PR titled `Publish approved release #<merged-release-PR> from run #<Release-run-ID>`. It recovers the approved version; merging the corrective PR creates no new release.

The recovery gate validates the repository owner, original owner-merged PR, matching Release run/revision, approved notes, six merged-main checks and three native archive builds. The corrective PR must pass its six regular CI jobs. Recovery checks out the original approved merge and uses corrected publisher code with that run's archives; it does not rebuild archives or create/move tags. Expired artifacts or mismatched digests/notes stop recovery.

Recovery requires the retained native-build artifacts: rebuilding can change bytes that must not replace an existing draft asset. Draft releases are inspected through the release-by-ID API; the release-by-tag API does not retrieve drafts.

The publisher generates `SHA256SUMS` from the three final accepted archives, in Linux/macOS/Windows order, with lowercase SHA-256, two spaces and the exact filename per line. It uploads this fourth asset without rebuilding archives. All local archives are required for checksum generation, including partial `TARGETS` uploads. Publication requires all four matching uploaded assets. Download acceptance verifies the checksum file and the selected archive before installation. The checksum requirement is independent of links or wording in the release description: v1.5.1 introduced this asset contract, and subsequent releases retain it. Historical recovery preserves the original approved notes and asset contract; earlier releases are not retrofitted. Follow the [platform verification commands](#verify-a-download) before installing a manual download. Checksums verify integrity, not a signature of origin.

The existing tag must be annotated at the approved merge. Title/notes must match;
no unexpected assets are allowed. Selected existing assets must match verified
local size/SHA256/state. Upload only missing assets without `--clobber`. Publication
or read-only success requires all required matching local/remote archives, including
when `TARGETS` selects fewer. An identical published release is a read-only success;
never rewrite/delete mismatched published contents.
