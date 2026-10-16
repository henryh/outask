import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

// Both installers configure future terminals after the command is installed.
// Profile errors must not turn a usable installation into a reported failure.
export function configurePath(bin, { env = process.env, platform = process.platform } = {}) {
  if (platform === 'win32') return configureWindowsPath(bin, env);
  const home = env.HOME || homedir();
  const shell = basename(env.SHELL || '');
  const setting = `export PATH=${quote(bin)}:"$PATH"`;
  const messages = [`Run immediately: ${quote(join(bin, 'tasks'))} --help`];
  let profiles;
  if (shell === 'zsh') {
    const directory = env.ZDOTDIR === undefined ? home : resolve(env.ZDOTDIR);
    profiles = [join(directory, '.zprofile')];
    if (platform === 'linux') profiles.push(join(directory, '.zshrc'));
  } else if (shell === 'bash') {
    const login = ['.bash_profile', '.bash_login', '.profile'].map((name) => join(home, name));
    profiles = [join(home, '.bashrc'), login.find(existsSync) || join(home, platform === 'darwin' ? '.bash_profile' : '.profile')];
  } else {
    messages.push(`Automatic PATH setup is unavailable for ${shell || 'an unknown shell'}. Add ${setting} to your shell startup file, then open a new terminal.`);
    return messages;
  }
  // Literal quoting also protects shell pattern characters in custom paths.
  const block = `# Outask AI command path\ncase ":\${PATH-}:" in\n  *:${quote(bin)}:*) ;;\n  *) ${setting} ;;\nesac\n`;
  for (const profile of profiles) {
    try {
      const contents = existsSync(profile) ? readFileSync(profile, 'utf8') : '';
      if (!contents.includes(block)) {
        mkdirSync(dirname(profile), { recursive: true });
        appendFileSync(profile, `${contents && !contents.endsWith('\n') ? '\n' : ''}${block}`, { mode: 0o600 });
      }
      messages.push(`PATH configured in ${profile}.`);
    } catch (error) {
      messages.push(`Command installed at ${join(bin, 'tasks')}; PATH setup failed for ${profile}: ${error.message}. Add ${setting} to that startup file manually.`);
    }
  }
  messages.push('Open a new terminal after PATH setup to use tasks by name. The current terminal PATH is unchanged.');
  return messages;
}

function configureWindowsPath(bin, env) {
  const launcher = join(bin, 'tasks.cmd');
  const messages = [`Run immediately in PowerShell: & "${launcher}" --help`, `Run immediately in cmd.exe: "${launcher}" --help`];
  // Read the raw registry value so expandable entries and its value kind survive.
  const script = `
$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
  if ($key.GetValueNames() -contains 'Path') { $kind = $key.GetValueKind('Path') }
  $bin = $env:OUTASK_INSTALL_BIN
  $normal = $bin.TrimEnd('\\').ToLowerInvariant()
  $present = @($raw.Split(';') | Where-Object {
    [Environment]::ExpandEnvironmentVariables($_.Trim().Trim('"')).TrimEnd('\\').ToLowerInvariant() -eq $normal
  }).Count -gt 0
  if (-not $present) {
    $separator = if ($raw.Length -eq 0 -or $raw.EndsWith(';')) { '' } else { ';' }
    $key.SetValue('Path', $raw + $separator + $bin, $kind)
  }
} finally { $key.Dispose() }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OutaskEnvironment {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr parameter, string value, uint flags, uint timeout, out UIntPtr result);
}
'@
$result = [UIntPtr]::Zero
if ([OutaskEnvironment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) -eq [IntPtr]::Zero) {
  throw 'User PATH was saved, but Windows environment-change notification failed; restart your terminal host or sign out and back in.'
}
`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...env, OUTASK_INSTALL_BIN: bin }, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    messages.push(`Command installed at ${launcher}; user PATH setup failed: ${result.error?.message || result.stderr?.trim() || result.status}. Add ${bin} to your user PATH manually.`);
  } else messages.push(`PATH configured in the current user's Windows environment: ${bin}.`);
  messages.push('Open a new PowerShell or cmd.exe terminal to use tasks by name. An already-open terminal keeps its existing PATH; launch from the printed path immediately.');
  return messages;
}
