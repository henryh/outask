# Publish Outask to npm

The repository owner performs account setup and the first npm publication personally. Subsequent releases use trusted publishing from the owner-approved Release workflow. Keep passwords, tokens, recovery codes and one-time codes out of chat, task records and Git.

## Prepare the owner account

1. Create or sign in to your account at [npm](https://www.npmjs.com/), verify the email address and enable two-factor authentication. See [npm's public package guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).
2. In your own terminal, sign in and confirm the account. Complete browser and authentication prompts yourself:

   ```sh
   npm login --registry=https://registry.npmjs.org
   npm whoami --registry=https://registry.npmjs.org
   npm view outask name versions maintainers --json --registry=https://registry.npmjs.org
   ```

3. Confirm `outask` is available or that the listed maintainers include your intended owner account. A registry `E404` means no public package was found; npm can still reject a name at publication. Stop if another account owns it. Agree a replacement name before changing the package, commands in guides or publication configuration. Do not publish a placeholder to reserve the name.

## Publish the first approved package

Wait for the approved task PR's owner merge and successful Release checks. Download the `npm-package` artifact from that exact Release run into a new directory. Confirm the run uses the approved merge revision; use its accepted tarball rather than rebuilding a package locally. The first run reports that owner publication is required when the registry package does not exist.

In a terminal opened in the downloaded artifact directory, substitute the approved full package version for `1.6.0` below. Inspect the dry-run file list and package name/version before running the second command:

```sh
npm publish ./outask-1.6.0.tgz --dry-run --access public --registry=https://registry.npmjs.org
npm publish ./outask-1.6.0.tgz --access public --tag latest --registry=https://registry.npmjs.org
npm view outask@1.6.0 version dist.integrity maintainers --json --registry=https://registry.npmjs.org
```

Complete npm's authentication prompts personally. Report only the account name, public package/version URL and outcome. Never republish or replace an existing version. If npm rejects the publication, preserve the error without credentials and resolve it before continuing.

From a checkout of the approved merge, run `node scripts/ci.mjs npm-downloaded` to verify the exact public package's global installation/removal, a sample CLI create/list and a fresh MCP connection in isolation. An unpublished package reports `WAITING`, which does not complete acceptance. The first package has no older public npm version: record that limitation explicitly and agree its acceptance treatment before publication. Automated checks exercise native npm updating through a controlled local registry; they do not establish an update from an older public release.

## Enable subsequent Actions publication

Use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with npm CLI 11.5.1 or later. In the owned package's Settings, add a GitHub Actions trusted publisher for owner `henryh`, repository `outask` and workflow filename `release.yml`. Match any configured environment to the workflow exactly; do not add an environment name unless the job uses it. Permit direct `npm publish` for this publisher. No npm token is required in repository secrets.

Set the repository Actions variable `OUTASK_NPM_OWNER` to the confirmed npm account name; the publication helper checks that this account is a package maintainer. Create the publisher when the next approved release is ready: an unvalidated configuration expires if its first successful trusted publication does not occur within two days. Configure package publishing access to require two-factor authentication and disallow tokens. Check the repository and workflow fields carefully; saving the configuration does not validate a publication.

The Release workflow must publish the already accepted npm artifact only after the approved revision's required gates pass. Existing identical versions are read-only verification; conflicting versions stop publication. Stable versions use `latest`; prereleases must use a separate tag. Keep the existing owner-merge process and [release delivery rules](releases.md).
