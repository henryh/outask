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
  'install-launcher.mjs',
  'install-path.mjs',
  'install-release.mjs',
  'inspect-blockers.mjs',
  'lifecycle.mjs',
  'list-tasks.mjs',
  'output.mjs',
  'schema.mjs',
  'search-tasks.mjs',
  'task-write-input.mjs',
  'transition-task.mjs',
  'update-task.mjs',
  'update-release.mjs',
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
  if (target === 'windows-x64') {
    writeFileSync(join(releaseRoot, 'Install.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\nwhere.exe node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo DEPENDENCY_MISSING: install Node.js ${nodeRange} and put node on PATH 1>&2\r\n  exit /b 1\r\n)\r\nnode "%~dp0app\\runtime.cjs"\r\nif errorlevel 1 exit /b 1\r\nnode "%~dp0app\\scripts\\install-release.mjs" %*\r\nexit /b %errorlevel%\r\n`);
  }
  writeFileSync(join(releaseRoot, 'release.json'), JSON.stringify({ version, target }) + '\n');
  if (target === 'linux-x64') {
    writeFileSync(join(releaseRoot, 'install.sh'), `#!/bin/sh
set -eu
command -v node >/dev/null 2>&1 || { echo "DEPENDENCY_MISSING: install Node.js ${nodeRange} and put node on PATH" >&2; exit 1; }
command -v dirname >/dev/null 2>&1 || { echo "DEPENDENCY_MISSING: dirname is required" >&2; exit 1; }
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
node "$root/app/runtime.cjs"
exec node "$root/app/scripts/install-release.mjs" "$@"
`, { mode: 0o755 });
    chmodSync(join(releaseRoot, 'install.sh'), 0o755);
  }
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
nodeGuidance() {
  printf '%s\\n' "Install or upgrade Node.js ${nodeRange} using the macOS installer from https://nodejs.org/en/download, then open a new terminal and retry." >&2
  printf '%s\\n' 'Put the working node executable on PATH. Homebrew is optional; repair a package-manager installation using that manager rather than linking incompatible dylibs.' >&2
}
homebrewNodeFormula() {
  local node_path="$1" formula prefix
  command -v brew >/dev/null 2>&1 || return 1
  for formula in $(brew list --formula 2>/dev/null); do
    case "$formula" in node|node@*) ;; *) continue ;; esac
    prefix="$(brew --prefix --installed "$formula" 2>/dev/null)" || continue
    if [ -e "$prefix/bin/node" ] && [ "$node_path" -ef "$prefix/bin/node" ]; then
      printf '%s' "$formula"
      return 0
    fi
  done
  return 1
}
nvmGuidance() {
  local node_path="\${1:-}"
  case "$node_path" in
    "$HOME"/.nvm/versions/node/*/bin/node) ;;
    "\${XDG_CONFIG_HOME:-$HOME/.config}"/nvm/versions/node/*/bin/node) ;;
    *)
      if [ -z "\${NVM_DIR:-}" ]; then return 1; fi
      case "$node_path" in "$NVM_DIR"/versions/node/*/bin/node) ;; *) return 1 ;; esac
      ;;
  esac
  printf '%s\\n' "NVM: run nvm install 'lts/*' && nvm alias default 'lts/*', then retry." >&2
}
installedNvmRoot() {
  local candidate
  for candidate in "\${NVM_DIR:-}" "\${XDG_CONFIG_HOME:-$HOME/.config}/nvm" "$HOME/.nvm"; do
    [ -n "$candidate" ] && [ -s "$candidate/nvm.sh" ] || continue
    printf '%s' "$candidate"
    return 0
  done
  return 1
}
nvmRootForNode() {
  local node_path="$1" candidate
  for candidate in "\${NVM_DIR:-}" "\${XDG_CONFIG_HOME:-$HOME/.config}/nvm" "$HOME/.nvm"; do
    [ -n "$candidate" ] && [ -s "$candidate/nvm.sh" ] || continue
    case "$node_path" in "$candidate"/versions/node/*/bin/node)
      printf '%s' "$candidate"
      return 0
      ;;
    esac
  done
  return 1
}
runNvmAction() {
  local nvm_root="$1" answer
  provider_action_attempted=false
  printf '%s\\n' "NVM can install Node.js: nvm install 'lts/*' && nvm alias default 'lts/*'" >&2
  if [ ! -t 0 ]; then
    printf '%s\\n' 'Run it in a terminal, then retry.' >&2
    return 1
  fi
  printf 'Run this NVM command now? [y/N] ' >&2
  IFS= read -r answer || answer=''
  case "$answer" in y|Y|yes|YES)
    provider_action_attempted=true
    NVM_DIR="$nvm_root"
    export NVM_DIR
    . "$NVM_DIR/nvm.sh" --no-use || return $?
    nvm install 'lts/*' || return $?
    nvm alias default 'lts/*' || return $?
    nvm use 'lts/*' || return $?
    hash -r
    return 0
    ;;
  esac
  return 1
}
runHomebrewAction() {
  local action="$1" formula="$2" answer
  printf '%s\\n' "Homebrew can repair Node.js by running: brew $action --formula $formula" >&2
  if [ ! -t 0 ]; then
    printf '%s\\n' "Run this command in a terminal, then retry Install.command." >&2
    return 1
  fi
  printf 'Run this Homebrew command now? [y/N] ' >&2
  IFS= read -r answer || answer=''
  case "$answer" in y|Y|yes|YES)
    brew "$action" --formula "$formula" || return $?
    hash -r
    return 0
    ;;
  esac
  return 1
}
offerNodeInstall() {
  command -v brew >/dev/null 2>&1 || return 1
  runHomebrewAction install node
}
runInstaller() {
  local attempted_install=false attempted_repair=false provider_action_attempted=false action_status nvm_root
  while ! command -v node >/dev/null 2>&1; do
    echo "DEPENDENCY_MISSING: install Node.js ${nodeRange} and put node on PATH" >&2
    nvm_root="$(installedNvmRoot)" || nvm_root=''
    if ! "$attempted_install" && [ -n "$nvm_root" ]; then
      runNvmAction "$nvm_root"
      action_status=$?
      if [ "$action_status" -eq 0 ]; then attempted_install=true; continue; fi
      if "$provider_action_attempted"; then return "$action_status"; fi
      return 1
    fi
    nodeGuidance
    if ! "$attempted_install" && offerNodeInstall; then
      attempted_install=true
      continue
    fi
    return 1
  done
  command -v dirname >/dev/null 2>&1 || { echo "DEPENDENCY_MISSING: dirname is required" >&2; return 1; }
  local root node_path diagnostic status missing_library formula
  root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)" || return $?
  while true; do
    node_path="$(command -v node)"
    # Probe before loading the installer; a found executable may have broken dylib dependencies.
    diagnostic="$( { node "$root/app/runtime.cjs"; } 2>&1)"
    status=$?
    [ "$status" -eq 0 ] && break
    case "$diagnostic" in
      *'Library not loaded:'*)
        missing_library="\${diagnostic#*Library not loaded: }"
        missing_library="\${missing_library%%$'\\n'*}"
        printf '%s\\n' "DEPENDENCY_LIBRARY_MISSING: Node.js at $node_path cannot start (exit $status)." >&2
        printf '%s\\n' "Missing library: $missing_library" >&2
        printf 'Original Node.js diagnostic:\\n%s\\n' "$diagnostic" >&2
        nvm_root="$(nvmRootForNode "$node_path")" || nvm_root=''
        if ! "$attempted_repair" && [ -n "$nvm_root" ]; then
          runNvmAction "$nvm_root"
          action_status=$?
          if [ "$action_status" -eq 0 ]; then attempted_repair=true; continue; fi
          if "$provider_action_attempted"; then return "$action_status"; fi
          return "$status"
        else
          formula="$(homebrewNodeFormula "$node_path")" || formula=''
          if ! "$attempted_repair" && [ -n "$formula" ] && runHomebrewAction reinstall "$formula"; then
            attempted_repair=true
            continue
          fi
        fi
        nvmGuidance "$node_path" || nodeGuidance
        ;;
      *INCOMPATIBLE_RUNTIME:*)
        printf '%s\\n' "INCOMPATIBLE_RUNTIME: Node.js ${nodeRange} is required." >&2
        nvm_root="$(nvmRootForNode "$node_path")" || nvm_root=''
        if ! "$attempted_repair" && [ -n "$nvm_root" ]; then
          runNvmAction "$nvm_root"
          action_status=$?
          if [ "$action_status" -eq 0 ]; then attempted_repair=true; continue; fi
          if "$provider_action_attempted"; then return "$action_status"; fi
          return "$status"
        else
          formula="$(homebrewNodeFormula "$node_path")" || formula=''
          if ! "$attempted_repair" && [ -n "$formula" ] && runHomebrewAction upgrade "$formula"; then
            attempted_repair=true
            continue
          fi
        fi
        nvmGuidance "$node_path" || nodeGuidance
        ;;
      *)
        printf '%s\\n' "DEPENDENCY_UNAVAILABLE: Node.js at $node_path could not start (exit $status)." >&2
        printf 'Original Node.js diagnostic:\\n%s\\n' "$diagnostic" >&2
        nvm_root="$(nvmRootForNode "$node_path")" || nvm_root=''
        if ! "$attempted_repair" && [ -n "$nvm_root" ]; then
          runNvmAction "$nvm_root"
          action_status=$?
          if [ "$action_status" -eq 0 ]; then attempted_repair=true; continue; fi
          if "$provider_action_attempted"; then return "$action_status"; fi
          return "$status"
        fi
        nvmGuidance "$node_path" || nodeGuidance
        ;;
    esac
    return "$status"
  done
  node "$root/app/scripts/install-release.mjs" "$@"
}
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
runInstaller "$@"
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
  chmodSync(join(releaseRoot, 'bin/tasks'), 0o755);
  if (target === 'windows-x64') {
    writeFileSync(join(releaseRoot, 'README.md'), `# Outask AI v${version} (Windows x64)

Requires native Windows x64 and installed Node.js ${nodeRange} on PATH.
Extract the archive, open its OutaskAI directory in PowerShell or cmd.exe, then run:

PowerShell: \`./Install.cmd\`

cmd.exe: \`Install.cmd\`

Application: \`%USERPROFILE%\\AppData\\Local\\Programs\\OutaskAI\`. Command: \`%USERPROFILE%\\AppData\\Local\\OutaskAI\\bin\\tasks.cmd\`.
Open a new terminal, then run from a project directory:

\`\`\`text
tasks create --title "Write release notes"
tasks list --format table
\`\`\`

## MCP (optional)

Configure your client to start Node directly:

\`\`\`json
${JSON.stringify({ command: 'node', args: ['C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\OutaskAI\\app\\bin\\tasks', 'mcp'] })}
\`\`\`

Replace YOUR_USER with your user name; pass \`project_path\` in tool calls.
[MCP setup](https://github.com/henryh/outask/blob/v${version}/app/mcp/README.md) · [Commands](https://github.com/henryh/outask/blob/v${version}/app/README.md)

## Update and remove

Update to GitHub Latest stable: run \`./Install.cmd update\` (PowerShell) or \`Install.cmd update\` (cmd.exe) from the installed OutaskAI directory. Requires network access and tar on PATH.
Uninstall (PowerShell): \`& "$env:USERPROFILE\\AppData\\Local\\Programs\\OutaskAI\\Install.cmd" uninstall\`
Uninstall (cmd.exe): \`"%USERPROFILE%\\AppData\\Local\\Programs\\OutaskAI\\Install.cmd" uninstall\`
Uninstall removes the managed launcher; application files, projects and configuration remain.
Use \`--bin-dir\` and \`--release-root\` for custom command and application-parent directories.
`);
    return;
  }
  const platform = target === 'macos-arm64' ? 'macOS Apple silicon' : 'Linux x64';
  const application = target === 'macos-arm64' ? '~/Library/Application Support/OutaskAI' : '~/.local/share/task-tracker/releases/OutaskAI';
  const installer = target === 'macos-arm64' ? 'Install.command' : 'install.sh';
  const uninstall = `"${application.replace('~', '$HOME')}/${installer}" uninstall`;
  writeFileSync(join(releaseRoot, 'README.md'), `# Outask AI v${version} (${platform})

Requires ${platform} and installed Node.js ${nodeRange} on PATH.
${target === 'macos-arm64' ? 'Extract the archive, open its OutaskAI directory, then double-click `Install.command` or run in a terminal:' : 'Extract the archive, open its OutaskAI directory in a terminal, then run:'}

\`\`\`sh
./${installer}
\`\`\`

If starting the installer reports Permission denied, run \`${target === 'macos-arm64' ? 'bash' : 'sh'} ./${installer}\`.
${target === 'macos-arm64' ? 'For an Apple verification warning, follow [Apple’s instructions](https://support.apple.com/en-us/102445).\nInstall Node.js with the [macOS installer](https://nodejs.org/en/download) or another provider. Homebrew is optional. The installer checks Node.js and can repair it through installed Homebrew or NVM after confirmation, then checks again. Other failures retain the original diagnostic.\n' : ''}Application: \`${application}\`. Command: \`~/.local/bin/tasks\`.
Open a new terminal, then run from a project directory:

\`\`\`sh
tasks create --title "Write release notes"
tasks list --format table
\`\`\`

## Connect Codex (optional)

\`\`\`sh
codex mcp add tasks -- tasks mcp
codex mcp list
\`\`\`

Start a new Codex session; use \`/mcp\` to inspect the server.
[MCP setup](https://github.com/henryh/outask/blob/v${version}/app/mcp/README.md) · [Commands](https://github.com/henryh/outask/blob/v${version}/app/README.md)

## Update and remove

Update to GitHub Latest stable: run \`./${installer} update\` from the installed OutaskAI directory. Requires network access and tar on PATH.
Uninstall: \`${uninstall}\`
Uninstall removes the managed command link; application files, projects and configuration remain.
Use \`--bin-dir\` and \`--release-root\` for custom command and application-parent directories.
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
