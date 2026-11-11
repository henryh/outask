# A batch launched by Explorer owns its console and exits with cmd /c.
# PowerShell and persistent cmd sessions must keep their normal prompt.
function Test-ClosingConsole($processes, $selfId, $parent) {
  return $parent.Name -ieq 'cmd.exe' -and
    $parent.CommandLine -match '(?i)(?:^|\s)/c(?:\s|")' -and
    $processes.Count -eq 2 -and $processes -contains $selfId -and $processes -contains $parent.ProcessId
}

function Wait-Installer {
try {
  if ([Console]::IsInputRedirected) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OutaskConsole {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint GetConsoleProcessList(uint[] processes, uint count);
}
'@
  $processes = New-Object uint[] 16
  $count = [OutaskConsole]::GetConsoleProcessList($processes, $processes.Length)
  $self = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop
  $parentId = $self.ParentProcessId
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction Stop
  if ($count -eq 0 -or $count -gt $processes.Length) { return }
  if (-not (Test-ClosingConsole $processes[0..($count - 1)] $PID $parent)) { return }
  Write-Host 'Press any key to finish.'
  $null = [Console]::ReadKey($true)
} catch {
  # Optional window retention must not change the installer's exit status.
}
}

Wait-Installer
