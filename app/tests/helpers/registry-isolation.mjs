// Run the real PowerShell registry operations against a test-owned key. This
// preload stays outside distribution archives and adds no production switch.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

export function isolateRegistry(key) {
  if (!/^Software\\Outask\\Tests\\[a-f0-9-]+$/.test(key)) throw new Error('Invalid test registry key');
  const spawnSync = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    if (/powershell(?:\.exe)?$/i.test(command)) {
      args = args.map(argument => typeof argument === 'string' ? argument
        .replaceAll("CreateSubKey('Environment')", `CreateSubKey('${key}')`)
        .replaceAll("OpenSubKey('Environment')", `OpenSubKey('${key}')`)
        .replaceAll("[Environment]::GetEnvironmentVariable('Path','User')",
          `[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}').GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)`) : argument);
    }
    return spawnSync(command, args, options);
  };
  syncBuiltinESMExports();
}

if (process.env.OUTASK_TEST_REGISTRY_KEY) isolateRegistry(process.env.OUTASK_TEST_REGISTRY_KEY);
