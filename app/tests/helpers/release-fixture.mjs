export function approvedNotes(version) {
  return `## Downloads

- [Linux x64](https://github.com/owner/project/releases/download/v${version}/OutaskAI-${version}-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/owner/project/releases/download/v${version}/OutaskAI-${version}-macos-arm64.tar.gz)
- [Windows x64](https://github.com/owner/project/releases/download/v${version}/OutaskAI-${version}-windows-x64.tar.gz)

## Current version

Outask AI ${version} keeps task work clear and local.

## What's new

- Added a user-visible capability.

## Install

Requires Node.js 22.23.3 or later on PATH.

Download and extract the archive, open that directory in a terminal and run:

\`\`\`sh
./install.sh
\`\`\`

Windows:

\`\`\`text
./install.cmd  # PowerShell
install.cmd   & rem cmd.exe
\`\`\`

## Run

From a project directory:

\`\`\`sh
tasks create --title "Write release notes"
tasks list --format table
\`\`\`

## Documentation

- [Basic use](https://github.com/owner/project/blob/v${version}/README.md#basic-use)
- [Full operator reference](https://github.com/owner/project/blob/v${version}/app/README.md)
- [MCP setup](https://github.com/owner/project/blob/v${version}/app/mcp/README.md)
`;
}
