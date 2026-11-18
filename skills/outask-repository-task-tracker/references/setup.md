# Set up Outask with Codex CLI on Linux

Use Codex CLI with local stdio MCP and Node.js 22.23.3 or later on PATH.
Install the official npm distribution from a terminal:

```sh
node --version
npm install -g outask
outask --version
codex mcp add outask -- outask mcp
codex mcp list
```

Follow the same commands when the user has authorized setup and the client
allows local installation and registration. Check for an existing working
Outask registration first. If commands require the user's terminal or
approval, provide the applicable commands. Linux x64 users can also download
the official archive and checksum, verify the download, extract it, and run
`./install.sh` from the extracted `Outask` directory. [Outask installation](https://github.com/henryh/outask#install-the-cli)

If Codex can load local stdio MCP but registration via the CLI is unavailable,
add the following entry to `~/.codex/config.toml` (or `config.toml` in the
configured Codex home). Preserve the other entries and update the existing
`outask` entry if present.

```toml
[mcp_servers.outask]
command = "outask"
args = ["mcp"]
```

If startup fails, use `command -v node` and `command -v outask` from the terminal
that launches Codex. If the Linux archive install is missing from PATH, run
`export PATH="$HOME/.local/bin:$PATH"`. For npm, add the bin directory of the
prefix reported by `npm prefix -g` with
`export PATH="$(npm prefix -g)/bin:$PATH"`. Check both commands again and restart
Codex from that terminal. If the client cannot run local stdio MCP, use a local
Codex CLI session.

Launch a new session from the target repository. Check `/mcp` in interactive
Codex, then ask it to list Active Outask tasks with `id,title,status` and limit
10. Apply the project selection rule from [the skill](../SKILL.md). A successful
task read verifies the connection. [Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
