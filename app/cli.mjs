import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fail } from './src/errors.mjs';
import { selectProject } from './src/projects.mjs';
import { parseProject, projectHelp } from './scripts/arguments.mjs';
import { reportError } from './scripts/output.mjs';
import * as list from './scripts/list-tasks.mjs';
import * as search from './scripts/search-tasks.mjs';
import * as get from './scripts/get-task.mjs';
import * as getMany from './scripts/get-tasks.mjs';
import * as deps from './scripts/inspect-blockers.mjs';
import * as validate from './scripts/validate-task-stores.mjs';
import * as create from './scripts/create-task.mjs';
import * as update from './scripts/update-task.mjs';
import * as hook from './scripts/hook.mjs';
import * as schema from './scripts/schema.mjs';
import { lifecycleCommand } from './scripts/lifecycle.mjs';
import { distributionVersion } from './src/version.mjs';

const commands = {
  list, search, get, 'get-many': getMany, deps, validate, create, update, hook, schema,
  transition: lifecycleCommand(false),
};
const version = distributionVersion(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version);
const commandGuide = `  list       List tasks
  search     Search task content
  get        Read one task
  get-many   Read several tasks
  deps       Inspect task blockers
  validate   Validate task stores
  schema     Inspect or save the task schema
  create     Create a task
  update     Update a task
  transition Change a task's status
  hook       Install or remove pre-commit validation
  mcp        Start the MCP adapter`;
const guide = `Usage: tasks <command> [options]

${commandGuide}

Task commands use the current project directory by default.
Command options: tasks <command> --help. Full guide: tasks --help.
Installed version: tasks --version.
`;
const selectionHelp = `Select one project with a positional path, --project-path <path>, or --project <name>.
With no selector, use the current working directory. Selectors cannot be combined.
  --config <path>      Program config; overrides TASK_TRACKER_CONFIG, then XDG_CONFIG_HOME
                      (default: ~/.config/task-tracker/config.json). Paths bypass name mappings.
  --schema-path <file> Project-relative task schema; distinct from registry --config.
Names resolve immediate projects_root children and explicit projects mappings;
conflicting locations fail. No parent search or automatic worktree selection.
`;
const help = `Outask AI manages project tasks stored as JSON alongside your code.

Usage: tasks <command> [options]

${commandGuide}

Tips:
  Run commands from your project directory, or use --project-path <directory>.
  Start with tasks create --title "Your task", then tasks list.
  Use tasks <command> --help for options and examples.

Installed version: tasks --version (or -v).
Repository and documentation: https://github.com/henryh/outask
`;

export async function main(args) {
  try {
    const [name, ...rest] = args;
    if (['--version', '-v'].includes(name)) {
      if (rest.length) fail('INVALID_INPUT', 'tasks --version accepts no arguments');
      process.stdout.write(`${version}\n`);
      return;
    }
    if (name === undefined) {
      process.stdout.write(guide);
      return;
    }
    if (['--help', '-h', 'help'].includes(name)) {
      if (rest.length) fail('INVALID_INPUT', 'use tasks <command> --help');
      process.stdout.write(help);
      return;
    }
    if (name === 'mcp') {
      if (rest.length === 1 && ['--help', '-h'].includes(rest[0])) {
        process.stdout.write('Usage: tasks mcp\nStart the local stdio adapter; select the project in each tool call.\nPublished releases include the adapter and its dependencies.\nConfigure the client with command node and arguments <absolute app/bin/tasks path>, mcp.\nSetup and tool contract: https://github.com/henryh/outask/blob/main/app/mcp/README.md\n');
        return;
      }
      if (rest.length) fail('INVALID_INPUT', 'tasks mcp accepts no options; select the project in each tool call');
      const [major, minor, patch] = process.versions.node.split('.').map(Number);
      if (major < 22 || (major === 22 && (minor < 23 || (minor === 23 && patch < 3)))) {
        fail('INCOMPATIBLE_RUNTIME', 'MCP requires Node.js >=22.23.3');
      }
      let adapter;
      try { adapter = await import('./mcp/server.mjs'); }
      catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        fail('ADAPTER_NOT_INSTALLED', 'install the optional MCP dependencies with npm ci --prefix <checkout>/app/mcp --omit=dev; see app/mcp/README.md');
      }
      await adapter.main();
      return;
    }
    if (name === 'http') {
      try { commands.http = await import('./http.mjs'); }
      catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        fail('ADAPTER_NOT_INSTALLED', 'HTTP release integration is unfinished; use a source checkout');
      }
    }
    if (!Object.hasOwn(commands, name)) fail('INVALID_INPUT', `unknown command ${name}; use tasks --help`);
    const command = commands[name];
    const usage = command.usage.replace(/node app\/(?:scripts\/)?[^ ]+/, `tasks ${name}`);
    const { values, positionals, tokens } = parseArgs({ args: rest, allowPositionals: true, tokens: true, options: {
      ...command.options, project: { type: 'string' }, 'project-path': { type: 'string' }, config: { type: 'string' },
    } });
    for (const option of ['project', 'project-path', 'config', 'schema-path']) {
      if (tokens.filter((token) => token.kind === 'option' && token.name === option).length > 1) {
        fail('INVALID_INPUT', `--${option} may be supplied only once`);
      }
    }
    if (values.help) {
      process.stdout.write(command.help.replace(command.usage, usage).replace(projectHelp, selectionHelp)
        .replace('Use list-tasks.mjs and get-task.mjs', 'Use tasks list and tasks get'));
      return;
    }
    const withId = !['list', 'get-many', 'validate', 'create', 'hook', 'http', 'schema'].includes(name);
    const selected = parseProject(positionals, usage, withId);
    const hasPath = positionals.length > (withId ? 1 : 0);
    if (Number(hasPath) + Number(values.project !== undefined) + Number(values['project-path'] !== undefined) > 1) {
      fail('INVALID_INPUT', 'select exactly one project: positional path, --project-path or --project');
    }
    if (values['project-path'] === '' || values.config === '' || values['schema-path'] === '') fail('INVALID_INPUT', 'paths must not be empty');
    const project = selectProject({ name: values.project, path: values['project-path'] ?? selected.project, config: values.config });
    const forwarded = [];
    for (const token of tokens) {
      if (token.kind !== 'option' || ['project', 'project-path', 'config'].includes(token.name)) continue;
      forwarded.push(token.value === undefined ? token.rawName : `--${token.name}=${token.value}`);
    }
    try {
      await command.main([project, ...(withId ? [selected.id] : []), ...forwarded],
        { args: rest, tokens, invocation: ['tasks', name], config: values.config });
    } catch (error) {
      if (error.message === command.usage) error.message = usage;
      throw error;
    }
  } catch (error) {
    reportError(error);
  }
}
