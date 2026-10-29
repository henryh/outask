export function approvedNotes(version, { checksums = false } = {}) {
  return `## Downloads

- [Linux x64](https://github.com/owner/project/releases/download/v${version}/Outask-${version}-linux-x64.tar.gz)
- [macOS Apple silicon](https://github.com/owner/project/releases/download/v${version}/Outask-${version}-macos-arm64.tar.gz)
- [Windows x64](https://github.com/owner/project/releases/download/v${version}/Outask-${version}-windows-x64.tar.gz)
${checksums ? `- [SHA256SUMS](https://github.com/owner/project/releases/download/v${version}/SHA256SUMS)\n` : ''}
## Current version

Outask ${version} keeps task work clear and local.

## What's new

- Added a user-visible capability.

## Install

Requires Node.js 22.23.3 or later on PATH.

Download and extract the archive, open that directory in a terminal and run:

Linux:

\`\`\`sh
./install.sh
\`\`\`

macOS:

\`\`\`sh
./Install.command
\`\`\`

Windows:

\`\`\`text
./Install.cmd  # PowerShell
Install.cmd   & rem cmd.exe
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

export const openingSentence = 'Outask is a lightweight task tracker for personal projects and your AI harness.';

export function conciseNotes(version) {
  return `${openingSentence}\n\n${approvedNotes(version).replace(/## Current version\n[\s\S]*?(?=## What's new)/, '')}`;
}
