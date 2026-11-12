# Outask

Outask is a lightweight task tracker that keeps tasks in readable JSON alongside your project code. Use its CLI from your terminal, or connect local AI agents through the optional MCP adapter.

## Install

Requires Node.js 22.23.3 or later and npm on PATH.

```sh
npm install -g outask
outask --version
```

## CLI quick start

Run from your project directory. Replace `1` with the ID returned by `create`.

```sh
outask create --title "Write release notes"
outask list
outask get 1
outask update 1 --title "Review release notes"
outask transition 1 --status done
```

See the [operator reference](https://github.com/henryh/outask/blob/main/app/README.md) for project selection, task fields and configured statuses.

## Connect MCP

Configure your MCP client to run `outask mcp`. Tool calls select your repository with an absolute `project_path`. See [MCP setup](https://github.com/henryh/outask/blob/main/app/mcp/README.md) for client configuration.

## Update or remove

```sh
outask self update --check
outask self update
npm uninstall -g outask
```

`--check` queries the configured npm registry: exit 0 means current/newer, 10 means an update is available, 2 means an unsupported installation context, and 1 means failure. Application and project files retain their contents; npm may write cache/logs. Updates use npm from the running Node.js installation with this global installation's prefix, registry and user permissions. You can also run `npm update -g outask` directly. Follow the printed guidance for local project dependencies and npx invocations. Restart existing MCP sessions to load an updated version.

Uninstall removes the npm package and its commands; project tasks, skills, configuration and cache remain. See [installation and updates](https://github.com/henryh/outask/blob/main/app/README.md#installation-and-updates) for lifecycle details.
