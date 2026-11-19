# Install Outask

Use Node.js 22.23.3 or later on PATH. Choose the npm package, a platform archive, or a source checkout.

## npm

Install the [Outask npm package](https://www.npmjs.com/package/outask) using the [npm instructions](npm.md#install).

## Platform archive

Get the archive for your platform from [GitHub Releases](https://github.com/henryh/outask/releases), or use a local copy. [Verify the checksum](releases.md#verify-a-download) with the matching `SHA256SUMS` when available. Extract the archive and run the installer from the extracted `Outask` directory.

| Platform | Installer |
| --- | --- |
| Linux x64 | `./install.sh` |
| macOS Apple silicon | Open `Install.command` in Finder or run `./Install.command` |
| Windows x64 | `./Install.cmd` in PowerShell or `Install.cmd` in cmd.exe |

A local archive includes the application dependencies. It installs offline when the required Node.js runtime is already on PATH. The bundled `Outask/README.md` contains installation and MCP instructions for that release.

## Source checkout

```sh
git clone https://github.com/henryh/outask.git
cd outask
npm ci --prefix app --omit=dev
node app/scripts/install-cli.mjs install
```

Keep the checkout. To remove this installation, run `node app/scripts/install-cli.mjs uninstall` from its root.

## Verify and connect

Open a new terminal and run `outask --version`. See [MCP setup](../app/mcp/README.md) for agent connections and [installation and updates](../app/README.md#installation-and-updates) for PATH, macOS verification, updates and removal.
