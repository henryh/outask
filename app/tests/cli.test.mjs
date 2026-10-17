import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { distributionVersion } from '../src/version.mjs';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fixture, run, snapshot, task, writeStore } from './fixtures.mjs';
import { selectProject } from '../src/projects.mjs';

const entry = fileURLToPath(new URL('../bin/tasks', import.meta.url));
const installer = fileURLToPath(new URL('../scripts/install-cli.mjs', import.meta.url));
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const cliVersion = distributionVersion(version);
function execute(command, args, extra = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, ...extra });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}
function cli(args, extra) { return execute(process.execPath, [entry, ...args], extra); }
function success(result) { assert.equal(result.status, 0, result.stderr); return result; }
function error(result, code) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`^${code}:`));
}
function config(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return path;
}

test('top-level version options report the distribution version without preparing a project', (t) => {
  const root = fixture(t, []);
  const empty = join(root, 'empty');
  mkdirSync(empty);
  for (const option of ['--version', '-v']) {
    const result = success(cli([option], { cwd: empty }));
    assert.equal(result.stdout, `${cliVersion}\n`);
    assert.equal(result.stderr, '');
    assert.deepEqual(readdirSync(empty), []);
  }
  error(cli(['--version', 'extra'], { cwd: empty }), 'INVALID_INPUT');
  assert.deepEqual(readdirSync(empty), []);
});

test('bare invocation gives a brief command guide without preparing a project and retains explicit full help', (t) => {
  const root = fixture(t, []);
  const empty = join(root, 'empty');
  mkdirSync(empty);
  const options = { cwd: empty, env: { ...process.env, HOME: empty, TASK_TRACKER_CONFIG: join(empty, 'absent-config.json') } };
  const result = success(cli([], options));
  assert.equal(result.stderr, '');
  const names = [...result.stdout.matchAll(/^  ([\w-]+)\s+\S.+$/gm)].map((match) => match[1]);
  assert.deepEqual(names.sort(), ['list', 'search', 'get', 'get-many', 'deps', 'validate', 'schema', 'create', 'update', 'transition', 'hook', 'mcp'].sort());
  assert.match(result.stdout, /project directory/);
  assert.match(result.stdout, /tasks <command> --help/);
  assert.match(result.stdout, /tasks --help/);
  assert.match(result.stdout, /tasks --version/);
  assert.doesNotMatch(result.stdout, /Exit [01]|TASK_TRACKER_CONFIG|task-schema\.json|project instructions/);
  const full = success(cli(['--help'], options));
  assert.equal(full.stderr, '');
  assert.match(full.stdout, /Outask AI manages project tasks stored as JSON/);
  assert.match(full.stdout, /https:\/\/github\.com\/henryh\/outask/);
  assert.match(full.stdout, /tasks create --title/);
  assert.match(full.stdout, /--project-path <directory>/);
  assert.doesNotMatch(full.stdout, /Exit [01]|TASK_TRACKER_CONFIG|task-schema\.json|project instructions/);
  for (const alias of ['-h', 'help']) assert.equal(success(cli([alias], options)).stdout, full.stdout);
  assert.match(success(cli(['list', '--help'], options)).stdout, /Usage: tasks list/);
  assert.deepEqual(readdirSync(empty), []);
});

test('installed task-data reads expose the aligned --no-cache option', (t) => {
  const root = fixture(t, [task(2, { blockers: [1], scope: 'JSON needle' }), task(1)], {
    stores: { 'active.json': { statuses: ['pending'] }, 'done.json': { statuses: ['done'] } },
    search: { mode: 'indexed' },
  });
  const blocked = join(root, 'not-a-cache-directory');
  writeFileSync(blocked, 'cache unavailable');
  const extra = { cwd: root, env: { ...process.env, XDG_CACHE_HOME: blocked } };
  for (const args of [
    ['list', '--no-cache', '--format', 'json'], ['list', '--no-cache', '--count'],
    ['get', '2', '--no-cache', '--format', 'json'],
    ['get-many', '--id', '2', '--no-cache', '--format', 'json'],
    ['search', 'needle', '--no-cache', '--format', 'json'],
    ['deps', '2', '--no-cache', '--format', 'json'],
  ]) {
    const result = success(cli(args, extra));
    assert.doesNotMatch(result.stderr, /CACHE_|SQLite/);
  }
});

test('installed symlink works outside checkout, matches scripts, updates and uninstalls without changing tasks', (t) => {
  const project = fixture(t);
  const elsewhere = fixture(t, []);
  const bin = join(elsewhere, 'bin');
  const env = { ...process.env, HOME: elsewhere, SHELL: '/bin/bash', PATH: `${bin}:${dirname(process.execPath)}` };
  const install = (action) => execute(process.execPath, [installer, action, '--bin-dir', bin], { env, cwd: elsewhere });
  const before = snapshot(project);
  success(install('install'));
  const link = join(bin, 'tasks');
  assert.equal(realpathSync(link), entry);
  const profile = join(elsewhere, '.bashrc');
  const originalProfile = readFileSync(profile, 'utf8');
  success(install('install'));
  assert.equal(readFileSync(profile, 'utf8'), originalProfile);
  success(execute('/bin/bash', ['-c', '. "$1"; tasks --version', 'bash', profile], {
    env: { ...env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
  }));
  // A second symlink verifies resolution through more than one link.
  const outer = join(elsewhere, 'tasks-link');
  symlinkSync(link, outer);
  for (const [command, script, tail] of [
    ['list', 'list-tasks', ['--status', 'pending', '--sort', 'priority', '--offset', '2', '--limit', '3', '--fields', 'id,title']],
    ['list', 'list-tasks', ['--store', 'all', '--count']],
    ['get', 'get-task', ['99', '--group', 'Done', '--fields', 'id,title,status']],
    ['get-many', 'get-tasks', ['--id', '3', '--id', '99', '--store', 'all', '--fields', 'id,title,status']],
    ['deps', 'inspect-blockers', ['1', '--depth', '2']],
  ]) {
    const actual = success(execute(outer, [command, '--project-path', project, ...tail, '--format', 'json'], { cwd: elsewhere, env }));
    const expected = success(run(script, [project, ...tail, '--format', 'json'], { cwd: elsewhere }));
    assert.equal(actual.stdout, expected.stdout);
  }
  assert.deepEqual(snapshot(project), before);
  const first = success(execute(link, ['list', project, '--limit', '2', '--format', 'ids'], { cwd: elsewhere, env }));
  const continuation = first.stderr.match(/Next page: (.+)/)[1];
  assert.match(continuation, /^tasks list /);
  const next = success(execute('/bin/sh', ['-c', continuation], { cwd: elsewhere, env }));
  assert.equal(next.stdout, '3 4\n');
  const validated = JSON.parse(success(execute(link, ['validate', project, '--format', 'json'], { cwd: elsewhere, env })).stdout);
  assert.equal(validated.refreshed, true);
  const state = snapshot(project);
  for (const [file, bytes] of Object.entries(before)) if (file !== '.task-tracker.json') assert.deepEqual(state[file], bytes);
  assert.deepEqual(Object.keys(state), Object.keys(before).sort());
  const unchanged = JSON.parse(success(run('validate-task-stores', [project, '--format', 'json'])).stdout);
  assert.equal(unchanged.refreshed, false);
  success(install('install'));
  success(install('uninstall'));
  assert.equal(existsSync(link), false);
  assert.deepEqual(snapshot(project), state);
  success(run('get-task', [project, '1', '--fields', 'id']));
});

test('installed list guidance preserves original selectors, query arguments and shell quoting', (t) => {
  const needle = "quoted ' $(touch injected) `touch other`";
  const project = fixture(t, Array.from({ length: 12 }, (_, index) => task(index + 1, { note: needle })));
  const bin = join(project, 'bin');
  const env = { ...process.env, HOME: project, SHELL: '/bin/bash', PATH: `${bin}:${dirname(process.execPath)}` };
  success(execute(process.execPath, [installer, 'install', '--bin-dir', bin], { cwd: project, env }));
  const first = success(execute('tasks', ['list'], { cwd: project, env }));
  assert.equal(first.stderr, 'Showing records 1-10 of 12 matches.\nNext page: tasks list --offset 10\n');
  const follow = (result) => success(execute('/bin/sh', ['-c', result.stderr.match(/Next page: (.+)/)[1]], { cwd: project, env }));
  assert.match(follow(first).stderr, /^Showing records 11-12 of 12 matches/);
  const path = "selected ' $(touch path-injected)";
  symlinkSync(project, join(project, path));
  const registry = 'registry file.json';
  config(join(project, registry), { projects: { named: project } });
  const flags = ['--store', 'active', '--store=done', '--where', `note=${needle}`, '--where=status=pending',
    '--id=1', '--id', '2', '--id=3', '--sort', 'id', '--desc', '--fields', 'id,title,note',
    '--format', 'ids', '--limit', '1', '--offset=0', '--offset', '0'];
  for (const selector of [[path], ['--project-path', path], ['--project=named', '--config', registry], ['--', path]]) {
    const result = success(execute('tasks', ['list', ...flags, ...selector], { cwd: project, env }));
    assert.equal(result.stdout, '3\n');
    const command = result.stderr.match(/Next page: (.+)/)[1];
    assert.match(command, /^tasks list --offset 1 /);
    assert.equal((command.match(/--offset/g) ?? []).length, 1);
    assert.ok(!command.includes(project));
    for (const argument of ['--store=done', '--where=status=pending', '--id=1', '--id 2', '--id=3', '--fields id,title,note', '--sort id --desc']) {
      assert.ok(command.includes(argument), command);
    }
    if (selector[0] === '--project-path') assert.match(command, /--project-path '/);
    if (selector[0] === '--project=named') assert.match(command, /--project=named --config 'registry file.json'/);
    if (selector[0] === '--') assert.match(command, / -- 'selected /);
    assert.equal(follow(result).stdout, '2\n');
  }
  for (const name of ['injected', 'other', 'path-injected']) assert.equal(existsSync(join(project, name)), false);
});

test('public usage diagnostics name each CLI command while standalone scripts retain their usage', (t) => {
  const project = fixture(t);
  for (const command of ['list', 'search', 'get', 'get-many', 'deps', 'validate', 'create', 'update', 'transition', 'hook', 'http']) {
    const result = cli([command, 'extra', 'extra', 'extra'], { cwd: project });
    error(result, 'INVALID_INPUT');
    assert.match(result.stderr, new RegExp(`tasks ${command} `));
    assert.doesNotMatch(result.stderr, /node app\//);
  }
  for (const [command, script, args] of [['hook', 'hook', []], ['validate', 'validate-task-stores', ['--format', 'invalid']]]) {
    const result = cli([command, ...args], { cwd: project });
    error(result, 'INVALID_INPUT');
    assert.match(result.stderr, new RegExp(`Usage: tasks ${command} `));
    assert.doesNotMatch(result.stderr, /node app\//);
    assert.match(run(script, args, { cwd: project }).stderr, new RegExp(`Usage: node app/scripts/${script}.mjs`));
  }
});

test('installed and standalone lists offer compact tables and explicit complete-record views', (t) => {
  const description = 'Long description across the complete record. '.repeat(20);
  const project = fixture(t, [task(1, { description, scope: description, extension: { retained: true } }), task(2, { description })]);
  const bin = join(project, 'bin');
  const env = { ...process.env, HOME: project, SHELL: '/bin/bash', PATH: `${bin}:${dirname(process.execPath)}` };
  success(execute(process.execPath, [installer, 'install', '--bin-dir', bin], { cwd: project, env }));
  const runners = [
    (args) => execute('tasks', ['list', ...args], { cwd: project, env }),
    (args) => run('list-tasks', args, { cwd: project, env }),
  ];
  for (const list of runners) {
    const compact = success(list([]));
    assert.match(compact.stdout, /^id\s+title\s+status\n1\s+Task 1\s+pending\n/);
    assert.doesNotMatch(compact.stdout, /description|scope|extension|Long description/);
    const full = success(list(['--full', '--limit', '1']));
    assert.ok(full.stdout.includes(`description: ${description}\n`));
    assert.ok(full.stdout.includes(`scope: ${description}\n`));
    assert.match(full.stdout, /extension: \{"retained":true\}/);
    const command = full.stderr.match(/Next page: (.+)/)[1];
    assert.match(command, /--full --limit 1/);
    const next = success(execute('/bin/sh', ['-c', command], { cwd: project, env }));
    assert.match(next.stdout, /^id: 2\n/);
    assert.ok(next.stdout.includes(`description: ${description}\n`));
    const explicit = success(list(['--full', '--limit', '1', '--format', 'text']));
    assert.equal(explicit.stdout, full.stdout);
    assert.match(explicit.stderr, /Next page: .*--full --limit 1 --format text/);
    const table = success(list(['--full', '--format', 'table']));
    assert.match(table.stdout, /^id\s+title\s+status\s+description\s+scope\s+extension\n/);
    assert.ok(table.stdout.includes('…'));
    assert.match(table.stderr, /^Showing records 1-2 of 2 matches/);
    const json = success(list(['--full', '--format', 'json']));
    assert.deepEqual(JSON.parse(json.stdout).tasks[0], task(1, { description, scope: description, extension: { retained: true } }));
    assert.equal(json.stderr, '');
    assert.equal(success(list(['--full', '--count'])).stdout, '2\n');
    assert.equal(success(list(['--fields', 'id,description', '--format', 'text', '--limit', '1'])).stdout, `id: 1\ndescription: ${description}\n`);
    for (const args of [['--full', '--fields', 'all'], ['--full', '--format', 'ids']]) {
      const result = list(args);
      error(result, 'INVALID_INPUT');
      assert.match(result.stderr, /--full/);
    }
    const help = success(list(['--help'])).stdout;
    assert.match(help, /--full/);
    assert.match(help, /table \(default\)/);
  }
});

test('installer refuses unrelated target, dangling links and PATH commands', (t) => {
  const root = fixture(t, []);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const target = join(bin, 'tasks');
  writeFileSync(target, 'unrelated\n');
  for (const action of ['install', 'uninstall']) {
    error(execute(process.execPath, [installer, action, '--bin-dir', bin]), 'COMMAND_EXISTS');
    assert.equal(readFileSync(target, 'utf8'), 'unrelated\n');
  }
  const dangling = join(root, 'dangling');
  mkdirSync(dangling);
  symlinkSync(join(root, 'absent'), join(dangling, 'tasks'));
  error(execute(process.execPath, [installer, 'install', '--bin-dir', dangling]), 'COMMAND_EXISTS');
  chmodSync(target, 0o755);
  const destination = join(root, 'destination');
  error(execute(process.execPath, [installer, 'install', '--bin-dir', destination], {
    env: { ...process.env, PATH: bin },
  }), 'COMMAND_EXISTS');
  assert.equal(existsSync(destination), false);
});

test('development installer recognises a managed release command on PATH', (t) => {
  const root = fixture(t, []);
  const release = join(root, '.local', 'share', 'task-tracker', 'releases', 'task-tracker-1.0.0-linux-x64');
  const releaseBin = join(release, 'app/bin');
  mkdirSync(releaseBin, { recursive: true });
  writeFileSync(join(release, 'app/package.json'), JSON.stringify({ name: 'task-tracker-local' }));
  writeFileSync(join(release, 'release.json'), JSON.stringify({ version: '1.0.0', target: 'linux-x64' }));
  writeFileSync(join(releaseBin, 'tasks'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const pathBin = join(root, 'release-bin');
  mkdirSync(pathBin);
  symlinkSync(join(releaseBin, 'tasks'), join(pathBin, 'tasks'));
  const destination = join(root, 'development-bin');
  success(execute(process.execPath, [installer, 'install', '--bin-dir', destination], {
    env: { ...process.env, HOME: root, SHELL: '/bin/bash', PATH: pathBin },
  }));
  assert.equal(realpathSync(join(destination, 'tasks')), entry);
});

test('development installer rejects a release lookalike outside its managed location', (t) => {
  const root = fixture(t, []);
  const lookalike = join(root, 'other', 'task-tracker-1.0.0-linux-x64');
  const lookalikeBin = join(lookalike, 'app/bin');
  mkdirSync(lookalikeBin, { recursive: true });
  writeFileSync(join(lookalike, 'app/package.json'), JSON.stringify({ name: 'task-tracker-local' }));
  writeFileSync(join(lookalike, 'release.json'), JSON.stringify({ version: '1.0.0', target: 'linux-x64' }));
  writeFileSync(join(lookalikeBin, 'tasks'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const pathBin = join(root, 'lookalike-bin');
  mkdirSync(pathBin);
  symlinkSync(join(lookalikeBin, 'tasks'), join(pathBin, 'tasks'));
  error(execute(process.execPath, [installer, 'install', '--bin-dir', join(root, 'development-bin')], {
    env: { ...process.env, HOME: root, PATH: pathBin },
  }), 'COMMAND_EXISTS');
});

test('name configuration precedence, immediate children, mapping collisions and explicit paths', (t) => {
  const root = fixture(t, []);
  const first = fixture(t, [task(1)]);
  const second = fixture(t, [task(2)]);
  const projects = join(root, 'projects');
  mkdirSync(projects);
  symlinkSync(first, join(projects, 'hyphen-name'));
  const xdg = join(root, 'xdg');
  const normal = config(join(xdg, 'task-tracker/config.json'), { projects_root: projects });
  const override = config(join(root, 'override.json'), { projects: { 'hyphen-name': second } });
  const env = { ...process.env, XDG_CONFIG_HOME: xdg, TASK_TRACKER_CONFIG: undefined };
  assert.equal(selectProject({ name: 'hyphen-name' }, env), first);
  assert.equal(selectProject({ name: 'hyphen-name' }, { ...env, TASK_TRACKER_CONFIG: override }), second);
  assert.equal(selectProject({ name: 'hyphen-name', config: normal }, { ...env, TASK_TRACKER_CONFIG: override }), first);
  success(cli(['get', '1', '--project', 'hyphen-name', '--fields', 'id'], { env, cwd: root }));
  config(normal, { projects_root: projects, projects: { 'hyphen-name': second } });
  error(cli(['list', '--project', 'hyphen-name'], { env }), 'AMBIGUOUS_PROJECT');
  config(normal, { projects_root: projects, projects: { 'hyphen-name': first } });
  assert.equal(selectProject({ name: 'hyphen-name' }, env), first);
  writeFileSync(normal, '{broken');
  success(cli(['list', '--project-path', first], { env }));
  success(cli(['list'], { env, cwd: first }));
  error(cli(['list', '--project', 'hyphen-name'], { env }), 'INVALID_JSON');
  error(cli(['list', first, '--project', 'hyphen-name'], { env }), 'INVALID_INPUT');
  error(cli(['list', '--project', 'a', '--project', 'b'], { env }), 'INVALID_INPUT');
  error(cli(['get', '1', '--project-path', first, '--project', 'hyphen-name'], { env }), 'INVALID_INPUT');
  error(cli(['list', '--project', '../hyphen-name'], { env }), 'INVALID_INPUT');
  config(normal, { projects: { external: first } });
  assert.equal(selectProject({ name: 'external' }, env), first);
  error(cli(['list', '--project', 'unknown'], { env }), 'PROJECT_NOT_FOUND');
  error(cli(['list', '--project-path', join(root, 'absent')], { env }), 'PROJECT_NOT_FOUND');
});

test('CLI preserves compact defaults, exact filters, human help and error streams', (t) => {
  const project = fixture(t, [task(1, { status: 'in_progress', priority: 'low' }), task(2, { priority: 'high' }), task(3)]);
  const mcpHelp = success(cli(['mcp', '--help'])).stdout;
  assert.match(mcpHelp, /Published releases include the adapter and its dependencies/);
  assert.match(mcpHelp, /command node and arguments <absolute app\/bin\/tasks path>, mcp/);
  assert.doesNotMatch(mcpHelp, /npm ci|checkout|\/home\/you/);
  const defaults = JSON.parse(success(cli(['list', project, '--format=json'])).stdout);
  assert.deepEqual(defaults.fields, ['id', 'title', 'status']);
  assert.equal(defaults.limit, 10);
  assert.equal(success(cli(['list', project, '--status=progress', '--count'])).stdout, '0\n');
  assert.equal(success(cli(['list', project, '--sort', 'priority', '--format', 'ids'])).stdout, '2 3 1\n');
  assert.equal(success(cli(['list', project, '--where=title=-leading', '--count'])).stdout, '0\n');
  for (const command of ['list', 'get', 'get-many', 'deps', 'validate']) {
    const help = success(cli([command, '--help'])).stdout;
    assert.match(help, new RegExp(`Usage: tasks ${command}`));
    assert.match(help, /--project-path/);
  }
  error(cli(['get', project, '123', '--format', 'json']), 'TASK_NOT_FOUND');
  error(cli(['list', project, '--limit', '0', '--format', 'json']), 'INVALID_INPUT');
  error(cli(['create', project]), 'INVALID_INPUT');
  writeStore(project, 'active.json', [task(1, { blockers: [2] }), task(2, { blockers: [1] })]);
  const cycle = JSON.parse(success(cli(['deps', project, '1', '--depth', '4', '--format', 'json'])).stdout);
  assert.equal(cycle.graph.cycleStatus, 'found');
  assert.equal(cycle.eligible, false);
  error(cli(['validate', project, '--format', 'json']), 'INVALID_STORE');
});
