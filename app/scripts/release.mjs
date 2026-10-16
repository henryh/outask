#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, cpSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fail } from '../src/errors.mjs';
import { reportError } from './output.mjs';
import { distributionVersion } from '../src/version.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const appRoot = join(root, 'app');
const targets = new Set(['linux-x64', 'macos-arm64', 'windows-x64']);
const runtimeScripts = [
  'arguments.mjs',
  'create-task.mjs',
  'continuation.mjs',
  'delete-task.mjs',
  'entry.mjs',
  'get-task.mjs',
  'get-tasks.mjs',
  'hook.mjs',
  'inspect-blockers.mjs',
  'lifecycle.mjs',
  'list-tasks.mjs',
  'output.mjs',
  'schema.mjs',
  'search-tasks.mjs',
  'task-write-input.mjs',
  'transition-task.mjs',
  'update-task.mjs',
  'validate-task-stores.mjs',
];

function run(command, args, options = {}) {
  if (process.platform === 'win32' && command === 'npm') {
    args = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args];
    command = process.execPath;
  }
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail('COMMAND_FAILED', `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function parseArgs(args) {
  const values = { targets: [], outDir: join(root, 'dist') };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--help' || name === '-h') {
      process.stdout.write(`Usage: node app/scripts/release.mjs [--target <target>] [--out-dir <directory>]\nTargets: ${[...targets.keys()].join(', ')}. Default: current host target.\n`);
      process.exit(0);
    }
    if (name === '--target') values.targets.push(args[++index]);
    else if (name === '--out-dir') values.outDir = args[++index];
    else fail('INVALID_INPUT', `unknown option ${name}`);
  }
  if (!values.targets.length) values.targets.push(hostTarget());
  if (values.targets.some((target) => !targets.has(target))) {
    fail('INVALID_INPUT', `target must be one of: ${[...targets.keys()].join(', ')}`);
  }
  values.outDir = resolve(values.outDir);
  return values;
}

function hostTarget() {
  const os = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch;
  const target = `${os}-${arch}`;
  if (!targets.has(target)) fail('INVALID_INPUT', `host target ${target} is not supported`);
  return target;
}

function copyApp(destination) {
  mkdirSync(destination, { recursive: true });
  for (const name of ['bin', 'src', 'mcp']) {
    cpSync(join(appRoot, name), join(destination, name), {
      recursive: true,
      filter: (source) => !source.split(sep).includes('tests') && !source.split(sep).includes('node_modules') && !source.endsWith('.md'),
    });
  }
  mkdirSync(join(destination, 'scripts'), { recursive: true });
  for (const name of runtimeScripts) cpSync(join(appRoot, 'scripts', name), join(destination, 'scripts', name));
  for (const name of ['cli.mjs', 'package.json', 'package-lock.json', 'runtime.cjs']) {
    cpSync(join(appRoot, name), join(destination, name));
  }
}

function pruneTests(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (['test', 'tests', '__tests__'].includes(entry.name)) {
        rmSync(child, { recursive: true, force: true });
      } else pruneTests(child);
    } else if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(entry.name) || /\.(?:test|spec)\.ts$/.test(entry.name)) {
      rmSync(child, { force: true });
    }
  }
}

function assertClean(path) {
  const forbiddenDirectories = new Set(['.git', 'references', 'tasks', 'test', 'tests', '__tests__']);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (forbiddenDirectories.has(entry.name)) fail('INVALID_RELEASE', `release includes ${relative(path, child)}`);
      assertClean(child);
    } else if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(entry.name) || /\.(?:test|spec)\.ts$/.test(entry.name)) {
      fail('INVALID_RELEASE', `release includes ${relative(path, child)}`);
    }
  }
}

function cleanNpmEnv(userconfig) {
  const env = { ...process.env, NPM_CONFIG_USERCONFIG: userconfig, npm_config_userconfig: userconfig };
  delete env.NPM_CONFIG_ALLOW_SCRIPTS;
  delete env.npm_config_allow_scripts;
  return env;
}

function writeSupport(releaseRoot, version, target, nodeRange) {
  mkdirSync(join(releaseRoot, 'bin'), { recursive: true });
  // The installed link points directly to the app entry; this entry serves extracted archives.
  writeFileSync(join(releaseRoot, 'bin/tasks'), readFileSync(join(appRoot, 'bin/tasks'), 'utf8').replace('../runtime.cjs', '../app/runtime.cjs').replace('../cli.mjs', '../app/cli.mjs'), { mode: 0o755 });
  cpSync(join(appRoot, 'scripts/install-release.mjs'), join(releaseRoot, 'install.mjs'));
  cpSync(join(appRoot, 'scripts/install-path.mjs'), join(releaseRoot, 'install-path.mjs'));
  cpSync(join(appRoot, 'scripts/install-launcher.mjs'), join(releaseRoot, 'install-launcher.mjs'));
  if (target === 'windows-x64') {
    writeFileSync(join(releaseRoot, 'install.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\nwhere.exe node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo DEPENDENCY_MISSING: install Node.js ${nodeRange} and put node on PATH 1>&2\r\n  exit /b 1\r\n)\r\nnode "%~dp0app\\runtime.cjs"\r\nif errorlevel 1 exit /b 1\r\nnode "%~dp0install.mjs" %*\r\nexit /b %errorlevel%\r\n`);
  }
  writeFileSync(join(releaseRoot, 'release.json'), JSON.stringify({ version, target }) + '\n');
  writeFileSync(join(releaseRoot, 'install.sh'), `#!/bin/sh
set -eu
command -v node >/dev/null 2>&1 || { echo "DEPENDENCY_MISSING: install Node.js ${nodeRange} and put node on PATH" >&2; exit 1; }
command -v dirname >/dev/null 2>&1 || { echo "DEPENDENCY_MISSING: dirname is required" >&2; exit 1; }
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
node "$root/app/runtime.cjs"
exec node "$root/install.mjs" "$@"
`, { mode: 0o755 });
  if (target === 'macos-arm64') {
    // A final status line preserves even newline-only diagnostics from ps.
    const sessionProbe = `expected="$1"
response=$(/bin/ps -p "$expected" -o pid= 2>&1; printf '\\n%s' "$?")
newline='
'
status=\${response##*"$newline"}
output=\${response%"$newline"*}
if [ "$status" = 1 ] && [ -z "$output" ]; then
  printf absent
elif [ "$status" = 0 ]; then
  set -f
  set -- $output
  if [ "$#" = 1 ] && [ "$1" = "$expected" ]; then printf alive; else printf unknown; fi
else
  printf unknown
fi`;
    const closeWindow = `on run arguments
  set installerTTY to item 1 of arguments
  set sessionPID to item 2 of arguments
  set sessionEnded to false
  set query to ${JSON.stringify(sessionProbe)}
  repeat 20 times
    try
      set state to do shell script "/bin/sh -c " & quoted form of query & " probe " & quoted form of sessionPID
    on error
      return
    end try
    if state is "absent" then
      set sessionEnded to true
      exit repeat
    else if state is not "alive" then
      return
    end if
    delay 0.1
  end repeat
  if not sessionEnded then return
  with timeout of 5 seconds
    tell application "Terminal"
      repeat with candidate in windows
        if (count of tabs of candidate) is 1 then
          set installerTab to item 1 of tabs of candidate
          if tty of installerTab is installerTTY then
            if (busy of installerTab) is false then close candidate saving no
            return
          end if
        end if
      end repeat
    end tell
  end timeout
end run`;
    writeFileSync(join(releaseRoot, 'Install.command'), `#!/bin/bash
set -u
PATH="\${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin"
export PATH
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
session_pid=''
session_complete=false
if [ -t 0 ]; then
  current_pid=$$
  session_tty=''
  for ((depth=0; depth<32; depth++)); do
    record="$(ps -p "$current_pid" -o ppid= -o tty=)" || break
    read -r parent_pid process_tty extra <<< "$record"
    case "$parent_pid" in ''|*[!0-9]*) break ;; esac
    [ -n "$process_tty" ] || break
    [ -z "$extra" ] || break
    if [ -z "$session_tty" ]; then
      case "$process_tty" in '?'|'??') break ;; esac
      session_tty="$process_tty"
    fi
    if [ "$process_tty" != "$session_tty" ]; then
      session_complete=true
      break
    fi
    session_pid="$current_pid"
    [ "$parent_pid" -gt 0 ] || break
    current_pid="$parent_pid"
  done
fi
"$root/install.sh" "$@"
status=$?
if [ -t 0 ]; then
  if [ "$status" -eq 0 ]; then
    printf '\nInstallation complete. Press any key to finish.\nIf the window stays open, close it with Cmd+W.\n'
  else
    printf '\nInstallation failed. Review the messages above. Press any key to finish; close this window when ready.\n'
  fi
  pressed=false
  IFS= read -r -s -n 1 answer && pressed=true
  if "$pressed" && "$session_complete" && [ "$status" -eq 0 ] && [ "\${TERM_PROGRAM:-}" = Apple_Terminal ] && [ -x /usr/bin/osascript ]; then
    terminal_tty="$(tty)"
    # The outer same-tty shell must end; a short-lived manual wrapper is insufficient.
    node --input-type=module - "$terminal_tty" "$session_pid" <<'NODE'
import { spawn } from 'node:child_process';
const script = ${JSON.stringify(closeWindow)};
const fallback = () => console.error('Automatic window closure unavailable; close this window with Cmd+W.');
try {
  const worker = spawn('/usr/bin/osascript', ['-e', script, ...process.argv.slice(2)], { detached: true, stdio: 'ignore' });
  worker.on('error', fallback);
  worker.unref();
} catch { fallback(); }
NODE
  fi
fi
exit "$status"
`, { mode: 0o755 });
  }
  chmodSync(join(releaseRoot, 'install.sh'), 0o755);
  chmodSync(join(releaseRoot, 'bin/tasks'), 0o755);
  if (target === 'windows-x64') {
    writeFileSync(join(releaseRoot, 'README.md'), `# Outask AI v${version} (Windows x64)

Requires native Windows x64 and installed Node.js ${nodeRange} on PATH. No WSL or administrator account is needed.
Extract the archive, open its OutaskAI directory in PowerShell or cmd.exe, then run:

PowerShell: \`./install.cmd\`

cmd.exe: \`install.cmd\`

Application: %USERPROFILE%\\AppData\\Local\\Programs\\OutaskAI. Command: %USERPROFILE%\\AppData\\Local\\OutaskAI\\bin\\tasks.cmd.
The installer preserves existing user PATH entries and adds the command directory once.
Open a new PowerShell or cmd.exe terminal to run tasks by name; an already-open session keeps its PATH.
If PATH setup fails, use the printed absolute launcher path immediately.

Run from a project directory:

\`tasks create --title "Write release notes"\`

\`tasks list --format table\`

\`tasks validate\`

Update by running the new archive's install.cmd. Managed program files are replaced; unrelated files, project tasks and configuration are preserved.
Uninstall with install.cmd uninstall from the installed OutaskAI directory (PowerShell: ./install.cmd uninstall).
This removes only the managed launcher; application files, user PATH, projects and configuration remain.
Use --bin-dir and --release-root for custom command and application-parent directories.

For packaged MCP, configure command node and args ["C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\OutaskAI\\app\\bin\\tasks", "mcp"].
Use the actual absolute path, JSON-escaped backslashes, and explicit project_path in tool calls.
`);
    return;
  }
  writeFileSync(join(releaseRoot, 'README.md'), `# Outask AI v${version} (${target})

Outask AI keeps tasks with your code as readable JSON. This archive installs
the technical \`tasks\` command; existing \`task-tracker\` installation paths
remain valid identifiers.

Extract this archive in a directory you will keep, open its OutaskAI directory, then run:

\`\`\`sh
./install.sh
\`\`\`

${target === 'macos-arm64' ? 'You can also double-click Install.command in Finder and press any key after reading the result.\nAfter success it attempts to close its own idle, single-tab Terminal window.\nIf the window stays open, use Cmd+W; failures retain their diagnostics.\nThe application is installed at ~/Library/Application Support/OutaskAI.' : 'The application is installed at ~/.local/share/task-tracker/releases/OutaskAI.'}
The command is ~/.local/bin/tasks. The installer configures PATH for future
terminals in zsh .zprofile (also .zshrc on Linux, respecting ZDOTDIR) or bash
.bashrc and the first login profile. Open a new terminal afterward. It prints an
immediate command and a manual PATH setting if shell setup needs attention.

Requires installed Node.js ${nodeRange} on PATH. The installer reports a missing or
unsupported runtime before changing files.

## Use

\`\`\`sh
tasks create --title "Write release notes"
tasks list --format table
tasks validate
\`\`\`

Run \`tasks --help\` for all commands.

## Update and remove

Use --bin-dir for the command directory and --release-root for the parent of OutaskAI.
To update, download the new archive, extract it in a directory you will keep and run its install.sh.
Updates replace the managed application files in OutaskAI. User projects, configuration and unrelated files beside the application are preserved. Older versioned installation copies are retained.
To uninstall, run ./install.sh uninstall from the installed OutaskAI directory.
Uninstall removes only the managed command link; application copies, project data and configuration are preserved.
`);
}

async function build(target, options) {
  const appPackage = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
  const version = distributionVersion(appPackage.version);
  const stage = join(options.outDir, 'stage', 'OutaskAI');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  copyApp(join(stage, 'app'));
  const npmrc = join(stage, '.npmrc-release');
  writeFileSync(npmrc, '');
  run('npm', ['ci', '--omit=dev', '--userconfig', npmrc], { cwd: join(stage, 'app'), env: cleanNpmEnv(npmrc) });
  run('npm', ['ci', '--omit=dev', '--userconfig', npmrc], { cwd: join(stage, 'app/mcp'), env: cleanNpmEnv(npmrc) });
  rmSync(npmrc, { force: true });
  pruneTests(join(stage, 'app/node_modules'));
  pruneTests(join(stage, 'app/mcp/node_modules'));
  writeSupport(stage, version, target, appPackage.engines.node);

  for (const forbidden of ['tasks', '.git', 'references', 'tests']) {
    if (existsSync(join(stage, forbidden))) fail('INVALID_RELEASE', `release includes ${forbidden}`);
  }
  assertClean(stage);
  const archive = join(options.outDir, `OutaskAI-${version}-${target}.tar.gz`);
  rmSync(archive, { force: true });
  run('tar', ['-czf', archive, '-C', join(options.outDir, 'stage'), 'OutaskAI']);
  rmSync(stage, { recursive: true, force: true });
  return { target, archive, bytes: statSync(archive).size };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = distributionVersion(JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version);
  mkdirSync(options.outDir, { recursive: true });
  const results = [];
  for (const target of options.targets) results.push(await build(target, options));
  process.stdout.write(`${JSON.stringify({ version, artifacts: results }, null, 2)}\n`);
}

try { await main(); } catch (error) { reportError(error); process.exitCode = 1; }
